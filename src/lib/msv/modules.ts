import { kwpBodies } from "./kdcan";

export type ModuleSpec = {
  id: string;
  name: string;
  target: number;
  note: string;
};

/** Usual E90 diagnostic addresses. A silent row means that address did not answer, not that the part is missing. */
export const MODULES: ModuleSpec[] = [
  { id: "dme", name: "DME", target: 0x12, note: "Engine, including Valvetronic" },
  { id: "egs", name: "EGS", target: 0x18, note: "Automatic transmission" },
  { id: "vtg", name: "VTG", target: 0x19, note: "Transfer case actuator" },
  { id: "dsc", name: "DSC", target: 0x29, note: "Wheel speeds and yaw rate" },
  { id: "szl", name: "SZL", target: 0x34, note: "Steering angle" },
  { id: "ekps", name: "EKPS", target: 0x17, note: "Fuel pump" },
  { id: "cas", name: "CAS", target: 0x40, note: "Car access" },
  { id: "kombi", name: "KOMBI", target: 0x60, note: "Instrument cluster" },
  { id: "ihka", name: "IHKA", target: 0x78, note: "Climate" },
];

export type ModuleReport = {
  spec: ModuleSpec;
  state: "awake" | "silent" | "refused";
  detail: string;
  faults: string[];
};

export function parseDtcs(raw: Uint8Array): { refused: boolean; nrc: number | null; codes: string[] } {
  for (const body of kwpBodies(raw)) {
    if (body.kind === "nrc" && body.nrc === 0x78) continue;
    if (body.kind === "nrc") return { refused: true, nrc: body.nrc, codes: [] };
    if (body.kind !== "ok" || body.service !== 0x58 || body.data.length < 1) continue;
    const count = body.data[0];
    const codes: string[] = [];
    for (let i = 1; i + 2 < body.data.length && codes.length < count; i += 3) {
      const hi = body.data[i].toString(16).padStart(2, "0");
      const lo = body.data[i + 1].toString(16).padStart(2, "0");
      const status = body.data[i + 2].toString(16).padStart(2, "0");
      codes.push(`${hi}${lo} · ${status}`.toUpperCase());
    }
    return { refused: false, nrc: null, codes };
  }
  return { refused: false, nrc: null, codes: [] };
}

/** BMW modules do not all accept the same fault-memory request. */
export const FAULT_REQUESTS = [
  Uint8Array.of(0x18, 0x02, 0xff, 0x00),
  Uint8Array.of(0x18, 0x00, 0xff, 0x00),
  Uint8Array.of(0x18, 0x02, 0xff, 0xff),
];

export async function readFaultMemory(ask: (payload: Uint8Array) => Promise<Uint8Array>): Promise<{ refused: boolean; nrc: number | null; codes: string[] }> {
  let last = parseDtcs(new Uint8Array());
  for (const payload of FAULT_REQUESTS) {
    last = parseDtcs(await ask(payload));
    if (!last.refused) return last;
    if (last.nrc !== 0x11 && last.nrc !== 0x12) return last;
  }
  return last;
}

export function faultDetail(parsed: { refused: boolean; nrc: number | null; codes: string[] }): string {
  if (!parsed.refused) return parsed.codes.length > 0 ? "Awake." : "Awake. No stored faults.";
  if (parsed.nrc === 0x22) return "Awake. Fault memory needs the ignition on.";
  if (parsed.nrc === 0x11 || parsed.nrc === 0x12) return "Awake. This module rejected the fault-memory command.";
  if (parsed.nrc != null) return `Awake. Fault memory was refused (${parsed.nrc.toString(16).toUpperCase()}).`;
  return "Awake. Fault memory was refused.";
}

export function moduleAwake(raw: Uint8Array): boolean {
  return kwpBodies(raw).some((body) => body.kind === "ok" && body.service === 0x5a);
}

export type CodingRow = { module: string; name: string; value: string };

const MODULE_NAMES = new Set(MODULES.map((item) => item.name));

const VALUE = /^[A-Za-z0-9_+\-./%]{1,48}$/;

/** Read an NCS-style trace. This does not write coding. */
export function parseCodingTrace(text: string, extraModules?: Iterable<string>): CodingRow[] {
  const modules = new Set(MODULE_NAMES);
  if (extraModules) {
    for (const name of extraModules) modules.add(name.toUpperCase());
  }
  const rows: CodingRow[] = [];
  let module = "TRACE";
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith(";") && !line.startsWith("#"));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (modules.has(line.toUpperCase())) {
      module = line.toUpperCase();
      continue;
    }
    const paired = line.match(/^([A-Za-z][A-Za-z0-9_]{1,40})\s*[:=]\s*([A-Za-z0-9_+\-./%]{1,48})$/);
    if (paired) {
      rows.push({ module, name: paired[1].toUpperCase(), value: paired[2] });
      continue;
    }
    const one = line.match(/^([A-Za-z][A-Za-z0-9_]{1,40})\s+([A-Za-z0-9_+\-./%]{1,48})$/);
    if (one) {
      rows.push({ module, name: one[1].toUpperCase(), value: one[2] });
      continue;
    }
    const next = lines[i + 1];
    if (/^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(line) && next && VALUE.test(next) && !modules.has(next.toUpperCase())) {
      rows.push({ module, name: line.toUpperCase(), value: next });
      i += 1;
    }
  }
  return rows;
}

export const SAMPLE_TRACE = `KOMBI
B0150
00000008
LANGUAGE
00000001
DSC
B0650
00000000
VTG
ACTUATOR_CLASS
00000002
`;
