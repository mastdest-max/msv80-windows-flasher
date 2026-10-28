import { parseObdPayload, parseObdText } from "./logger";
import { moduleAwake, MODULES } from "./modules";
import {
  ELM_IDENT,
  ELM_SETUP,
  createIsoTpTelegram,
  dmeIdentPayload,
  echoOnly,
  extractAscii,
  beyondEcho,
  kwpFrame,
  kwpObd,
  kwpBodies,
  findAdapterReply,
  hexBytes,
  ignitionRequest,
  looksLikeElm,
  readIgnition,
  readVersion,
  readVoltageByte,
  versionRequest,
  voltageRequest,
  type AdapterStatus,
} from "./kdcan";

export type SerialPortLike = {
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    bufferSize?: number;
  }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  /** Bytes go out at once. Wi-Fi bridge, not a USB lead that has to drop DTR. */
  direct?: boolean;
  getSignals?(): Promise<{
    dataCarrierDetect?: boolean;
    clearToSend?: boolean;
    ringIndicator?: boolean;
    dataSetReady?: boolean;
  }>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
};

export type SerialApi = {
  requestPort(): Promise<SerialPortLike>;
  getPorts?(): Promise<SerialPortLike[]>;
};

export function serialApi(): SerialApi | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { serial?: SerialApi };
  return nav.serial ?? null;
}

/** Why Connect cannot see a USB lead. `ready` means the picker can open. */
export function serialAccess(): "ready" | "framed" | "browser" | "insecure" {
  if (typeof window === "undefined") return "browser";
  if (serialApi()) return "ready";
  if (!window.isSecureContext) return "insecure";
  if (window.top !== window.self) return "framed";
  return "browser";
}

export const SCAN_BAUDS = [115200, 38400, 9600];

export function baudOrder(selected: number): number[] {
  return [selected, ...SCAN_BAUDS.filter((rate) => rate !== selected)];
}

export function portName(port: SerialPortLike): string {
  const info = port.getInfo?.();
  const vid = info?.usbVendorId;
  if (vid === 0x0403) return "FTDI lead";
  if (vid === 0x1a86) return "CH340 lead";
  if (vid === 0x10c4) return "CP210x lead";
  if (vid) return `USB ${vid.toString(16)}:${(info?.usbProductId ?? 0).toString(16)}`;
  return "USB serial lead";
}

export type CableLog = (line: string) => void;

export type ProbeKind = "bmw" | "elm" | "echo" | "bytes" | "silent";

export type ProbeResult = AdapterStatus & {
  kind: ProbeKind;
  heard: number;
};

export type LineState = {
  dsr: boolean | null;
  cts: boolean | null;
  dcd: boolean | null;
  ri: boolean | null;
};

export class CableLink {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private rx = new Uint8Array(0);
  private closed = false;
  private generation = 0;
  private mode: "unknown" | "bmw" | "elm" | "kwp" = "unknown";
  private baud = 115200;
  private obdReady = false;
  private obdRoute: "physical" | "functional" | null = null;
  /** Packed mode 01 is off until the DME has answered a single live request. */
  private obdPacked: boolean | null = false;
  private lastObdNrc: number | null = null;
  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly port: SerialPortLike,
    private readonly log: CableLog,
  ) {}

  async open(baudRate: number): Promise<void> {
    await this.bind(baudRate, true);
  }

  async retune(baudRate: number): Promise<void> {
    await this.bind(baudRate, false);
  }

  private async bind(baudRate: number, first: boolean): Promise<void> {
    if (!first) await this.stopIo();
    this.baud = baudRate;
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none", bufferSize: 4096 });
    if (this.port.setSignals) {
      await this.port.setSignals({ dataTerminalReady: true, requestToSend: false });
    }
    if (!this.port.readable || !this.port.writable) throw new Error("The serial port has no data streams.");
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    const generation = this.generation;
    void this.pump(generation);
    this.log(`Port open at ${baudRate} baud. Waiting for the lead to wake.`);
    await sleep(900);
    if (this.rx.length > 0) {
      const text = decodeText(this.rx);
      this.log(`Wake ${hexBytes(this.rx.subarray(0, 48))}`);
      if (looksLikeElm(text)) {
        this.mode = "elm";
        this.log("ELM327-style banner.");
      }
      this.rx = new Uint8Array(0);
    }
  }

  /** Ask every module for identification. DME is first. A missing reply is not a failed cable. */
  async greetModules(): Promise<{ lines: string[]; dme: boolean }> {
    if (this.mode === "elm") return { lines: [], dme: false };
    const lines: string[] = [];
    let dme = false;
    for (const spec of MODULES) {
      this.log(`Checking ${spec.name}.`);
      let raw = await this.requestModule(spec.target, Uint8Array.of(0x1a, 0x80), 400);
      if (!moduleAwake(raw)) raw = await this.requestModule(spec.target, Uint8Array.of(0x1a, 0x90), 400);
      const awake = moduleAwake(raw);
      if (spec.id === "dme") dme = awake;
      const line = `${spec.name} ${awake ? "answered" : "no reply"}`;
      this.log(line);
      lines.push(line);
    }
    return { lines, dme };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stopIo();
    this.log("Port closed.");
  }

  async lines(): Promise<LineState> {
    if (!this.port.getSignals) return { dsr: null, cts: null, dcd: null, ri: null };
    try {
      const signals = await this.port.getSignals();
      return {
        dsr: signals.dataSetReady ?? null,
        cts: signals.clearToSend ?? null,
        dcd: signals.dataCarrierDetect ?? null,
        ri: signals.ringIndicator ?? null,
      };
    } catch {
      return { dsr: null, cts: null, dcd: null, ri: null };
    }
  }

  async probeAdapter(): Promise<ProbeResult> {
    const status: ProbeResult = {
      ignitionOn: null,
      adapterType: null,
      adapterVersion: null,
      voltage: null,
      kind: this.mode === "elm" ? "elm" : "silent",
      heard: 0,
    };
    if (this.mode === "elm") return status;

    const ignition = ignitionRequest();
    const ignitionRx = await this.transact(ignition, 700);
    status.heard += ignitionRx.length;
    const ignitionReply = findAdapterReply(ignition, ignitionRx, 6, 0xfe);
    if (ignitionReply) status.ignitionOn = readIgnition(ignitionReply);
    let echoed = echoOnly(ignition, ignitionRx);

    if (ignitionRx.length === 0) {
      const retry = await this.transact(ignition, 700);
      status.heard += retry.length;
      const retryReply = findAdapterReply(ignition, retry, 6, 0xfe);
      if (retryReply) status.ignitionOn = readIgnition(retryReply);
      echoed = echoOnly(ignition, retry);
    }

    if (status.heard === 0) return status;

    const version = versionRequest();
    const versionRx = await this.transact(version, 700);
    status.heard += versionRx.length;
    const versionReply = findAdapterReply(version, versionRx, 9, 0xfd);
    if (versionReply) {
      const parsed = readVersion(versionReply);
      if (parsed) {
        status.adapterType = parsed.type;
        status.adapterVersion = parsed.version;
      }
    }
    echoed = echoed && echoOnly(version, versionRx);

    const voltage = voltageRequest();
    const voltageRx = await this.transact(voltage, 700);
    status.heard += voltageRx.length;
    const voltageReply = findAdapterReply(voltage, voltageRx, 6, 0xfc);
    if (voltageReply) status.voltage = readVoltageByte(voltageReply);
    echoed = echoed && echoOnly(voltage, voltageRx);

    if (status.ignitionOn !== null || status.adapterVersion !== null || status.voltage !== null) {
      this.mode = "bmw";
      status.kind = "bmw";
    } else if (echoed) {
      status.kind = "echo";
    } else if (status.heard > 0) {
      status.kind = "bytes";
    }
    return status;
  }

  async sniffElm(): Promise<boolean> {
    return this.wakeElm();
  }

  /** ELM327 only. No BMW adapter telegrams. Tries CR, then CR LF, then ATI. */
  async wakeElm(): Promise<boolean> {
    if (this.mode === "elm") return true;
    if (this.mode === "bmw" || this.mode === "kwp") return false;
    for (const ending of ["\r", "\r\n"]) {
      const reset = await this.transact(encodeText(`ATZ${ending}`), 1400);
      if (looksLikeElm(decodeText(reset))) {
        this.mode = "elm";
        this.log("ELM327-style adapter.");
        return true;
      }
    }
    const info = await this.transact(encodeText("ATI\r"), 800);
    if (looksLikeElm(decodeText(info))) {
      this.mode = "elm";
      this.log("ELM327-style adapter.");
      return true;
    }
    return false;
  }

  async identifyDme(baud500: boolean): Promise<{ raw: Uint8Array; text: string; kind: "adapter" | "elm" | "none" }> {
    if (this.mode === "unknown") {
      const elmProbe = await this.transact(encodeText("ATZ\r"), 1200);
      const elmText = decodeText(elmProbe);
      if (looksLikeElm(elmText)) this.mode = "elm";
    }
    if (this.mode === "elm") {
      this.obdReady = false;
      this.log("ELM327-style adapter.");
      for (const command of ELM_SETUP.slice(1)) {
        await this.transact(encodeText(`${command}\r`), 400);
      }
      const ident = await this.transact(encodeText(`${ELM_IDENT}\r`), 1500);
      return { raw: ident, text: decodeText(ident), kind: "elm" };
    }

    if (this.mode === "kwp") {
      const kwp = await this.readKwpIdent();
      if (kwp) return { raw: kwp.raw, text: kwp.text, kind: "adapter" };
      return { raw: new Uint8Array(), text: "", kind: "none" };
    }

    const telegram = createIsoTpTelegram(0x6f1, 0x612, dmeIdentPayload(), baud500);
    const raw = await this.transact(telegram, 1600, false, true);
    const extra = beyondEcho(telegram, raw);
    return { raw: extra.length > 0 ? extra : raw, text: extractAscii(extra), kind: extra.length > 0 ? "adapter" : "none" };
  }

  /** Stock FTDI leads echo 82 F1 F1 and add nothing. Ask the DME with DTR released. */
  async askDme(baud500: boolean): Promise<{ raw: Uint8Array; text: string; echoed: boolean }> {
    this.log("Commands were only echoed. Asking the DME with the transmit line released.");
    const kwp = await this.readKwpIdent();
    if (kwp) return { raw: kwp.raw, text: kwp.text, echoed: false };
    const telegram = createIsoTpTelegram(0x6f1, 0x612, dmeIdentPayload(), baud500);
    const canRx = await this.transact(telegram, 1600, false, true);
    const canExtra = beyondEcho(telegram, canRx);
    if (canExtra.length > 0) return { raw: canExtra, text: extractAscii(canExtra), echoed: false };
    return { raw: canRx, text: "", echoed: true };
  }

  private async readKwpIdent(): Promise<{ raw: Uint8Array; text: string } | null> {
    const ids = [0x90, 0x91, 0x92, 0x97, 0x80, 0x86, 0x87, 0x9a];
    const parts: Uint8Array[] = [];
    for (const id of ids) {
      const frame = kwpFrame(0x12, Uint8Array.of(0x1a, id));
      const rx = await this.transact(frame, 1200, false, true);
      const extra = beyondEcho(frame, rx);
      if (extra.length === 0) {
        if (parts.length === 0) return null;
        continue;
      }
      this.mode = "kwp";
      parts.push(extra);
    }
    const raw = joinBytes(parts);
    return { raw, text: extractAscii(raw) };
  }

  /** Open a normal session, then ask for engine speed the way the DME accepts it. */
  async prepareDme(): Promise<string | null> {
    if (this.mode === "elm") return null;
    await this.requestModule(0x12, Uint8Array.of(0x81), 300);
    await this.requestModule(0x12, Uint8Array.of(0x10, 0x81), 400);
    this.obdRoute = null;
    this.obdPacked = false;
    const rpm = await this.readObd(0x0c, true, true);
    if (rpm) return null;
    return this.dmeRefusal();
  }

  dmeRefusal(): string {
    if (this.lastObdNrc === 0x11 || this.lastObdNrc === 0x12) {
      return "The DME refused live data. It answers identification, but not that request.";
    }
    if (this.lastObdNrc === 0x22) return "The DME refused live data. Ignition has to be on.";
    if (this.lastObdNrc != null) return `The DME refused live data (${this.lastObdNrc.toString(16).toUpperCase()}).`;
    return "The DME did not answer live data. Ignition on, and leave the lead on D-CAN.";
  }

  async readObd(pid: number, baud500: boolean, fast = false): Promise<{ a: number; b: number } | null> {
    if (this.mode === "elm" && !this.obdReady) {
      await this.transact(encodeText("ATSH7E0\r"), 400);
      await this.transact(encodeText("ATCRA7E8\r"), 400);
      this.obdReady = true;
      this.log("OBD headers set to 7E0 / 7E8.");
    }
    const label = pid.toString(16).padStart(2, "0").toUpperCase();
    if (this.mode === "elm") {
      const raw = await this.transact(encodeText(`01${label}\r`), fast ? 80 : 700, true, false, fast);
      return parseObdText(decodeText(raw), pid);
    }
    if (this.mode === "kwp" || fast) {
      const known = this.obdRoute !== null;
      if (this.obdRoute !== "physical") {
        const obd = kwpObd(Uint8Array.of(0x01, pid));
        const obdRx = await this.transact(obd, fast ? 150 : known ? 90 : 220, true, true, true);
        const extra = beyondEcho(obd, obdRx);
        const obdValue = parseObdPayload(extra, pid);
        if (obdValue) {
          this.obdRoute = "functional";
          this.mode = "kwp";
          this.lastObdNrc = null;
          return obdValue;
        }
        this.lastObdNrc = nrcOf(extra, 0x01);
        if (this.obdRoute === "functional") return null;
      }
      const frame = kwpFrame(0x12, Uint8Array.of(0x01, pid));
      const raw = await this.transact(frame, fast ? 150 : known ? 90 : 220, true, true, true);
      const physical = beyondEcho(frame, raw);
      const value = parseObdPayload(physical, pid);
      if (value) {
        this.obdRoute = "physical";
        this.mode = "kwp";
        this.lastObdNrc = null;
        return value;
      }
      this.lastObdNrc = nrcOf(physical, 0x01) ?? this.lastObdNrc;
      return null;
    }
    const telegram = createIsoTpTelegram(0x7e0, 0x7e8, Uint8Array.of(0x01, pid), baud500);
    const raw = await this.transact(telegram, 700, true);
    return parseObdPayload(raw, pid);
  }

  /** One round trip. A packed frame is used only when the DME has already answered more than one PID that way. */
  async readObdGroup(pids: number[], baud500: boolean): Promise<Map<number, { a: number; b: number }>> {
    const found = new Map<number, { a: number; b: number }>();
    const unique = pids.filter((pid, index) => pids.indexOf(pid) === index).slice(0, 6);
    if (unique.length === 0) return found;
    if (unique.length === 1 || this.obdPacked !== true) {
      const value = await this.readObd(unique[0], baud500, true);
      if (value) found.set(unique[0], value);
      return found;
    }
    const payload = Uint8Array.of(0x01, ...unique);
    const frame = this.obdRoute === "functional" ? kwpObd(payload) : kwpFrame(0x12, payload);
    const raw = await this.transact(frame, 150, true, true, true);
    const extra = beyondEcho(frame, raw);
    for (const pid of unique) {
      const value = parseObdPayload(extra, pid);
      if (value) found.set(pid, value);
    }
    if (found.size >= 2) {
      this.obdPacked = true;
      this.mode = "kwp";
      if (!this.obdRoute) this.obdRoute = "physical";
      return found;
    }
    this.obdPacked = false;
    if (found.size === 1) return found;
    const single = await this.readObd(unique[0], baud500, true);
    if (single) found.set(unique[0], single);
    return found;
  }

  /** Test0 MSV80 measurement block. Returns the signed word, or null when the DME refuses that id. */
  async readMesswert(id: number): Promise<number | null> {
    const hi = (id >> 8) & 0xff;
    const lo = id & 0xff;
    const payload = Uint8Array.of(0x21, hi, lo);
    const frame = kwpFrame(0x12, payload);
    const raw = await this.transact(frame, 160, true, true, true);
    const extra = beyondEcho(frame, raw);
    for (const body of kwpBodies(extra)) {
      if (body.kind !== "ok" || body.service !== 0x61 || body.data.length < 2) continue;
      let at = 0;
      if (body.data.length >= 4 && body.data[0] === hi && body.data[1] === lo) at = 2;
      if (body.data.length < at + 2) return null;
      const word = (body.data[at] << 8) | body.data[at + 1];
      return word > 0x7fff ? word - 0x10000 : word;
    }
    return null;
  }

  async moduleVoltage(): Promise<number | null> {
    const pair = await this.readObd(0x42, true);
    if (!pair) return null;
    const volts = (pair.a * 256 + pair.b) / 1000;
    if (volts < 6 || volts > 18) return null;
    return volts;
  }

  async requestDme(payload: Uint8Array, baud500: boolean, timeoutMs = 900): Promise<Uint8Array> {
    if (this.mode === "elm" && this.obdReady) {
      await this.transact(encodeText("ATSH6F1\r"), 400);
      await this.transact(encodeText("ATCRA612\r"), 400);
      this.obdReady = false;
      this.log("Headers restored to the DME.");
    }
    if (this.mode === "elm") {
      const hex = hexBytes(payload).replaceAll(" ", "");
      return this.transact(encodeText(`${hex}\r`), timeoutMs, true);
    }
    if (this.mode === "kwp") {
      const frame = kwpFrame(0x12, payload);
      const rx = await this.transact(frame, timeoutMs, true, true);
      return beyondEcho(frame, rx);
    }
    return this.transact(createIsoTpTelegram(0x6f1, 0x612, payload, baud500), timeoutMs, true, true);
  }

  async requestModule(target: number, payload: Uint8Array, timeoutMs = 280, fast = false): Promise<Uint8Array> {
    if (this.mode === "elm") throw new Error("Bus and chassis reads need the K-line lead that is already talking to the DME.");
    const frame = kwpFrame(target, payload);
    const rx = await this.transact(frame, timeoutMs, true, true, fast);
    const extra = beyondEcho(frame, rx);
    if (kwpBodies(extra).some((body) => body.kind === "ok")) this.mode = "kwp";
    return extra;
  }

  private async transact(bytes: Uint8Array, timeoutMs: number, quiet = false, releaseDtr = false, fast = false): Promise<Uint8Array> {
    const previous = this.gate;
    let release: () => void = () => undefined;
    this.gate = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.exchange(bytes, timeoutMs, quiet, releaseDtr, fast);
    } finally {
      release();
    }
  }

  private async exchange(bytes: Uint8Array, timeoutMs: number, quiet: boolean, releaseDtr: boolean, fast: boolean): Promise<Uint8Array> {
    const start = this.rx.length;
    if (!quiet) this.log(`TX ${hexBytes(bytes)}`);
    if (!this.writer) throw new Error("Port is not open.");
    if (releaseDtr && this.port.setSignals) {
      await this.port.setSignals({ dataTerminalReady: true, requestToSend: false });
    }
    await this.writer.write(bytes);
    if (releaseDtr && this.port.setSignals) {
      if (!this.port.direct) {
        const byteMs = Math.ceil((bytes.length * 10 * 1000) / this.baud) + (fast ? 1 : 3);
        await sleep(byteMs);
      }
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      if (!quiet) this.log("DTR released so the lead can answer.");
    }
    const deadline = Date.now() + timeoutMs;
    let last = start;
    let echoSince = 0;
    let lastByteAt = 0;
    while (Date.now() < deadline) {
      if (this.rx.length > last) {
        last = this.rx.length;
        lastByteAt = Date.now();
        const soFar = this.rx.subarray(start, this.rx.length);
        const extra = beyondEcho(bytes, soFar);
        if (extra.length > 0 && faultReady(extra)) {
          if (fast) break;
          await sleep(12);
          if (this.rx.length === last) break;
          continue;
        }
        if (fast) {
          await sleep(1);
          continue;
        }
        await sleep(30);
        if (echoOnly(bytes, this.rx.subarray(start))) {
          if (echoSince === 0) echoSince = Date.now();
          if (Date.now() - echoSince > 50) break;
        } else {
          echoSince = 0;
        }
      } else if (fast && last > start && lastByteAt > 0 && Date.now() - lastByteAt >= 8) {
        const extra = beyondEcho(bytes, this.rx.subarray(start));
        if (extra.length > 0) break;
        await sleep(1);
      } else {
        await sleep(fast ? 1 : 8);
      }
    }
    const slice = this.rx.subarray(start);
    if (!quiet) this.log(slice.length ? `RX ${hexBytes(slice)}` : "RX timeout");
    return slice;
  }

  private async stopIo(): Promise<void> {
    this.generation += 1;
    const reader = this.reader;
    const writer = this.writer;
    this.reader = null;
    this.writer = null;
    try {
      await reader?.cancel();
    } catch {
      /* already closed */
    }
    try {
      reader?.releaseLock();
    } catch {
      /* already released */
    }
    try {
      writer?.releaseLock();
    } catch {
      /* already released */
    }
    try {
      await this.port.close();
    } catch {
      /* already closed */
    }
  }

  private async pump(generation: number): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    while (!this.closed && generation === this.generation) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        break;
      }
      if (generation !== this.generation || this.closed) break;
      if (next.done) break;
      if (!next.value?.length) continue;
      const merged = new Uint8Array(this.rx.length + next.value.length);
      merged.set(this.rx, 0);
      merged.set(next.value, this.rx.length);
      this.rx = merged.length > 65536 ? merged.subarray(merged.length - 65536) : merged;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A 0x78 reply means the module is still reading. Wait for the real answer. */
function faultReady(extra: Uint8Array): boolean {
  const bodies = kwpBodies(extra);
  if (bodies.length === 0) return false;
  return bodies.some((body) => body.kind !== "nrc" || body.nrc !== 0x78);
}

function nrcOf(extra: Uint8Array, service: number): number | null {
  for (const body of kwpBodies(extra)) {
    if (body.kind === "nrc" && body.service === service && body.nrc !== 0x78) return body.nrc;
  }
  return null;
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeText(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function decodeText(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];
    text += value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : ".";
  }
  return text;
}
