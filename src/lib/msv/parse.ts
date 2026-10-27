export type HexChunk = { address: number; data: Uint8Array };

export type HexParse = {
  chunks: HexChunk[];
  records: number;
  badChecksums: number;
  eof: boolean;
  errors: string[];
};

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function pushError(errors: string[], message: string) {
  if (errors.length < 6) errors.push(message);
}

export function looksLikeIntelHex(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (lines.length < 2) return false;
  const good = lines.filter((line) => /^:[0-9A-Fa-f]{10,}$/.test(line)).length;
  return good >= 2 && good / lines.length > 0.6;
}

export function looksLikeSrec(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (lines.length < 2) return false;
  const good = lines.filter((line) => /^S[0-9][0-9A-Fa-f]+$/.test(line)).length;
  return good >= 2 && good / lines.length > 0.6;
}

export function parseIntelHex(text: string): HexParse {
  const chunks: HexChunk[] = [];
  const errors: string[] = [];
  let extLinear = 0;
  let extSeg = 0;
  let records = 0;
  let badChecksums = 0;
  let eof = false;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith(":")) {
      pushError(errors, `Line ${i + 1} is not an Intel HEX record.`);
      continue;
    }
    const bytes = hexToBytes(line.slice(1));
    if (!bytes || bytes.length < 5) {
      pushError(errors, `Line ${i + 1} is malformed.`);
      continue;
    }
    const count = bytes[0];
    if (bytes.length !== count + 5) {
      pushError(errors, `Line ${i + 1} has the wrong length.`);
      continue;
    }
    let sum = 0;
    for (const value of bytes) sum = (sum + value) & 0xff;
    if (sum !== 0) badChecksums += 1;
    records += 1;
    const addr = bytes[1] * 256 + bytes[2];
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + count);
    if (type === 0x00) {
      chunks.push({ address: extLinear + extSeg * 16 + addr, data: Uint8Array.from(data) });
    } else if (type === 0x01) {
      eof = true;
    } else if (type === 0x02 && data.length >= 2) {
      extSeg = data[0] * 256 + data[1];
      extLinear = 0;
    } else if (type === 0x04 && data.length >= 2) {
      extLinear = (data[0] * 256 + data[1]) * 0x10000;
      extSeg = 0;
    }
  }

  return { chunks, records, badChecksums, eof, errors };
}

export function parseSrec(text: string): HexParse {
  const chunks: HexChunk[] = [];
  const errors: string[] = [];
  let records = 0;
  let badChecksums = 0;
  let eof = false;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!/^S[0-9][0-9A-Fa-f]+$/i.test(line)) {
      pushError(errors, `Line ${i + 1} is not an S-record.`);
      continue;
    }
    const type = line[1];
    const bytes = hexToBytes(line.slice(2));
    if (!bytes || bytes.length < 2) {
      pushError(errors, `Line ${i + 1} is malformed.`);
      continue;
    }
    const count = bytes[0];
    if (bytes.length !== count + 1) {
      pushError(errors, `Line ${i + 1} has the wrong length.`);
      continue;
    }
    let sum = 0;
    for (const value of bytes) sum = (sum + value) & 0xff;
    if (sum !== 0xff) badChecksums += 1;
    records += 1;
    const addrLen = type === "1" ? 2 : type === "2" ? 3 : type === "3" ? 4 : 0;
    if (!addrLen) {
      if (type === "7" || type === "8" || type === "9") eof = true;
      continue;
    }
    if (bytes.length < 1 + addrLen + 1) continue;
    let address = 0;
    for (let k = 0; k < addrLen; k++) address = address * 256 + bytes[1 + k];
    const data = bytes.subarray(1 + addrLen, bytes.length - 1);
    chunks.push({ address, data: Uint8Array.from(data) });
  }

  return { chunks, records, badChecksums, eof, errors };
}

function hexByte(value: number): string {
  return (value & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

function intelLine(addr: number, type: number, data: Uint8Array): string {
  const parts = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
  let sum = 0;
  for (const part of parts) sum = (sum + part) & 0xff;
  const checksum = (0x100 - sum) & 0xff;
  return `:${parts.map(hexByte).join("")}${hexByte(checksum)}`;
}

export function toIntelHex(bytes: Uint8Array, base = 0): string {
  const lines: string[] = [];
  let currentUpper = 0;
  for (let i = 0; i < bytes.length; ) {
    const abs = base + i;
    const upper = Math.floor(abs / 0x10000) & 0xffff;
    if (upper !== currentUpper) {
      currentUpper = upper;
      lines.push(intelLine(0, 0x04, Uint8Array.of((upper >> 8) & 0xff, upper & 0xff)));
    }
    const offset = abs % 0x10000;
    const count = Math.min(32, bytes.length - i, 0x10000 - offset);
    lines.push(intelLine(offset, 0x00, bytes.subarray(i, i + count)));
    i += count;
  }
  lines.push(":00000001FF");
  return lines.join("\n");
}

const MAX_WINDOW = 6_000_000;

export type Materialized = {
  base: number;
  bytes: Uint8Array;
  present: Uint8Array;
  clipped: boolean;
  sourceSpan: number;
};

export function materialize(chunks: HexChunk[]): Materialized | null {
  const filled = chunks.filter((chunk) => chunk.data.length > 0);
  if (filled.length === 0) return null;

  let min = Infinity;
  let max = 0;
  for (const chunk of filled) {
    if (chunk.address < min) min = chunk.address;
    const end = chunk.address + chunk.data.length;
    if (end > max) max = end;
  }

  const sourceSpan = max - min;
  let windowStart = min;
  let windowEnd = max;
  let clipped = false;

  if (sourceSpan > MAX_WINDOW) {
    clipped = true;
    const buckets = new Map<number, number>();
    for (const chunk of filled) {
      const bucket = Math.floor(chunk.address / 0x10000);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + chunk.data.length);
    }
    const keys = [...buckets.keys()].sort((a, b) => a - b);
    let best = -1;
    let bestStart = keys[0] ?? 0;
    for (const start of keys) {
      let sum = 0;
      for (let i = 0; i < 32; i++) sum += buckets.get(start + i) ?? 0;
      if (sum > best) {
        best = sum;
        bestStart = start;
      }
    }
    windowStart = bestStart * 0x10000;
    windowEnd = windowStart + 32 * 0x10000;
  }

  const length = windowEnd - windowStart;
  const bytes = new Uint8Array(length);
  const present = new Uint8Array(length);
  for (const chunk of filled) {
    for (let i = 0; i < chunk.data.length; i++) {
      const address = chunk.address + i;
      if (address < windowStart || address >= windowEnd) continue;
      const offset = address - windowStart;
      bytes[offset] = chunk.data[i];
      present[offset] = 1;
    }
  }

  return { base: windowStart, bytes, present, clipped, sourceSpan };
}
