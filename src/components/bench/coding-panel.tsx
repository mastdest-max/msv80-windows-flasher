import { useEffect, useMemo, useState } from "react";
import { downloadBytes } from "@/lib/msv/format";
import { SAMPLE_TRACE, type CodingRow } from "@/lib/msv/modules";
import { NCS_CHASSIS, modulesBySection, ncsChassis, type NcsModule } from "@/lib/msv/ncs-chassis";
import { backupNettodata, codingBytesFromRead, codingTarget, exportNettodata, identBytes, nrcText, parseNettodataBlock, responseNrc, responseOk, traceRows } from "@/lib/msv/ncs-code";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { useSession } from "@/lib/msv/session";

function sameModule(traceName: string, moduleId: string) {
  const left = traceName.toUpperCase();
  const right = moduleId.toUpperCase();
  if (left === right) return true;
  if (left.length >= 3 && (right.startsWith(left) || left.startsWith(right))) return true;
  return false;
}

function wordsUrl() {
  const prefix = typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
  return `${prefix}/ncs-words.json`;
}

function speak(words: Record<string, string>, token: string) {
  return words[token.toUpperCase()] ?? token;
}

function moduleLabel(item: NcsModule) {
  return item.sgbd.toUpperCase() === item.id.toUpperCase() ? item.id : `${item.sgbd} · ${item.id}`;
}

export function CodingPanel({ onLock }: { onLock?: (locked: boolean) => void }) {
  const connected = useSession((state) => state.link !== null);
  const [text, setText] = useState(SAMPLE_TRACE);
  const [chassisId, setChassisId] = useState("E60");
  const [moduleKey, setModuleKey] = useState("KOMBI");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [words, setWords] = useState<Record<string, string>>({});
  const chassis = ncsChassis(chassisId);
  const selected: NcsModule = chassis.modules.find((item) => item.key === moduleKey) ?? chassis.modules[0];
  const moduleNames = useMemo(() => NCS_CHASSIS.flatMap((item) => item.modules.map((mod) => mod.id)), []);
  const rows = useMemo(() => traceRows(text, moduleNames), [text, moduleNames]);
  const block = useMemo(() => parseNettodataBlock(text), [text]);
  const target = selected ? codingTarget(selected.id, selected.sgbd) : null;
  const mine = useMemo(() => rows.filter((row) => sameModule(row.module, selected.id)), [rows, selected.id]);
  const shown = mine.filter((row) => {
    const needle = query.trim().toUpperCase();
    if (!needle) return true;
    return row.name.includes(needle) || speak(words, row.name).toUpperCase().includes(needle) || row.value.toUpperCase().includes(needle);
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetch(wordsUrl(), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : {}))
      .then((body: Record<string, string>) => setWords(body))
      .catch(() => setWords({}));
    return () => controller.abort();
  }, []);

  function pickChassis(next: string) {
    const car = ncsChassis(next);
    setChassisId(car.id);
    setModuleKey(car.modules[0]?.key ?? "");
    setEdits({});
  }

  function valueOf(row: CodingRow) {
    return edits[`${row.module}|${row.name}`] ?? row.value;
  }

  function exportTrace(kind: "fsw" | "netto") {
    const body = exportNettodata(rows, valueOf, kind === "netto" ? block : { localId: null, bytes: null });
    const name = kind === "netto" ? "NETTODAT.MAN" : "FSW_PSW.MAN";
    downloadBytes(name, new TextEncoder().encode(body), "text/plain");
  }

  async function codeModule() {
    const link = useSession.getState().link;
    if (!link || !selected || target == null || !block.bytes || block.localId == null) return;
    if (confirm.trim().toUpperCase() !== selected.id) {
      setStatus(`Type ${selected.id} to confirm the write.`);
      return;
    }
    if (block.bytes.length > 240) {
      setStatus("That nettodata block is longer than 240 bytes. It was not sent.");
      return;
    }
    onLock?.(true);
    setBusy(true);
    setStatus("Reading this module before anything is written.");
    try {
      const read = await link.requestModule(target, Uint8Array.of(0x21, block.localId), 800);
      const current = codingBytesFromRead(read, block.localId);
      if (!current || current.length === 0) {
        const nrc = responseNrc(read);
        throw new Error(nrc != null ? `${nrcText(nrc)} Nothing was written.` : "The module did not return its coding. Nothing was written.");
      }
      let ident: Uint8Array | null = null;
      try {
        ident = identBytes(await link.requestModule(target, Uint8Array.of(0x1a, 0x90), 800));
      } catch {
        ident = null;
      }
      const stamp = new Date();
      const pad = (part: number) => String(part).padStart(2, "0");
      const fileName = `${selected.id}-backup-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.man`;
      downloadBytes(fileName, new TextEncoder().encode(backupNettodata(selected.id, selected.sgbd, target, block.localId, current, ident)), "text/plain");
      setStatus(`Backup saved as ${fileName}. Opening a coding session.`);
      const session = await link.requestModule(target, Uint8Array.of(0x10, 0x86), 800);
      if (!responseOk(session, 0x50)) {
        const nrc = responseNrc(session);
        throw new Error(nrc != null ? nrcText(nrc) : "The module did not open a coding session. Nothing was written.");
      }
      setStatus("Writing the nettodata block.");
      const payload = new Uint8Array(2 + block.bytes.length);
      payload[0] = 0x3b;
      payload[1] = block.localId;
      payload.set(block.bytes, 2);
      const written = await link.requestModule(target, payload, 2500);
      if (!responseOk(written, 0x7b)) {
        const nrc = responseNrc(written);
        throw new Error(nrc != null ? nrcText(nrc) : "The module did not accept the nettodata.");
      }
      setStatus(`Wrote ${block.bytes.length} nettodata bytes to ${selected.id}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "The coding stopped.");
    } finally {
      setBusy(false);
      onLock?.(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium">Coding</h2>
        <p className="mt-2 text-sm text-muted">
          NCS Expert picks the chassis and the module. NCS Dummy edits the trace. Nettodata is the CODIERDATEN block that can be written. The current coding is downloaded first. If that backup does not save, nothing is written.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Chassis
            <select className="h-11 rounded-md border border-line bg-bg px-2" value={chassis.id} onChange={(event) => pickChassis(event.target.value)}>
              {NCS_CHASSIS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Module
            <select
              className="h-11 rounded-md border border-line bg-bg px-2"
              value={selected?.key ?? ""}
              onChange={(event) => {
                setModuleKey(event.target.value);
                setEdits({});
              }}
            >
              {modulesBySection(chassis.modules).map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.modules.map((item) => (
                    <option key={item.key} value={item.key}>
                      {moduleLabel(item)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        {selected ? (
          <p className="mt-2 font-mono text-sm text-muted">
            {selected.id} · CABD {selected.cabd} · SGBD {selected.sgbd}
            {target == null ? " · no K-line address for this module, so it cannot be coded from here" : ` · address 0x${target.toString(16).toUpperCase()}`}
          </p>
        ) : null}
        <div className="mt-3 rounded-md border border-line p-3">
          <h3 className="text-sm font-medium">Code from nettodata</h3>
          <p className="mt-1 text-sm text-muted">
            {block.bytes
              ? `${block.bytes.length} bytes`
              : "No CODIERDATEN block in this file."}
            {block.localId != null ? ` · local ${block.localId.toString(16).toUpperCase().padStart(2, "0")}` : " · add a LOCAL line, for example LOCAL 10"}
            . Function names are not converted into bytes. Only that hex block is sent.
          </p>
          <label className="mt-2 flex flex-col gap-1 text-sm">
            Type {selected?.id} to confirm
            <input
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="h-11 rounded-md border border-line bg-bg px-3 font-mono text-sm"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="mt-2 h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-40"
            disabled={!connected || busy || target == null || !block.bytes || block.localId == null || confirm.trim().toUpperCase() !== selected?.id}
            onClick={() => void codeModule()}
          >
            {busy ? "Coding…" : "Code this module"}
          </button>
          {!connected ? <p className="mt-2 text-sm text-muted">Connect the lead on the Cable tab first.</p> : null}
          {status ? <p className="mt-2 text-sm">{status}</p> : null}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium">FSW / PSW and nettodata</h3>
          <p className="mt-2 text-sm text-muted">
            Paste a trace, or open FSW_PSW.TRC, FSW_PSW.MAN, NETTODAT.TRC, or NETTODAT.MAN. Put the raw block under CODIERDATEN and the local id on a LOCAL line.
          </p>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setEdits({});
            }}
            spellCheck={false}
            className="mt-3 h-80 w-full rounded-md border border-line bg-bg p-3 font-mono text-sm text-fg"
            aria-label="Coding trace"
          />
          <label className="mt-3 flex h-11 cursor-pointer items-center justify-center rounded-md border border-line text-sm">
            Open a trace file
            <input
              type="file"
              accept=".trc,.txt,.man,.ncs"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then((next) => {
                  setText(next);
                  setEdits({});
                });
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Functions on {selected?.id}</h3>
            <div className="flex gap-2">
              <button type="button" className="h-9 rounded-md border border-line px-3 text-sm" onClick={() => exportTrace("fsw")} disabled={rows.length === 0}>
                FSW_PSW.MAN
              </button>
              <button type="button" className="h-9 rounded-md bg-lamp px-3 text-sm font-medium text-bg" onClick={() => exportTrace("netto")} disabled={rows.length === 0 && !block.bytes}>
                NETTODAT.MAN
              </button>
            </div>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a function or its English name"
            className="mt-3 h-11 w-full rounded-md border border-line bg-bg px-3 text-sm"
          />
          {shown.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              {mine.length === 0 ? `No functions in this trace for ${selected?.id}.` : "Nothing matches that search."}
            </p>
          ) : (
            <ul className="mt-2 flex max-h-[28rem] flex-col gap-2 overflow-auto">
              {shown.map((row) => {
                const value = valueOf(row);
                return (
                  <li key={`${row.module}-${row.name}`} className="rounded-md border border-line px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-sm">{row.name}</span>
                      <span className="text-sm text-muted">{speak(words, row.name)}</span>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <span className="text-muted">Value</span>
                      <input
                        value={value}
                        onChange={(event) => setEdits((current) => ({ ...current, [`${row.module}|${row.name}`]: event.target.value.trim() }))}
                        className="h-9 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-sm"
                      />
                    </label>
                    {speak(words, value) !== value ? <p className="mt-1 text-sm text-muted">{speak(words, value)}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
