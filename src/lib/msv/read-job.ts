import type { XdfScalar } from "./xdf";

export const CAL_BASE = 0x1c0000;
export const CAL_SIZE = 255_952;
export const FULL_SIZE = 0x280000;
export const CHUNK = 128;

export const PROGRAM_IDS = [0x90, 0x91, 0x92, 0x97, 0x80];

export type ReadJob = "programs" | "scalars" | "0da" | "bin";

export function identPayload(localId: number): Uint8Array {
  return Uint8Array.of(0x1a, localId & 0xff);
}

export function memoryPayload(address: number, size: number): Uint8Array {
  return Uint8Array.of(0x23, (address >> 16) & 0xff, (address >> 8) & 0xff, address & 0xff, size & 0xff);
}

export function scalarFlashAddress(address: number, regionSize: number | null): number {
  if (address >= CAL_BASE) return address;
  if (regionSize != null && regionSize <= CAL_SIZE + 4096) return CAL_BASE + address;
  return address;
}

export function scalarByteLength(bits: number): number {
  return Math.max(1, Math.min(4, Math.ceil(bits / 8)));
}

const NRC: Record<number, string> = {
  0x11: "The DME does not support that service.",
  0x12: "The DME rejected the identifier.",
  0x22: "Conditions not correct. Ignition on, and do not start a programming session.",
  0x31: "That address is out of range for this DME.",
  0x33: "The DME refused because security is closed. The BIN read asks for access first and does not guess a key.",
  0x78: "The DME is still busy.",
};

export function describeNrc(nrc: number): string {
  return NRC[nrc] ?? `The DME refused the request (code ${nrc.toString(16)}).`;
}

export type DiagHit = { kind: "ok"; data: Uint8Array } | { kind: "nrc"; nrc: number } | { kind: "none" };

export function interpret(rx: Uint8Array, service: number, expect: number | null): DiagHit {
  for (let i = 0; i + 2 < rx.length; i++) {
    if (rx[i] !== 0x7f || rx[i + 1] !== service || rx[i + 2] === 0x78) continue;
    return { kind: "nrc", nrc: rx[i + 2] };
  }
  const positive = (service + 0x40) & 0xff;
  let at = -1;
  for (let i = 0; i < rx.length; i++) if (rx[i] === positive) at = i;
  if (at < 0) return { kind: "none" };
  const rest = rx.subarray(at + 1);
  if (service === 0x23 && expect != null) {
    const extra = rest.length - expect;
    const data = extra === 3 || extra === 4 ? rest.subarray(extra) : extra > 4 ? rest.subarray(3) : rest;
    if (data.length < expect) return { kind: "none" };
    return { kind: "ok", data: data.subarray(0, expect) };
  }
  if (expect != null && rest.length < expect) return { kind: "none" };
  return { kind: "ok", data: expect == null ? rest.subarray(0, Math.min(rest.length, 96)) : rest.subarray(0, expect) };
}

export function asciiFrom(data: Uint8Array): string {
  let text = "";
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0x20 || value >= 0x7f) {
      if (text.length >= 4) break;
      text = "";
      continue;
    }
    text += String.fromCharCode(value);
    if (text.length >= 48) break;
  }
  return text;
}

export type ScalarRow = {
  title: string;
  address: number | null;
  text: string;
};

export function rowsFromScalars(scalars: XdfScalar[], regionSize: number | null, words: Uint8Array[]): ScalarRow[] {
  return scalars.map((scalar, index) => {
    const address = scalarFlashAddress(scalar.address, regionSize);
    const raw = words[index] ?? new Uint8Array();
    const hex = [...raw].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    return { title: scalar.title, address, text: hex || "no reply" };
  });
}

export function scalarFromImage(
  bytes: Uint8Array,
  base: number,
  scalar: XdfScalar,
  regionSize: number | null,
): string {
  const flash = scalarFlashAddress(scalar.address, regionSize);
  const offset = flash >= base && flash - base < bytes.length ? flash - base : scalar.address;
  const length = scalarByteLength(scalar.bits);
  if (offset < 0 || offset + length > bytes.length) return "not in this file";
  let hex = "";
  for (let i = 0; i < length; i++) {
    if (i) hex += " ";
    hex += bytes[offset + i].toString(16).toUpperCase().padStart(2, "0");
  }
  return hex;
}
