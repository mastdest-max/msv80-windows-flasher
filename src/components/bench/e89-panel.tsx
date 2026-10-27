import { useEffect, useMemo, useState } from "react";
import { loadE89, matchE89, numbersIn, type E89Catalog, type E89Hit } from "@/lib/msv/e89";

export function E89Panel({ hint = "" }: { hint?: string }) {
  const [catalog, setCatalog] = useState<E89Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ecu, setEcu] = useState("MSV80");

  useEffect(() => {
    const found = numbersIn(hint);
    if (found.length > 0) setQuery((current) => current || found[0]);
  }, [hint]);

  useEffect(() => {
    let live = true;
    void loadE89()
      .then((next) => {
        if (live) setCatalog(next);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "The E89 data did not load.");
      });
    return () => {
      live = false;
    };
  }, []);

  const result = useMemo(() => (catalog ? matchE89(catalog, query) : { ecus: [], hits: [] }), [catalog, query]);
  const selected = catalog?.[ecu] ?? [];
  const shown = query.trim() ? result.hits : selected.slice(0, 12).map((assembly) => ({ ecu, assembly }));

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-medium">E89 data</h2>
      <p className="mt-2 text-sm text-muted">
        {catalog
          ? `${Object.keys(catalog).length} control units and ${Object.values(catalog).reduce((sum, rows) => sum + rows.length, 0)} assemblies from the E89 pack. These are the WinKFP ZB, hardware, and calibration numbers. The flash files stay in the repository.`
          : "Loading the E89 assembly tables."}
      </p>
      {error ? <p className="mt-2 text-sm">{error}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Search a number or ECU
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="8608327 or MSV80"
            className="h-11 rounded-md border border-line bg-bg px-3 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Control unit
          <select className="h-11 rounded-md border border-line bg-bg px-2" value={ecu} onChange={(event) => setEcu(event.target.value)}>
            {(result.ecus.length > 0 ? result.ecus : Object.keys(catalog ?? {})).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No assembly in this pack matches that.</p>
      ) : (
        <>
          {!query.trim() && selected.length > shown.length ? (
            <p className="mt-3 text-sm text-muted">Showing 12 of {selected.length} assemblies for {ecu}. Search to narrow it.</p>
          ) : null}
          <ul className="mt-3 flex max-h-80 flex-col gap-2 overflow-auto">
          {shown.map((hit: E89Hit) => (
            <li key={`${hit.ecu}-${hit.assembly.zb}-${hit.assembly.sw}`} className="rounded-md border border-line px-3 py-2 font-mono text-sm">
              <span>{hit.ecu}</span>
              <span className="mt-1 block text-muted">ZB {hit.assembly.zb} · HW {hit.assembly.hw} · calibration {hit.assembly.sw}</span>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
