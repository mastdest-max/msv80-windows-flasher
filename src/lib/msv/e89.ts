import { previewPathPrefix } from "@/lib/preview-path-prefix";

export type E89Assembly = { zb: string; hw: string; sw: string };
export type E89Catalog = Record<string, E89Assembly[]>;

let cached: Promise<E89Catalog> | null = null;

export function loadE89(): Promise<E89Catalog> {
  if (!cached) {
    const prefix = typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
    cached = fetch(`${prefix}/e89-data.json`)
      .then((response) => {
        if (!response.ok) throw new Error("The E89 data did not load.");
        return response.json() as Promise<Record<string, string[][]>>;
      })
      .then((raw) => {
        const catalog: E89Catalog = {};
        for (const [ecu, rows] of Object.entries(raw)) {
          catalog[ecu] = rows.map(([zb, hw, sw]) => ({ zb, hw, sw }));
        }
        return catalog;
      });
  }
  return cached;
}

export type E89Hit = { ecu: string; assembly: E89Assembly };

export function matchE89(catalog: E89Catalog, query: string): { ecus: string[]; hits: E89Hit[] } {
  const needle = query.trim().toUpperCase().replace(/^S(?=\d)/, "");
  if (!needle) return { ecus: Object.keys(catalog), hits: [] };
  const ecus = Object.keys(catalog).filter((ecu) => ecu.includes(needle));
  const hits: E89Hit[] = [];
  const digits = needle.replace(/\D/g, "");
  for (const [ecu, rows] of Object.entries(catalog)) {
    for (const assembly of rows) {
      const sw = assembly.sw.toUpperCase();
      if (
        (digits.length >= 4 && (assembly.zb.includes(digits) || assembly.hw.includes(digits) || sw.includes(digits))) ||
        sw.includes(needle)
      ) {
        hits.push({ ecu, assembly });
        if (hits.length >= 40) return { ecus, hits };
      }
    }
  }
  return { ecus, hits };
}

export function numbersIn(text: string): string[] {
  return [...text.toUpperCase().matchAll(/\d{7}/g)].map((match) => match[0]);
}
