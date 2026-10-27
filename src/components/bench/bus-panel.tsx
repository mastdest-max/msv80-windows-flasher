import { useState } from "react";
import { MODULES, faultDetail, moduleAwake, readFaultMemory, type ModuleReport } from "@/lib/msv/modules";
import { useSession } from "@/lib/msv/session";

export function BusPanel() {
  const connected = useSession((state) => state.link !== null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ModuleReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    const link = useSession.getState().link;
    if (!link) return;
    setBusy(true);
    setError(null);
    const next: ModuleReport[] = [];
    try {
      for (const spec of MODULES) {
        let ident = await link.requestModule(spec.target, Uint8Array.of(0x1a, 0x80), 500);
        if (!moduleAwake(ident)) ident = await link.requestModule(spec.target, Uint8Array.of(0x1a, 0x90), 500);
        if (!moduleAwake(ident)) {
          next.push({ spec, state: "silent", detail: "No identification reply at this address.", faults: [] });
          continue;
        }
        const faults = await readFaultMemory((payload) => link.requestModule(spec.target, payload, 800));
        next.push({
          spec,
          state: faults.refused ? "refused" : "awake",
          detail: faultDetail(faults),
          faults: faults.codes,
        });
      }
      setRows(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The bus scan stopped.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium">Diagnostic bus</h2>
        <p className="mt-2 text-sm text-muted">
          This lead does not sniff raw CAN frames. It asks each module the same way INPA does. Wheel speeds live in DSC. The transfer case lives in VTG. Valvetronic lives in the DME.
        </p>
        <button
          type="button"
          disabled={!connected || busy}
          className="mt-3 h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60"
          onClick={() => void scan()}
        >
          {busy ? "Asking modules…" : "Scan modules"}
        </button>
        {!connected ? <p className="mt-3 text-sm text-muted">Connect the lead on the Cable tab first.</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </div>
      {rows ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.spec.id} className="rounded-lg border border-line bg-surface px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium">
                  {row.spec.name}
                  <span className="ml-2 font-mono text-sm text-muted">0x{row.spec.target.toString(16).toUpperCase()}</span>
                </h3>
                <span className="text-sm">{row.state === "silent" ? "Silent" : "Awake"}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{row.spec.note}</p>
              <p className="mt-1 text-sm">{row.detail}</p>
              {row.faults.length > 0 ? (
                <p className="mt-1 font-mono text-sm">Faults {row.faults.join(", ")}</p>
              ) : row.state === "awake" ? (
                <p className="mt-1 text-sm text-muted">No fault entries in this reply.</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-line bg-raised p-4 text-sm text-muted">
          A scan only reads identification and stored faults. It does not clear them and it does not code a module.
        </div>
      )}
    </div>
  );
}
