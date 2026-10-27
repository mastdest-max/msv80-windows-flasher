/** BMW K+DCAN adapter telegrams, as used by the open EDIABAS-style cable firmware. */

export const DME_TX_ID = 0x6f1;
export const DME_RX_ID = 0x612;

export function bmwChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i]) & 0xff;
  return sum;
}

export function withChecksum(body: number[]): Uint8Array {
  const out = Uint8Array.from(body);
  out[out.length - 1] = bmwChecksum(out.subarray(0, out.length - 1));
  return out;
}

export function ignitionRequest(): Uint8Array {
  return withChecksum([0x82, 0xf1, 0xf1, 0xfe, 0xfe, 0x00]);
}

export function versionRequest(): Uint8Array {
  return withChecksum([0x82, 0xf1, 0xf1, 0xfd, 0xfd, 0x00]);
}

export function voltageRequest(): Uint8Array {
  return withChecksum([0x82, 0xf1, 0xf1, 0xfc, 0xfc, 0x00]);
}

export function hexBytes(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i++) {
    if (i) text += " ";
    text += bytes[i].toString(16).toUpperCase().padStart(2, "0");
  }
  return text;
}

/** Find an echoed request plus a checksummed reply of `respLen` bytes. */
export function parseEchoReply(sent: Uint8Array, rx: Uint8Array, respLen: number): Uint8Array | null {
  const need = sent.length + respLen;
  for (let i = 0; i + need <= rx.length; i++) {
    let echo = true;
    for (let j = 0; j < sent.length; j++) {
      if (rx[i + j] !== sent[j]) {
        echo = false;
        break;
      }
    }
    if (!echo) continue;
    const reply = rx.subarray(i + sent.length, i + need);
    if (bmwChecksum(reply.subarray(0, respLen - 1)) !== reply[respLen - 1]) continue;
    return reply;
  }
  return null;
}

export type AdapterStatus = {
  ignitionOn: boolean | null;
  adapterType: number | null;
  adapterVersion: number | null;
  voltage: number | null;
};

export function readIgnition(reply: Uint8Array): boolean | null {
  if (reply.length < 6 || reply[3] !== 0xfe) return null;
  return (reply[4] & 0x01) === 0x01;
}

export function readVersion(reply: Uint8Array): { type: number; version: number } | null {
  if (reply.length < 9) return null;
  return {
    type: reply[5] + (reply[4] << 8),
    version: reply[7] + (reply[6] << 8),
  };
}

export function readVoltageByte(reply: Uint8Array): number | null {
  if (reply.length < 6 || reply[3] !== 0xfc) return null;
  return reply[4];
}

/** ISO-TP telegram, adapter firmware 0x0009 or newer (telegram type 0x03). */
export function createIsoTpTelegram(txId: number, rxId: number, payload: Uint8Array, baud500 = true): Uint8Array {
  const out = new Uint8Array(payload.length + 14);
  out[0] = 0x00;
  out[1] = 0x03;
  out[2] = 0x02;
  out[3] = baud500 ? 0x01 : 0x09;
  out[4] = 0x03;
  out[7] = (txId >> 8) & 0xff;
  out[8] = txId & 0xff;
  out[9] = (rxId >> 8) & 0xff;
  out[10] = rxId & 0xff;
  out[11] = (payload.length >> 8) & 0xff;
  out[12] = payload.length & 0xff;
  out.set(payload, 13);
  out[out.length - 1] = bmwChecksum(out.subarray(0, out.length - 1));
  return out;
}

/** KWP2000 ReadECUIdentification to the DME (address 0x12, local id 0x90). */
export function dmeIdentPayload(): Uint8Array {
  return Uint8Array.of(0x12, 0x1a, 0x90);
}

export function extractAscii(bytes: Uint8Array): string {
  let text = "";
  let run = "";
  const flush = () => {
    if (run.length >= 4) text += `${run}\n`;
    run = "";
  };
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];
    if (value >= 0x20 && value < 0x7f) run += String.fromCharCode(value);
    else flush();
  }
  flush();
  return text;
}

/** Reply to an adapter status telegram, with or without the cable echoing the request. */
export function findAdapterReply(sent: Uint8Array, rx: Uint8Array, respLen: number, marker: number): Uint8Array | null {
  const echoed = parseEchoReply(sent, rx, respLen);
  if (echoed) return echoed;
  for (let i = 0; i + respLen <= rx.length; i++) {
    if (rx[i] !== 0x82 || rx[i + 1] !== 0xf1 || rx[i + 2] !== 0xf1 || rx[i + 3] !== marker) continue;
    const reply = rx.subarray(i, i + respLen);
    if (bmwChecksum(reply.subarray(0, respLen - 1)) !== reply[respLen - 1]) continue;
    let own = reply.length === sent.length;
    if (own) {
      for (let j = 0; j < sent.length; j++) {
        if (reply[j] !== sent[j]) {
          own = false;
          break;
        }
      }
    }
    if (own) continue;
    return reply;
  }
  return null;
}

/** Bytes after a leading copy of what we sent. Empty when the lead only echoed. */
export function beyondEcho(sent: Uint8Array, rx: Uint8Array): Uint8Array {
  if (rx.length < sent.length) return rx;
  for (let i = 0; i < sent.length; i++) {
    if (rx[i] !== sent[i]) return rx;
  }
  return rx.subarray(sent.length);
}

export function echoOnly(sent: Uint8Array, rx: Uint8Array): boolean {
  return rx.length === sent.length && beyondEcho(sent, rx).length === 0;
}

export function kwpFrame(target: number, payload: Uint8Array, source = 0xf1): Uint8Array {
  return addressedFrame(0x80, target, payload, source);
}

/** OBD functional request, target 0x33, so mode 01 is not sent as a DME local service. */
export function kwpObd(payload: Uint8Array, source = 0xf1): Uint8Array {
  return addressedFrame(0xc0, 0x33, payload, source);
}

function addressedFrame(kind: number, target: number, payload: Uint8Array, source: number): Uint8Array {
  if (payload.length > 255) throw new Error("That block is longer than one K-line frame.");
  if (payload.length > 63) {
    const body = new Array<number>(payload.length + 5);
    body[0] = kind;
    body[1] = target & 0xff;
    body[2] = source & 0xff;
    body[3] = payload.length;
    for (let i = 0; i < payload.length; i++) body[4 + i] = payload[i];
    body[body.length - 1] = 0;
    return withChecksum(body);
  }
  const body = new Array<number>(payload.length + 4);
  body[0] = kind | (payload.length & 0x3f);
  body[1] = target & 0xff;
  body[2] = source & 0xff;
  for (let i = 0; i < payload.length; i++) body[3 + i] = payload[i];
  body[body.length - 1] = 0;
  return withChecksum(body);
}

export type KwpBody =
  | { kind: "ok"; service: number; data: Uint8Array }
  | { kind: "nrc"; service: number; nrc: number };

/** Checksummed KWP frames. A format length of 0 means the next byte is the length. */
export function kwpBodies(rx: Uint8Array): KwpBody[] {
  const out: KwpBody[] = [];
  for (let i = 0; i + 5 <= rx.length; i++) {
    const format = rx[i];
    if ((format & 0x80) === 0) continue;
    let length = format & 0x3f;
    let dataAt = i + 3;
    if (length === 0) {
      if (i + 6 > rx.length) continue;
      length = rx[i + 3];
      dataAt = i + 4;
    }
    if (length < 1 || length > 255) continue;
    const end = dataAt + length + 1;
    if (end > rx.length) continue;
    const frame = rx.subarray(i, end);
    if (bmwChecksum(frame.subarray(0, frame.length - 1)) !== frame[frame.length - 1]) continue;
    const field = rx.subarray(dataAt, dataAt + length);
    if (field[0] === 0x7f && field.length >= 3) out.push({ kind: "nrc", service: field[1], nrc: field[2] });
    else out.push({ kind: "ok", service: field[0], data: field.subarray(1) });
    i = end - 1;
  }
  return out;
}

export function dmeKwpIdent(): Uint8Array {
  return kwpFrame(0x12, Uint8Array.of(0x1a, 0x90));
}

export function looksLikeElm(text: string): boolean {
  return /ELM327|ELM32|OBDLink|STN11|\bOK\b|>/i.test(text);
}

export const ELM_SETUP = [
  "ATZ",
  "ATE0",
  "ATL0",
  "ATS0",
  "ATH1",
  "ATSP6",
  "ATSH6F1",
  "ATCRA612",
  "ATFCSH6F1",
  "ATFCSM1",
];

export const ELM_IDENT = "121A90";
