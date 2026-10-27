import { kwpBodies } from "@/lib/msv/kdcan";
import { parseCodingTrace, type CodingRow } from "@/lib/msv/modules";

/** Diagnostic address only where this app already uses that module on the K-line. */
export function codingTarget(moduleId: string, sgbd: string): number | null {
  const id = moduleId.toUpperCase();
  const sg = sgbd.toUpperCase();
  if (id === "KOMBI" || sg.startsWith("KOMB")) return 0x60;
  if (id === "CAS" || sg.startsWith("CAS")) return 0x40;
  if (id === "DSC" || sg.startsWith("DSC")) return 0x29;
  if (id === "VTG") return 0x19;
  if (id === "SZL" || sg.startsWith("SZL")) return 0x34;
  if (id.startsWith("EKP")) return 0x17;
  if (id.startsWith("IHKA") || sg.startsWith("IHKA")) return 0x78;
  if (id === "EGS" || sg.startsWith("GS19") || sg.startsWith("GS20")) return 0x18;
  if (sg.startsWith("MSV") || sg.startsWith("MSD") || sg.startsWith("DME") || id.endsWith("MOT")) return 0x12;
  return null;
}

export type NettodataBlock = {
  localId: number | null;
  bytes: Uint8Array | null;
};

const HEX = /^[0-9A-Fa-f]{2}$/;

export function parseNettodataBlock(text: string): NettodataBlock {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith(";") && !line.startsWith("#"));
  let localId: number | null = null;
  let capture = false;
  const bytes: number[] = [];
  for (const line of lines) {
    const local = line.match(/^LOCAL\s+(?:0x)?([0-9A-Fa-f]{1,2})$/i);
    if (local) {
      localId = Number.parseInt(local[1], 16);
      capture = false;
      continue;
    }
    if (/^CODIERDATEN$/i.test(line) || /^NETTODATEN$/i.test(line)) {
      capture = true;
      continue;
    }
    if (!capture) continue;
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 0 || !parts.every((part) => HEX.test(part))) {
      capture = false;
      continue;
    }
    for (const part of parts) bytes.push(Number.parseInt(part, 16));
  }
  return { localId, bytes: bytes.length > 0 ? Uint8Array.from(bytes) : null };
}

export function traceRows(text: string, modules: string[]): CodingRow[] {
  const withoutBlock = text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !/^CODIERDATEN$/i.test(trimmed) && !/^NETTODATEN$/i.test(trimmed) && !/^LOCAL\s+/i.test(trimmed);
    })
    .join("\n");
  return parseCodingTrace(withoutBlock, modules);
}

export function exportNettodata(rows: CodingRow[], valueOf: (row: CodingRow) => string, block: NettodataBlock): string {
  const lines: string[] = [];
  let module = "";
  for (const row of rows) {
    if (row.module !== module) {
      module = row.module;
      lines.push(module);
    }
    lines.push(row.name, valueOf(row));
  }
  if (block.localId != null) lines.push(`LOCAL ${block.localId.toString(16).toUpperCase().padStart(2, "0")}`);
  if (block.bytes && block.bytes.length > 0) {
    lines.push("CODIERDATEN");
    for (let i = 0; i < block.bytes.length; i += 16) {
      lines.push(
        [...block.bytes.subarray(i, i + 16)].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" "),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function nrcText(code: number): string {
  if (code === 0x12) return "The module does not support that coding service.";
  if (code === 0x22) return "The module refused because the conditions were not right. Ignition on, and do not run another job.";
  if (code === 0x31) return "The module rejected the coding block.";
  if (code === 0x33) return "The module asked for security access. Nothing was written.";
  if (code === 0x78) return "The module asked for more time and then did not finish.";
  return `The module refused the write (${code.toString(16).toUpperCase()}).`;
}

export function codingBytesFromRead(raw: Uint8Array, localId: number): Uint8Array | null {
  for (const body of kwpBodies(raw)) {
    if (body.kind !== "ok" || body.service !== 0x61 || body.data.length < 2 || body.data[0] !== localId) continue;
    return body.data.subarray(1);
  }
  return null;
}

export function identBytes(raw: Uint8Array): Uint8Array | null {
  for (const body of kwpBodies(raw)) {
    if (body.kind === "ok" && body.service === 0x5a && body.data.length > 0) return body.data;
  }
  return null;
}

function hexLine(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    lines.push([...bytes.subarray(i, i + 16)].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" "));
  }
  return lines;
}

export function backupNettodata(moduleId: string, sgbd: string, address: number, localId: number, bytes: Uint8Array, ident: Uint8Array | null): string {
  const lines = [
    `; backup ${new Date().toISOString()}`,
    `; ${moduleId} ${sgbd} address ${address.toString(16).toUpperCase().padStart(2, "0")}`,
  ];
  if (ident && ident.length > 0) lines.push(`; IDENT ${hexLine(ident).join(" ")}`);
  lines.push(`LOCAL ${localId.toString(16).toUpperCase().padStart(2, "0")}`, "CODIERDATEN", ...hexLine(bytes));
  return `${lines.join("\n")}\n`;
}

export function responseNrc(raw: Uint8Array): number | null {
  for (const body of kwpBodies(raw)) {
    if (body.kind === "nrc") return body.nrc;
  }
  return null;
}

export function responseOk(raw: Uint8Array, service: number): boolean {
  return kwpBodies(raw).some((body) => body.kind === "ok" && body.service === service);
}
