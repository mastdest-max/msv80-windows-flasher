import { useEffect, useRef, useState } from "react";
import { Cable, CircleCheck, TriangleAlert } from "lucide-react";
import { describeIdentity, summarizeIdent } from "@/lib/msv/identify";
import { hexBytes, ignitionRequest } from "@/lib/msv/kdcan";
import { CableLink, baudOrder, portName, serialAccess, serialApi, type LineState, type ProbeKind, type SerialApi, type SerialPortLike } from "@/lib/msv/serial-session";
import { useSession } from "@/lib/msv/session";
import { E89Panel } from "@/components/bench/e89-panel";
import { desktopXhp, xhpWifiPort } from "@/lib/msv/wifi-port";

type LogLine = { id: number; text: string };

type LiveStatus = {
  ignitionOn: boolean | null;
  adapterType: number | null;
  adapterVersion: number | null;
  voltage: number | null;
  program: string | null;
  family: string | null;
  raw: Uint8Array | null;
  live: boolean;
  answered: boolean;
  note: string;
  clamp: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

async function moduleSweep(next: CableLink, push: (line: string) => void, fail: (message: string) => void): Promise<string> {
  push("Checking each module, DME first.");
  const report = await next.greetModules();
  if (report.lines.length === 0) return "";
  if (!report.dme) fail("The DME did not answer. Leave the ignition on and connect again.");
  return ` Modules: ${report.lines.join(", ")}.`;
}

export function CablePanel({ onCapture }: { onCapture: (name: string, bytes: Uint8Array) => void }) {
  const [api, setApi] = useState<SerialApi | null>(null);
  const [access, setAccess] = useState<"pending" | "ready" | "framed" | "browser" | "insecure">("pending");
  const [pageUrl, setPageUrl] = useState("");
  const [saved, setSaved] = useState<SerialPortLike[]>([]);
  const [link, setLink] = useState<CableLink | null>(null);
  const [baud, setBaud] = useState(115200);
  const [can500, setCan500] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    setAccess(serialAccess());
    setPageUrl(window.location.href);
    const next = serialApi();
    setApi(next);
    if (!next?.getPorts) return;
    void next.getPorts().then(setSaved).catch(() => setSaved([]));
  }, []);

  useEffect(() => {
    if (link) useSession.getState().updateCan(can500);
  }, [can500, link]);

  function push(text: string) {
    const id = nextId.current++;
    setLines((current) => [...current, { id, text }].slice(-60));
  }

  function openUsbWindow() {
    const opened = window.open(window.location.href, "_blank");
    if (!opened) {
      setError("The browser blocked the window. Allow popups, or copy the address below into a new Chrome or Edge tab.");
    }
  }

  async function connect(style: "kdcan" | "elm", existing?: SerialPortLike) {
    if (!api) return;
    setBusy(true);
    setError(null);
    let next: CableLink | null = null;
    try {
      const port = existing ?? (await api.requestPort());
      next = new CableLink(port, push);
      const order = style === "elm" ? baudOrder(38400) : baudOrder(baud);
      let probedKind: ProbeKind = "silent";
      let ignitionOn: boolean | null = null;
      let adapterType: number | null = null;
      let adapterVersion: number | null = null;
      let voltage: number | null = null;
      let rate = order[0];
      let clamp = "not reported";
      if (style === "elm") push("ELM327. The BMW K+DCAN handshake is not sent.");
      for (let index = 0; index < order.length; index++) {
        rate = order[index];
        if (index === 0) await next.open(rate);
        else await next.retune(rate);
        push(`Opened ${portName(port)} at ${rate}.`);
        const lineState = await next.lines();
        clamp = clampText(lineState);
        push(formatLines(lineState));
        if (lineState.dsr) push("DSR is on, so the lead can see the car clamp.");
        if (style === "elm") {
          const elm = await next.wakeElm();
          probedKind = elm ? "elm" : "silent";
          if (elm) break;
        } else {
          const probed = await next.probeAdapter();
          ignitionOn = probed.ignitionOn;
          adapterType = probed.adapterType;
          adapterVersion = probed.adapterVersion;
          voltage = probed.voltage;
          probedKind = probed.kind;
          if (probed.kind === "bmw" || probed.kind === "elm" || probed.kind === "echo" || probed.kind === "bytes") break;
          const elm = await next.sniffElm();
          if (elm) {
            probedKind = "elm";
            break;
          }
        }
        if (index < order.length - 1) push(`Nothing at ${rate}. Trying the next speed.`);
      }
      setBaud(rate);
      setLink(next);
      useSession.getState().attach(next, can500, portName(port));
      let program: string | null = null;
      let family: string | null = null;
      let raw: Uint8Array | null = null;
      let note = noteFor(probedKind, clamp);
      if (probedKind === "echo" || probedKind === "bytes") {
        const asked = await next.askDme(can500);
        if (!asked.echoed) {
          raw = asked.raw;
          const summary = summarizeIdent(asked.raw);
          program = summary.title;
          family = summary.family ?? "not in these services";
          ignitionOn = true;
          const volts = await next.moduleVoltage();
          if (volts != null) voltage = Math.round(volts * 10);
          probedKind = "bmw";
          note = `${summary.note} Ignition is on because the DME answered. ${
            volts != null
              ? `Module voltage ${volts.toFixed(1)} V was read from the DME, not from the lead.`
              : "This lead does not report its own voltage, and the DME did not return module voltage on the OBD request."
          }`;
        }
      }
      if (probedKind === "elm") {
        const result = await next.identifyDme(can500);
        raw = result.raw;
        const described = describeIdentity(result.text);
        program = described.program;
        family = described.family;
        note = described.hasProgram
          ? "ELM327 identification only. The rest of the flash is not in this buffer."
          : described.program
            ? `The ELM327 answered. Identification came back as ${described.program}.`
            : "The ELM327 answered, but there is no readable identification. The raw reply is in the traffic list.";
      }
      note += await moduleSweep(next, push, setError);
      setStatus({
        ignitionOn,
        adapterType,
        adapterVersion,
        voltage,
        program,
        family,
        raw,
        live: true,
        answered: probedKind === "bmw" || probedKind === "elm",
        clamp,
        note,
      });
    } catch (err) {
      try {
        await next?.close();
      } catch {
        /* port never opened */
      }
      const message = err instanceof Error ? err.message : "Could not open the cable.";
      if (/security|permissions policy|not allowed/i.test(message)) {
        setAccess("framed");
        setError("This window is not allowed to open USB. Use Open USB window, then connect there.");
      } else if (!/cancel|aborted|no port/i.test(message)) {
        setError(
          /already open|network|in use|busy|access denied|failed to open/i.test(message)
            ? "The lead is already open in another program. Close INPA, unplug the USB plug, plug it back in, and connect again."
            : message,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function connectWifi() {
    setBusy(true);
    setError(null);
    let next: CableLink | null = null;
    try {
      push("Opening the xHP adapter port.");
      next = new CableLink(xhpWifiPort(push), push);
      await next.open(115200);
      const probed = await next.probeAdapter();
      let kind = probed.kind;
      if (kind === "silent") {
        const elm = await next.sniffElm();
        if (elm) kind = "elm";
      }
      setLink(next);
      useSession.getState().attach(next, can500, "xHP Wi-Fi");
      let program: string | null = null;
      let family: string | null = null;
      let raw: Uint8Array | null = null;
      let ignitionOn = probed.ignitionOn;
      let voltage = probed.voltage;
      let note = noteFor(kind, "Wi-Fi");
      if (kind === "echo" || kind === "bytes") {
        const asked = await next.askDme(can500);
        if (!asked.echoed) {
          raw = asked.raw;
          const summary = summarizeIdent(asked.raw);
          program = summary.title;
          family = summary.family ?? "not in these services";
          ignitionOn = true;
          const volts = await next.moduleVoltage();
          if (volts != null) voltage = Math.round(volts * 10);
          kind = "bmw";
          note = summary.note;
        }
      }
      if (kind === "elm") {
        const result = await next.identifyDme(can500);
        raw = result.raw;
        const described = describeIdentity(result.text);
        program = described.program;
        family = described.family;
        note = described.program
          ? `The xHP adapter answered as an ELM-style port. ${described.program}.`
          : "The xHP adapter answered, but there is no readable identification yet.";
      }
      note += await moduleSweep(next, push, setError);
      setStatus({
        ignitionOn,
        adapterType: probed.adapterType,
        adapterVersion: probed.adapterVersion,
        voltage,
        program,
        family,
        raw,
        live: true,
        answered: kind === "bmw" || kind === "elm",
        clamp: "Wi-Fi",
        note,
      });
    } catch (err) {
      try {
        await next?.close();
      } catch {
        /* socket never opened */
      }
      setError(err instanceof Error ? err.message : "The xHP adapter did not open.");
    } finally {
      setBusy(false);
    }
  }

  async function identify() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const result = await link.identifyDme(can500);
      const summary = summarizeIdent(result.raw);
      const fallback = describeIdentity(result.text);
      const volts = await link.moduleVoltage();
      setStatus((current) => ({
        ignitionOn: true,
        adapterType: current?.adapterType ?? null,
        adapterVersion: current?.adapterVersion ?? null,
        voltage: volts != null ? Math.round(volts * 10) : (current?.voltage ?? null),
        program: summary.title ?? fallback.program,
        family: summary.family ?? fallback.family ?? "not in these services",
        raw: result.raw,
        live: true,
        answered: true,
        clamp: current?.clamp ?? "not reported",
        note: summary.note,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Identification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await link?.close();
    } finally {
      setLink(null);
      useSession.getState().detach();
      setBusy(false);
    }
  }

  function previewSample() {
    const ignition = ignitionRequest();
    const ident = new Uint8Array(24);
    const text = "0049QK0MI20SMVCAS";
    for (let i = 0; i < text.length; i++) ident[i] = text.charCodeAt(i);
    push("Sample reply, not a live cable.");
    push(`TX ${hexBytes(ignition)}`);
    setStatus({
      ignitionOn: true,
      adapterType: 0x0002,
      adapterVersion: 0x000a,
      voltage: 126,
      program: "MI20S · 0049QK0MI20SMVCAS",
      family: "MSV80 · N52N / N52K",
      raw: ident,
      live: false,
      answered: false,
      clamp: "not reported",
      note: "Sample reply only, so you can see the layout. Nothing was read from a car.",
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="flex flex-col gap-3 lg:col-span-3">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <Cable className="size-4 text-lamp" aria-hidden="true" />
            <h2 className="font-medium">K+DCAN</h2>
          </div>
          <p className="mt-2 text-sm text-muted">
            Opens the USB serial port on a K+DCAN lead. The processor in the plug only runs when the OBD end is in the car.
          </p>
          {access === "framed" ? (
            <div className="mt-3 rounded-lg border border-lamp/40 bg-lamp-dim px-3 py-2 text-sm">
              <p>
                This view is embedded, so the browser will not hand it the USB lead. Open a standalone window, then press Connect there. The list will not say COM1. Use Chrome or Edge on the computer the lead is plugged into.
              </p>
              {pageUrl ? <p className="mt-2 break-all font-mono text-xs">{pageUrl}</p> : null}
            </div>
          ) : null}
          {access === "browser" ? (
            <p className="mt-3 rounded-lg border border-lamp/40 bg-lamp-dim px-3 py-2 text-sm">
              This browser cannot open a USB serial lead. Use Chrome or Edge on a computer. Firefox and phones cannot.
            </p>
          ) : null}
          {access === "insecure" ? (
            <p className="mt-3 rounded-lg border border-lamp/40 bg-lamp-dim px-3 py-2 text-sm">
              This page is not a secure page, so the browser hides USB devices. Open it in Chrome or Edge over https.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted" htmlFor="cable-baud">
              Baud
            </label>
            <select
              id="cable-baud"
              className="h-11 rounded-md border border-line bg-bg px-2 text-sm"
              value={baud}
              disabled={link !== null || busy}
              onChange={(event) => setBaud(Number(event.target.value))}
            >
              <option value={115200}>115200</option>
              <option value={38400}>38400</option>
              <option value={9600}>9600</option>
            </select>
            <label className="ml-2 flex h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={can500}
                disabled={busy}
                onChange={(event) => setCan500(event.target.checked)}
              />
              D-CAN 500 kbit
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {link ? (
              <>
                <button type="button" disabled={busy} className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60" onClick={() => void identify()}>
                  Read identification
                </button>
                <button type="button" disabled={busy} className="h-11 rounded-md border border-line px-3 text-sm disabled:opacity-60" onClick={() => void disconnect()}>
                  Disconnect
                </button>
              </>
            ) : access === "framed" ? (
              <button type="button" className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg" onClick={openUsbWindow}>
                Open USB window
              </button>
            ) : saved.length > 0 ? (
              <>
                <button type="button" disabled={busy} className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60" onClick={() => void connect("kdcan", saved[0])}>
                  {busy ? "Looking for the lead…" : "Open allowed lead"}
                </button>
                <button type="button" disabled={busy} className="h-11 rounded-md border border-line px-3 text-sm disabled:opacity-60" onClick={() => void connect("elm", saved[0])}>
                  ELM327 on this lead
                </button>
                <button type="button" disabled={busy} className="h-11 rounded-md border border-line px-3 text-sm disabled:opacity-60" onClick={() => void connect("kdcan")}>
                  Choose another lead
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={!api || busy || access === "pending"} className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60" onClick={() => void connect("kdcan")}>
                  {busy ? "Looking for the lead…" : access === "pending" ? "Checking USB…" : "Connect K+DCAN"}
                </button>
                <button type="button" disabled={!api || busy || access === "pending"} className="h-11 rounded-md border border-line px-3 text-sm disabled:opacity-60" onClick={() => void connect("elm")}>
                  Connect ELM327
                </button>
              </>
            )}
            <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={previewSample}>
              Preview a sample reply
            </button>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-sm font-medium">xHP Wi-Fi</h3>
            {desktopXhp() ? (
              <p className="mt-2 text-sm text-muted">
                Join the adapter Wi-Fi, then press Connect. This app opens the adapter port itself and tries again if Windows is still switching networks. Turn off Connect automatically on your home Wi-Fi so Windows stays on the adapter.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Chrome cannot open the adapter port itself. Download the bridge again, stop the old window with Ctrl+C, and run py xhp-bridge.py. Windows will leave this Wi-Fi because it has no internet. Turn off Connect automatically on your home Wi-Fi, then join the adapter and leave the scanner plugged in.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {desktopXhp() ? null : (
                <a className="inline-flex h-11 items-center rounded-md border border-line px-3 text-sm" href="/xhp-bridge.py" download="xhp-bridge.py">
                  Download bridge
                </a>
              )}
              {link ? null : (
                <button
                  type="button"
                  disabled={busy}
                  className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60"
                  onClick={() => void connectWifi()}
                >
                  {busy ? "Opening the adapter port…" : "Connect xHP Wi-Fi"}
                </button>
              )}
            </div>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {error?.includes("copy the address") && pageUrl ? (
            <p className="mt-2 break-all font-mono text-xs text-muted">{pageUrl}</p>
          ) : null}
        </div>

        {status ? <StatusCard status={status} onCapture={onCapture} /> : null}
        <E89Panel hint={`${status?.program ?? ""} ${status?.family ?? ""} ${status?.raw ? new TextDecoder("latin1").decode(status.raw) : ""}`} />

        <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium">Traffic</h3>
          {lines.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing sent yet.</p>
          ) : (
            <ol className="mt-2 flex max-h-72 flex-col gap-1 overflow-auto font-mono text-xs leading-5">
              {lines.map((line) => (
                <li key={line.id} className="break-all text-muted">
                  {line.text}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <aside className="flex flex-col gap-3 lg:col-span-2">
        <div className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">
          <h3 className="font-medium text-fg">Before you connect</h3>
          <ul className="mt-2 flex flex-col gap-2">
            <li>If this page is embedded, Open USB window first. Connect only works in that standalone Chrome or Edge window. The device will not be named COM1.</li>
            <li>Close INPA before connecting. Two programs cannot hold the same lead.</li>
            <li>The OBD plug stays in the car with ignition on. This lead echoes adapter status and only answers after the transmit line is released.</li>
            <li>Switch the lead to D-CAN, not K-line. Ignition on, engine off.</li>
            <li>For the xHP adapter, join its Wi-Fi, leave the scanner plugged in, and press Connect xHP Wi-Fi. The Windows app opens that port itself.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function StatusCard({
  status,
  onCapture,
}: {
  status: LiveStatus;
  onCapture: (name: string, bytes: Uint8Array) => void;
}) {
  const voltageText = status.voltage !== null ? `${(status.voltage / 10).toFixed(1)} V` : "not reported";
  const linked = Boolean(status.program) || status.answered;
  return (
    <div className={cx("rounded-lg border px-4 py-3", status.live && linked ? "border-signal/40 bg-signal-dim" : "border-lamp/40 bg-lamp-dim")}>
      <div className="flex items-center gap-2">
        {status.live && linked ? (
          <CircleCheck className="size-4 text-signal" aria-hidden="true" />
        ) : (
          <TriangleAlert className="size-4 text-lamp" aria-hidden="true" />
        )}
        <h3 className="font-semibold">{status.program ?? (status.answered ? "Lead answered" : "No answer from the lead")}</h3>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted">Ignition</dt>
          <dd>{status.ignitionOn === null ? "unknown" : status.ignitionOn ? "on" : "off"}</dd>
        </div>
        <div>
          <dt className="text-muted">Adapter</dt>
          <dd className="font-mono">
            {status.adapterVersion === null
              ? "unknown"
              : `${status.adapterType?.toString(16) ?? "?"} / ${status.adapterVersion.toString(16)}`}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Clamp</dt>
          <dd>{status.clamp}</dd>
        </div>
        <div>
          <dt className="text-muted">Voltage</dt>
          <dd>{voltageText}</dd>
        </div>
        <div>
          <dt className="text-muted">Family</dt>
          <dd>{status.family ?? "unknown"}</dd>
        </div>
      </dl>
      <p className="mt-2 text-sm">{status.note}</p>
      {status.raw && status.program ? (
        <button
          type="button"
          className="mt-3 h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg"
          onClick={() => onCapture("KDCAN_identification.bin", status.raw as Uint8Array)}
        >
          Open this reply in Inspect
        </button>
      ) : null}
    </div>
  );
}

function clampText(lines: LineState): string {
  if (lines.dsr === null) return "not reported";
  return lines.dsr ? "on" : "off";
}

function formatLines(lines: LineState): string {
  const bit = (value: boolean | null) => (value === null ? "n/a" : value ? "on" : "off");
  return `Lines DSR ${bit(lines.dsr)} CTS ${bit(lines.cts)} DCD ${bit(lines.dcd)} RI ${bit(lines.ri)}`;
}

function noteFor(kind: ProbeKind, clamp: string): string {
  if (kind === "bmw") return "The lead answered the BMW handshake. Identification is the next step. This is not a flash.";
  if (kind === "elm") return "ELM327-style lead. It answered. Read identification next.";
  if (kind === "echo") {
    return `Clamp is ${clamp}, so the car side is already connected. The lead repeated each command and added nothing. That is a stock INPA FTDI lead: the serial port hears itself, and those bytes never reached the DME.`;
  }
  if (kind === "bytes") return "The lead sent bytes, but not a BMW or ELM handshake. The raw bytes are in the traffic list.";
  return `The USB port is open, but nothing came back. Clamp is ${clamp}. Switch the lead to D-CAN, ignition on, and close INPA if it still has the port.`;
}
