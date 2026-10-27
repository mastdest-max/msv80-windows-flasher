import { previewPathPrefix } from "@/lib/preview-path-prefix";

export type RepoFile = {
  id: string;
  name: string;
  note: string;
  added: string;
  size: number;
  where: "preview" | "browser";
};

const DB = "msv-repository";
const STORE = "files";

function api(path: string) {
  if (typeof window === "undefined") return path;
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${prefix}${path}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function localRows(): Promise<RepoFile[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => {
      const rows = (request.result as Array<RepoFile & { bytes: ArrayBuffer }>).map((row) => ({
        id: row.id,
        name: row.name,
        note: row.note,
        added: row.added,
        size: row.size,
        where: "browser" as const,
      }));
      rows.sort((a, b) => (a.added < b.added ? 1 : -1));
      resolve(rows);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listRepository(): Promise<{ files: RepoFile[]; preview: boolean }> {
  try {
    const response = await fetch(api("/api/repository"));
    if (!response.ok) throw new Error("no preview store");
    const body = (await response.json()) as { files: Array<Omit<RepoFile, "where">> };
    const remote = body.files.map((file) => ({ ...file, where: "preview" as const }));
    const local = await localRows();
    return { files: [...remote, ...local], preview: true };
  } catch {
    return { files: await localRows(), preview: false };
  }
}

const CHUNK = 32 * 1024 * 1024;
const FILE_MAX = 8 * 1024 * 1024 * 1024;

export function repositoryPackUrl(ids: string[]): string {
  return api(`/api/repository?pack=${ids.map(encodeURIComponent).join(",")}`);
}

export function repositoryDownloadUrl(file: RepoFile): string | null {
  if (file.where !== "preview") return null;
  return api(`/api/repository?id=${encodeURIComponent(file.id)}`);
}

export async function addRepositoryFile(
  file: File,
  note: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<RepoFile> {
  if (file.size > FILE_MAX) throw new Error("File is over 8 GB.");
  if (file.size < 1) throw new Error("That file is empty.");
  const trimmed = note.trim().slice(0, 400);
  const pieces = Math.max(1, Math.ceil(file.size / CHUNK));
  const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let saved: Omit<RepoFile, "where"> | null = null;
  for (let index = 0; index < pieces; index++) {
    const start = index * CHUNK;
    const blob = file.slice(start, Math.min(file.size, start + CHUNK));
    const response = await fetch(api("/api/repository"), {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        "x-file-note": encodeURIComponent(trimmed),
        "x-upload-id": uploadId,
        "x-chunk-index": String(index),
        "x-chunk-total": String(pieces),
        "x-file-size": String(file.size),
      },
      body: blob,
    }).catch(() => null);
    if (!response) break;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "The upload stopped.");
    }
    const json = (await response.json()) as { id?: string; name?: string; note?: string; added?: string; size?: number };
    if (json.id && json.name && json.added && typeof json.size === "number") {
      saved = { id: json.id, name: json.name, note: json.note ?? "", added: json.added, size: json.size };
    }
    onProgress?.(Math.min(file.size, start + blob.size), file.size);
  }
  if (saved) return { ...saved, where: "preview" };
  if (file.size > 32 * 1024 * 1024) {
    throw new Error("This copy cannot keep a file that large. Open the preview and try again.");
  }
  const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const bytes = await file.arrayBuffer();
  const row = { id, name: file.name, note: trimmed, added: new Date().toISOString(), size: bytes.byteLength, bytes, where: "browser" as const };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(row);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return { id, name: row.name, note: row.note, added: row.added, size: row.size, where: "browser" };
}

export async function removeRepositoryFile(file: RepoFile) {
  if (file.where === "preview") {
    await fetch(api(`/api/repository?id=${encodeURIComponent(file.id)}`), { method: "DELETE" });
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(file.id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function readRepositoryFile(file: RepoFile): Promise<Uint8Array> {
  if (file.where === "preview") {
    const response = await fetch(api(`/api/repository?id=${encodeURIComponent(file.id)}`));
    if (!response.ok) throw new Error("Could not open that file.");
    return new Uint8Array(await response.arrayBuffer());
  }
  const db = await openDb();
  const row = await new Promise<{ bytes: ArrayBuffer } | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(file.id);
    request.onsuccess = () => resolve(request.result as { bytes: ArrayBuffer } | undefined);
    request.onerror = () => reject(request.error);
  });
  if (!row) throw new Error("That file is no longer in this browser.");
  return new Uint8Array(row.bytes);
}

export function previewText(bytes: Uint8Array): { kind: "text" | "hex"; body: string } {
  const slice = bytes.subarray(0, 4096);
  let printable = 0;
  for (const byte of slice) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable += 1;
  }
  if (slice.length > 0 && printable / slice.length > 0.85) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    return { kind: "text", body: bytes.length > slice.length ? `${text}\n…` : text };
  }
  const lines: string[] = [];
  const shown = bytes.subarray(0, 256);
  for (let i = 0; i < shown.length; i += 16) {
    const row = shown.subarray(i, i + 16);
    const hex = [...row].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const ascii = [...row].map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "·")).join("");
    lines.push(`${i.toString(16).toUpperCase().padStart(4, "0")}  ${hex.padEnd(16 * 3 - 1, " ")}  ${ascii}`);
  }
  const words: string[] = [];
  let run = "";
  const scan = bytes.subarray(0, 8192);
  for (const byte of scan) {
    if (byte >= 32 && byte < 127) run += String.fromCharCode(byte);
    else {
      if (run.length >= 4) words.push(run);
      run = "";
    }
  }
  if (run.length >= 4) words.push(run);
  const english = words.slice(0, 12).join("  ");
  const tail = bytes.length > shown.length ? "\n…" : "";
  return { kind: "hex", body: `${lines.join("\n")}${tail}${english ? `\n\nReadable: ${english}` : ""}` };
}
