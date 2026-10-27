export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatAddress(address: number): string {
  const hex = Math.max(0, Math.floor(address)).toString(16).toUpperCase().padStart(8, "0");
  return `0x${hex}`;
}

export function downloadBytes(name: string, bytes: Uint8Array, type = "application/octet-stream") {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function findBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  if (needle.length === 0 || hay.length < needle.length) return -1;
  const start = Math.max(0, from);
  const last = hay.length - needle.length;
  for (let i = start; i <= last; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

export function findQuery(hay: Uint8Array, query: string, from: number): number {
  const trimmed = query.trim();
  if (!trimmed) return -1;
  const compact = trimmed.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(compact) && compact.length >= 4 && compact.length % 2 === 0 && compact.length <= 64) {
    const needle = new Uint8Array(compact.length / 2);
    for (let i = 0; i < needle.length; i++) {
      needle[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    }
    return findBytes(hay, needle, from);
  }
  const needle = new Uint8Array(trimmed.length);
  for (let i = 0; i < trimmed.length; i++) needle[i] = trimmed.charCodeAt(i) & 0xff;
  return findBytes(hay, needle, from);
}
