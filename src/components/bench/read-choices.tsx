import { useEffect, useRef, useState } from "react";
import { CHANNELS } from "@/lib/msv/logger";
import { identifyText } from "@/lib/msv/identify";
import { downloadBytes } from "@/lib/msv/format";
import {
  CAL_BASE,
  CAL_SIZE,
  CHUNK,
  FULL_SIZE,
  PROGRAM_IDS,
  asciiFrom,
  describeNrc,
  identPayload,
  interpret,
  memoryPayload,
  rowsFromScalars,
  scalarByteLength,
  scalarFlashAddress,
  type ReadJob,
  type ScalarRow,
} from "@/lib/msv/read-job";
import { useSession } from "@/lib/msv/session";
import type { XdfScalar } from "@/lib/msv/xdf";
import { toIntelHex } from "@/lib/msv/parse";

const JOBS: { id: ReadJob; label: string; detail: string }[] = [
  { id: "programs", label: "Programs", detail: "0049 id only. No maps." },
  { id: "scalars", label: "Scalars", detail: "Single values. Uses a loaded XDF if you have one." },
  { id: "0da", label: "Calibration .0DA", detail: "Maps only, about 250 KB. Not the whole module." },
  { id: "bin", label: "Full .BIN", detail: "Whole module, about 2.5 MB." },
];

export function ReadChoices({
  scalars,
  regionSize,
  onOpenLogger,
  onCapture,
  onInspect,
  onLock,
}: {
  scalars: XdfScalar[];
  regionSize: number | null;
  onOpenLogger: () => void;
  onCapture: (name: string, bytes: Uint8Array) => void;
  onInspect: () => void;
  onLock: (locked: boolean) => void;
}) {
  const connected = useSession((state) => state.link !== null);
  const [job, setJob] = useState<ReadJob>("programs");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<ScalarRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; kind: string } | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    onLock(busy);
  }, [busy, onLock]);

  async function send(payload: Uint8Array) {
    const current = useSession.getState();
    if (!current.link) throw new Error("The lead is not open.");
    return current.link.requestDme(payload, current.can500);
  }

  async function readPrograms() {
    const parts: string[] = [];
    for (const id of PROGRAM_IDS) {
      if (stopRef.current) break;
      const rx = await send(identPayload(id));
      const hit = interpret(rx, 0x1a, null);
      if (hit.kind === "nrc") {
        if (id === 0x90) throw new Error(describeNrc(hit.nrc));
        continue;
      }
      if (hit.kind !== "ok") continue;
      const text = asciiFrom(hit.data);
      if (text) parts.push(text);
    }
    const joined = parts.join("\n");
    const identity = identifyText(joined);
    const nextRows: ScalarRow[] = identity.programs.map((program) => ({
      title: program.code,
      address: null,
      text: program.example,
    }));
    if (nextRows.length === 0 && joined) nextRows.push({ title: "Reply", address: null, text: joined });
    setRows(nextRows);
    const blob = new TextEncoder().encode(joined || "no program string");
    setFile({ name: "DME_programs.txt", bytes: blob, kind: "Program list only. Not a module read." });
    setNote(
      nextRows.length
        ? "Program strings only. This is not a full or partial flash."
        : "The DME answered identification, but there was no 0049 program string.",
    );
  }

  async function readScalars() {
    const live: ScalarRow[] = [];
    for (const channel of CHANNELS) {
      if (stopRef.current) break;
      const current = useSession.getState();
      if (!current.link) break;
      const pair = await current.link.readObd(channel.pid, current.can500);
      const value = pair ? channel.decode(pair.a, pair.b) : null;
      live.push({
        title: channel.name,
        address: null,
        text: value == null ? "no reply" : `${value.toFixed(channel.digits)} ${channel.unit}`,
      });
    }
    const words: Uint8Array[] = [];
    for (const scalar of scalars) {
      if (stopRef.current) break;
      const length = scalarByteLength(scalar.bits);
      const address = scalarFlashAddress(scalar.address, regionSize);
      const rx = await send(memoryPayload(address, length));
      const hit = interpret(rx, 0x23, length);
      if (hit.kind === "nrc") {
        setNote(describeNrc(hit.nrc));
        words.push(new Uint8Array());
        break;
      }
      words.push(hit.kind === "ok" ? hit.data : new Uint8Array());
    }
    const calibrated = rowsFromScalars(scalars.slice(0, words.length), regionSize, words);
    const nextRows = [...live, ...calibrated];
    setRows(nextRows);
    const text = nextRows.map((row) => `${row.title}\t${row.text}`).join("\n");
    setFile({ name: "DME_scalars.txt", bytes: new TextEncoder().encode(text), kind: "Scalar list. Not a module read." });
    setNote(
      scalars.length
        ? "Live values, then one-cell values from the loaded XDF. Maps are not in this file."
        : "Live values only. Load an XDF on Inspect to pull calibration scalars by address.",
    );
  }

  async function readImage(base: number, size: number, filename: string) {
    const image = new Uint8Array(size);
    image.fill(0xff);
    let got = 0;
    for (let offset = 0; offset < size; offset += CHUNK) {
      if (stopRef.current) break;
      const length = Math.min(CHUNK, size - offset);
      const rx = await send(memoryPayload(base + offset, length));
      const hit = interpret(rx, 0x23, length);
      if (hit.kind === "nrc") {
        setNote(describeNrc(hit.nrc));
        break;
      }
      if (hit.kind !== "ok") {
        setNote("No memory reply. Check D-CAN, ignition, and that this lead answers diagnostic requests.");
        break;
      }
      image.set(hit.data, offset);
      got += length;
      if (offset % (CHUNK * 8) === 0) setProgress({ done: got, total: size });
    }
    setProgress({ done: got, total: size });
    if (got === 0) return;
    const partial = got < size;
    const taken = image.subarray(0, got);
    const name = partial ? filename.replace(/(\.[^.]+)$/, "-partial$1") : filename;
    const download = name.endsWith(".0da") ? new TextEncoder().encode(toIntelHex(taken, base)) : taken;
    const kind = partial
      ? `Partial. ${got.toLocaleString()} of ${size.toLocaleString()} bytes. Do not treat this as a full module.`
      : base === 0
        ? "Full module, about 2.5 MB. Open it on Inspect before you trust it."
        : "Calibration only, about 250 KB. Not the whole module.";
    setFile({ name, bytes: download, kind });
    setNote(kind);
    onCapture(name.endsWith(".0da") ? name.replace(/\.0da$/, ".bin") : name, taken);
  }

  async function run() {
    if (!useSession.getState().link) return;
    stopRef.current = false;
    setBusy(true);
    setNote(null);
    setRows(null);
    setFile(null);
    setProgress(null);
    try {
      if (job === "programs") await readPrograms();
      else if (job === "scalars") await readScalars();
      else if (job === "0da") await readImage(CAL_BASE, CAL_SIZE, "DME_calibration.0da");
      else await readImage(0, FULL_SIZE, "DME_full.bin");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "The read stopped.");
    } finally {
      setBusy(false);
    }
  }

  function previewPrograms() {
    setRows([
      { title: "MI20S", address: null, text: "0049QK0MI20S" },
      { title: "Sample", address: null, text: "Not read from a car" },
    ]);
    setFile(null);
    setProgress(null);
    setNote("Sample program list, so you can see this view before the lead is on the DME.");
  }

  const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-medium">What to read</h2>
      <p className="mt-2 text-sm text-muted">
        A full module is about 2.5 MB. A calibration is about 250 KB of maps. Anything shorter is a partial read. This app does not write the DME.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-line px-3 py-2 text-left text-sm disabled:opacity-50"
          onClick={onOpenLogger}
        >
          <span className="font-medium">Logger</span>
          <span className="mt-0.5 block text-muted">Live data only. No module read.</span>
        </button>
        {JOBS.map((item) => {
          const selected = job === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={busy}
              aria-pressed={selected}
              className={
                selected
                  ? "rounded-lg border border-lamp bg-lamp-dim px-3 py-2 text-left text-sm disabled:opacity-50"
                  : "rounded-lg border border-line px-3 py-2 text-left text-sm disabled:opacity-50"
              }
              onClick={() => setJob(item.id)}
            >
              <span className="font-medium">{item.label}</span>
              <span className="mt-0.5 block text-muted">{item.detail}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!connected || busy}
          className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60"
          onClick={() => void run()}
        >
          {busy ? "Reading… stay on this page" : "Start this read"}
        </button>
        {busy ? (
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => (stopRef.current = true)}>
            Stop
          </button>
        ) : (
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={previewPrograms}>
            Preview program list
          </button>
        )}
      </div>
      {busy ? (
        <p className="mt-3 text-sm">
          The other sections are locked until this finishes. Closing the tab cuts the read off. Nothing is being written to the DME.
        </p>
      ) : null}
      {!connected ? <p className="mt-3 text-sm text-muted">Connect the lead first. The choice stays put until you do.</p> : null}
      {progress ? (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-lamp" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 font-mono text-xs text-muted">
            {percent}% · {progress.done.toLocaleString()} / {progress.total.toLocaleString()} bytes
          </p>
        </div>
      ) : null}
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
      {file ? (
        <div className="mt-3 rounded-lg border border-signal/40 bg-signal-dim px-3 py-3">
          <p className="text-sm font-medium">Ready on this computer</p>
          <p className="mt-1 font-mono text-sm">{file.name}</p>
          <p className="mt-1 text-sm text-muted">{file.kind}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg"
              onClick={() => downloadBytes(file.name, file.bytes, file.name.endsWith(".txt") || file.name.endsWith(".0da") ? "text/plain" : "application/octet-stream")}
            >
              Save {file.name}
            </button>
            <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={onInspect}>
              Open in Inspect
            </button>
          </div>
        </div>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto text-sm">
          {rows.map((row) => (
            <li key={`${row.title}-${row.text}`} className="flex items-baseline justify-between gap-3 border-b border-line py-1">
              <span>{row.title}</span>
              <span className="font-mono text-muted">
                {row.address != null ? `0x${row.address.toString(16).toUpperCase()} · ` : ""}
                {row.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
