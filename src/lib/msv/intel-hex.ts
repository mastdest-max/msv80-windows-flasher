export type HexSpan = { address: number; bytes: Uint8Array };

export type IntelImage = {
  reference: string | null;
  spans: HexSpan[];
  bytes: number;
  skipped: number;
};

/** Intel HEX, including the `$REFERENZ` line WinKFP puts above the records. */
export function parseIntelHex(text: string): IntelImage {
  const reference = text.match(/\$REFERENZ\s+(\S+)/)?.[1] ?? text.match(/0049[A-Z0-9]{2}0[A-Z0-9]{5}/)?.[0] ?? null;
  let base = 0;
  const chunks: { address: number; data: Uint8Array }[] = [];
  const lines = text.split(/\r?\n/);
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim();
    if (!line.startsWith(":")) continue;
    if (line.length < 11) throw new Error(`Broken Intel HEX record on line ${lineNo + 1}.`);
    const count = Number.parseInt(line.slice(1, 3), 16);
    const addr = Number.parseInt(line.slice(3, 7), 16);
    const type = Number.parseInt(line.slice(7, 9), 16);
    if (!Number.isFinite(count) || !Number.isFinite(addr) || !Number.isFinite(type)) {
      throw new Error(`Broken Intel HEX record on line ${lineNo + 1}.`);
    }
    if (line.length < 11 + count * 2) throw new Error(`Short Intel HEX record on line ${lineNo + 1}.`);
    const data = new Uint8Array(count);
    let sum = count + (addr >> 8) + (addr & 0xff) + type;
    for (let i = 0; i < count; i++) {
      const byte = Number.parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
      if (!Number.isFinite(byte)) throw new Error(`Bad Intel HEX byte on line ${lineNo + 1}.`);
      data[i] = byte;
      sum += byte;
    }
    const check = Number.parseInt(line.slice(9 + count * 2, 11 + count * 2), 16);
    if (((sum + check) & 0xff) !== 0) throw new Error(`Intel HEX checksum failed on line ${lineNo + 1}.`);
    if (type === 0x00) chunks.push({ address: (base + addr) >>> 0, data });
    else if (type === 0x04 && count === 2) base = ((data[0] << 8) | data[1]) << 16;
    else if (type === 0x02 && count === 2) base = ((data[0] << 8) | data[1]) << 4;
    else if (type === 0x01) break;
  }
  const groups: { address: number; parts: Uint8Array[] }[] = [];
  let skipped = 0;
  let cursor = -1;
  for (const chunk of chunks) {
    if (chunk.data.every((byte) => byte === 0xff)) {
      skipped += chunk.data.length;
      cursor = -1;
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && chunk.address === cursor) last.parts.push(chunk.data);
    else groups.push({ address: chunk.address, parts: [chunk.data] });
    cursor = chunk.address + chunk.data.length;
  }
  const spans = groups.map((group) => {
    const size = group.parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of group.parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return { address: group.address, bytes };
  });
  const bytes = spans.reduce((sum, span) => sum + span.bytes.length, 0);
  if (bytes < 1) throw new Error("That Intel HEX file has no data to write.");
  return { reference, spans, bytes, skipped };
}
