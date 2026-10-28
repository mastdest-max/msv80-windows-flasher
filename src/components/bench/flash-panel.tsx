import { useMemo, useState } from "react";
import { formatAddress, formatBytes } from "@/lib/msv/format";
import { flashSpans, type FlashProgress } from "@/lib/msv/flash-job";
import { parseIntelHex, type IntelImage } from "@/lib/msv/intel-hex";
import { CAL_BASE, CAL_SIZE, FULL_SIZE } from "@/lib/msv/read-job";
import { rsaDeleteUrl, RSA_PROGRAM } from "@/lib/msv/security-access";
import { useSession } from "@/lib/msv/session";
import { parseWinkfpControl, type WinkfpControl } from "@/lib/msv/winkfp-job";

const FAMILIES = ["MSV80", "MSV80.1", "MSV70"] as const;

type Loaded = {
  name: string;
  image: IntelImage;
};

export function FlashPanel({ onLock }: { onLock?: (locked: boolean) => void }) {
  const link = useSession((state) => state.link);
  const can500 = useSession((state) => state.can500);
  const lead = useSession((state) => state.lead);
  const [family, setFamily] = useState<(typeof FAMILIES)[number]>("MSV80");
  const [kind, setKind] = useState<"0pa" | "0da">("0pa");
  const [control, setControl] = useState<WinkfpControl | null>(null);
  const [program, setProgram] = useState<Loaded | null>(null);
  const [calibration, setCalibration] = useState<Loaded | null>(null);
  const [typed, setTyped] = useState("");
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = kind === "0pa" ? program : calibration;
  const reference = selected?.image.reference ?? "";
  const ready = Boolean(link && selected && armed && reference && typed.trim().toUpperCase() === reference.toUpperCase() && !busy);

  const summary = useMemo(() => {
    if (!selected) return null;
    const first = selected.image.spans[0];
    const last = selected.image.spans[selected.image.spans.length - 1];
    const end = last.address + last.bytes.length - 1;
    return { first, end, spans: selected.image.spans.length, bytes: selected.image.bytes, skipped: selected.image.skipped };
  }, [selected]);

  async function onFiles(list: FileList | File[]) {
    setError(null);
    setDone(null);
    for (const file of list) {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith(".bin")) {
          const data = new Uint8Array(await file.arrayBuffer());
          const calibrationFile = data.length === CAL_SIZE;
          const full = data.length === FULL_SIZE;
          if (!calibrationFile && !full) {
            setError(`${file.name} is ${data.length.toLocaleString()} bytes. Only a full module or a calibration is written back. A shorter file stays a partial read.`);
            continue;
          }
          const image: IntelImage = {
            reference: file.name.replace(/\.[^.]+$/, ""),
            spans: [{ address: calibrationFile ? CAL_BASE : 0, bytes: data }],
            bytes: data.length,
            skipped: 0,
          };
          if (calibrationFile) setCalibration({ name: file.name, image });
          else setProgram({ name: file.name, image });
          continue;
        }
        const text = await file.text();
        if (lower.endsWith(".ctl") || lower.endsWith(".bat")) {
          if (lower.endsWith(".ctl") || text.includes("MF_PROGRAMM_DATEI") || text.includes("MF_SG_ADR")) {
            setControl(parseWinkfpControl(text));
          }
          continue;
        }
        const image = parseIntelHex(text);
        const loaded = { name: file.name, image };
        if (lower.endsWith(".0da") || lower.endsWith(".0da.txt")) setCalibration(loaded);
        else setProgram(loaded);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That file could not be read.");
      }
    }
  }

  async function write() {
    if (!link || !selected) return;
    setBusy(true);
    setError(null);
    setDone(null);
    onLock?.(true);
    try {
      await flashSpans(link, can500, selected.image.spans, setProgress);
      setDone(`${selected.name} was written. Turn the ignition off, then back on, before you try to start the engine.`);
      setProgress(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The write stopped.");
    } finally {
      setBusy(false);
      onLock?.(false);
    }
  }

  async function loadBypass() {
    setError(null);
    setDone(null);
    try {
      const response = await fetch(rsaDeleteUrl());
      if (!response.ok) throw new Error("The security bypass file is not in this copy of the app.");
      const image = parseIntelHex(await response.text());
      setProgram({ name: RSA_PROGRAM + ".0pa", image });
      setKind("0pa");
      setFamily("MSV80");
      setControl({ program: RSA_PROGRAM + ".0pa", calibration: null, address: 0x12, prg: "12MSV80.prg", ipo: "12msv80.ipo" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The security bypass did not load.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-danger/40 bg-surface p-4">
        <h2 className="font-medium">Write the DME</h2>
        <p className="mt-2 text-sm text-muted">
          This sends a WinKFP program or calibration to the engine module on the lead that is already open. A full BIN read asks for security first. If the DME is locked, load the security bypass here, then write a tune or a stock file. The car will not start if the bypass is the only file written. Ignition on, engine off, charger connected.
        </p>
        <button type="button" className="mt-3 h-11 rounded-md border border-line px-3 text-sm" disabled={busy} onClick={() => void loadBypass()}>
          Load the MSV80 security bypass
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Family
          <select className="h-11 rounded-md border border-line bg-surface px-2" value={family} disabled={busy} onChange={(event) => setFamily(event.target.value as (typeof FAMILIES)[number])}>
            {FAMILIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          What to write
          <select className="h-11 rounded-md border border-line bg-surface px-2" value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as "0pa" | "0da")}>
            <option value="0pa">Program .0PA</option>
            <option value="0da">Calibration .0DA</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Module address
          <input className="h-11 rounded-md border border-line bg-bg px-2 font-mono" readOnly value={`0x${(control?.address ?? 0x12).toString(16)}`} />
        </label>
      </div>

      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center">
        <span className="font-medium">Drop the .ctl, .0PA, .0DA, or a full .BIN</span>
        <span className="text-sm text-muted">A full module or a calibration can be written back. A shorter file is kept as a partial read.</span>
        <input
          className="sr-only"
          type="file"
          multiple
          accept=".ctl,.0pa,.0da,.hex,.bat,.bin"
          disabled={busy}
          onChange={(event) => {
            const list = event.target.files;
            if (list) void onFiles(list);
            event.target.value = "";
          }}
        />
      </label>

      <div className="rounded-lg border border-line bg-surface p-4 text-sm">
        <p>{lead ? `Lead: ${lead}` : "No lead yet. Open Cable and connect first."}</p>
        <p className="mt-1">Family {family}. {control?.prg ? `PRG ${control.prg}. ` : ""}{control?.ipo ? `IPO ${control.ipo}.` : "No .ctl loaded."}</p>
        {control?.program ? <p className="mt-1 font-mono text-xs">Program named in the control file: {control.program}</p> : null}
        {program ? <p className="mt-2">Program file {program.name}{program.image.reference ? ` · ${program.image.reference}` : ""}</p> : <p className="mt-2 text-muted">No program file yet.</p>}
        {calibration ? <p>Calibration file {calibration.name}{calibration.image.reference ? ` · ${calibration.image.reference}` : ""}</p> : null}
        {summary ? (
          <p className="mt-2">
            {summary.spans} blocks, {formatBytes(summary.bytes)}, {formatAddress(summary.first.address)} through {formatAddress(summary.end)}.
            {summary.skipped ? ` ${formatBytes(summary.skipped)} of blank 0xFF was left out.` : ""}
          </p>
        ) : null}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={armed} disabled={busy} onChange={(event) => setArmed(event.target.checked)} />
        <span>The charger is connected, the ignition is on, and the engine is not running.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Type the program id from the file{reference ? ` (${reference})` : ""} to arm the write
        <input
          className="h-11 rounded-md border border-line bg-bg px-3 font-mono"
          value={typed}
          disabled={busy || !reference}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
        />
      </label>

      <button type="button" className="h-11 rounded-md bg-danger px-3 text-sm font-medium text-bg disabled:opacity-50" disabled={!ready} onClick={() => void write()}>
        {busy ? "Writing. Stay on this window." : `Write ${kind === "0pa" ? "program" : "calibration"} to the ${family}`}
      </button>

      {progress ? (
        <p className="text-sm">
          {progress.phase} {progress.total ? `${Math.floor((progress.sent / progress.total) * 100)}%` : ""}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-danger/50 bg-surface px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="rounded-lg border border-signal/40 bg-signal-dim px-3 py-2 text-sm">{done}</p> : null}
    </div>
  );
}
