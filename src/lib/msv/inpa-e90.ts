/** Taken from EC-APPS/INPA/CFGDAT and the INPA .IPO scripts. */
export type InpaModule = {
  id: string;
  name: string;
  note: string;
  /** Diagnostic address, only when the script itself states it. */
  target: number | null;
};

export type InpaGroup = {
  id: string;
  name: string;
  modules: InpaModule[];
};

export const INPA_GROUPS: InpaGroup[] = [
  {
    id: "engine",
    name: "Engine",
    modules: [
      { id: "MSV80", name: "MSV80", note: "MSV80.0 for N52KP", target: 0x12 },
      { id: "MSV70", name: "MSV70", note: "MSV70.0 for N52", target: 0x12 },
      { id: "MSD80", name: "MSD80", note: "MSD80.0 for N43, N53, N54", target: 0x12 },
      { id: "MS450", name: "MS450", note: "MS45.0 for M54", target: 0x12 },
      { id: "MSS60", name: "MSS60", note: "MSS60 for S65", target: null },
      { id: "ME9NG4TU", name: "ME9NG4TU", note: "ME9.2 / MEV9 for N45 / N46", target: null },
      { id: "D50M47", name: "D50M47", note: "DDE5.0 for M47 TU", target: null },
      { id: "DDE6M47", name: "DDE6M47", note: "DDE6.0 for M47 TU2", target: null },
      { id: "D50M57", name: "D50M57", note: "DDE5.0 for M57 TU", target: null },
      { id: "DDE6M57", name: "DDE6M57", note: "DDE6 for M57", target: null },
      { id: "EKPM60_2", name: "EKPM60_2", note: "Fuel pump", target: null },
    ],
  },
  {
    id: "gear",
    name: "Transmission",
    modules: [
      { id: "GS19", name: "GS19", note: "Automatic gearbox", target: null },
      { id: "GS30", name: "GS30", note: "Sequential gearbox", target: null },
      { id: "VGSG90", name: "VGSG90", note: "DCT gearbox", target: null },
    ],
  },
  {
    id: "chassis",
    name: "Chassis",
    modules: [
      { id: "DSC_87", name: "DSC_87", note: "Dynamic stability control", target: null },
      { id: "DXC8_P", name: "DXC8_P", note: "Dynamic stability control DXC", target: null },
      { id: "AFS_90", name: "AFS_90", note: "Active front steering", target: null },
      { id: "EPS_90", name: "EPS_90", note: "Electronic power steering", target: null },
      { id: "LDM_90", name: "LDM_90", note: "Longitudinal dynamics", target: null },
      { id: "ACC2", name: "ACC2", note: "Adaptive cruise control", target: null },
      { id: "RDC_60", name: "RDC_60", note: "Tire pressure", target: null },
    ],
  },
  {
    id: "body",
    name: "Body",
    modules: [
      { id: "CAS", name: "CAS", note: "Car access", target: null },
      { id: "KOMB87", name: "KOMB87", note: "Instrument cluster", target: null },
      { id: "JBBF87", name: "JBBF87", note: "Junction box", target: null },
      { id: "FRM_87", name: "FRM_87", note: "Footwell module", target: null },
      { id: "IHKA87", name: "IHKA87", note: "Climate panel", target: null },
      { id: "MRS5", name: "MRS5", note: "Airbag", target: null },
      { id: "SZL", name: "SZL", note: "Steering column switch. In the tool set, not in this E90.ENG list.", target: null },
      { id: "PDC_E87", name: "PDC_E87", note: "Park distance", target: null },
      { id: "FZD_87", name: "FZD_87", note: "Roof function center", target: null },
      { id: "RLS_87", name: "RLS_87", note: "Rain and light sensor", target: null },
    ],
  },
];

export type InpaTest = {
  id: string;
  name: string;
  kind: "ident" | "faults" | "obd" | "aif" | "blocked";
  detail: string;
};

/** Main menu from MSV80.IPO. F6, F8, and the shift jobs move or erase data, so they are not sent. */
export const MSV80_TESTS: InpaTest[] = [
  { id: "sgbd", name: "SGBD info", kind: "ident", detail: "F1. Reads identification." },
  { id: "obd", name: "OBD status", kind: "obd", detail: "Shift+F1. Mode 01 from the DME." },
  { id: "ident", name: "SG identification", kind: "ident", detail: "F2. Reads identification." },
  { id: "aif", name: "User info field", kind: "aif", detail: "F3. Reads the 1A 86 info block." },
  { id: "faults", name: "Read error memory", kind: "faults", detail: "F4. Reads stored faults and does not clear them." },
  { id: "status", name: "Status analog / digital", kind: "blocked", detail: "F5. The scaled blocks, including Valvetronic, are still packed in the script." },
  { id: "actuator", name: "Actuator activations", kind: "blocked", detail: "F6. These move parts. Not sent." },
  { id: "memory", name: "Read memory", kind: "blocked", detail: "F7. The address range is not in the open script. Not sent." },
  { id: "adapt", name: "Delete adaptions", kind: "blocked", detail: "F8. This erases learned values. Not sent." },
  { id: "system", name: "System diagnosis", kind: "blocked", detail: "F9. These are end-of-line tests. Not sent." },
];

function jobTitle(name: string) {
  return name
    .toLowerCase()
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function jobTest(name: string): InpaTest {
  if (/SCHREIB|PROGRAM|LOESCH|FLASH|STELL|ANSTEU|ADAPT|RESET|CODIER|KODIER|SETZEN/.test(name)) {
    return { id: name, name: jobTitle(name), kind: "blocked", detail: "Listed in the INPA script. It changes the module, so it is not sent." };
  }
  if (/AIF_LESEN|AIF_ANZ/.test(name)) {
    return { id: name, name: jobTitle(name), kind: "aif", detail: "Reads the info block when the script states an address." };
  }
  if (/FEHLER_LESEN|FS_LESEN|IS_LESEN|HS_LESEN/.test(name)) {
    return { id: name, name: jobTitle(name), kind: "faults", detail: "Reads stored faults and does not clear them." };
  }
  if (/IDENT|SGBD|INFO_LESEN|DIAGNOSEPROTOKOLL_LESEN/.test(name)) {
    return { id: name, name: jobTitle(name), kind: "ident", detail: "Reads identification when the script states an address." };
  }
  if (/STATUS|SPEICHER_LESEN|LESEN/.test(name)) {
    return { id: name, name: jobTitle(name), kind: "blocked", detail: "Listed in the INPA script. The scaled block is still packed, so it is not sent." };
  }
  return { id: name, name: jobTitle(name), kind: "blocked", detail: "Listed in the INPA script. It is not sent." };
}

export function testsFor(moduleId: string, catalog?: Record<string, string[]> | null): InpaTest[] {
  if (moduleId.toUpperCase() === "MSV80") return MSV80_TESTS;
  const jobs = catalog?.[moduleId.toUpperCase()];
  if (!jobs) {
    return [
      { id: "ident", name: "Identification", kind: "ident", detail: "Reads identification when the script states an address." },
      { id: "faults", name: "Read error memory", kind: "faults", detail: "Reads stored faults and does not clear them." },
    ];
  }
  const tests = jobs.filter((name) => name !== "JOB_STATUS").map(jobTest);
  const rank = { ident: 0, aif: 1, obd: 2, faults: 3, blocked: 4 };
  return tests.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
