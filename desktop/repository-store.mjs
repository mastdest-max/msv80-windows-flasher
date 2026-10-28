import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";

const ROOT = join(process.cwd(), "repository");
const FILES = join(ROOT, "files");
const PARTS = join(ROOT, "parts");
const INDEX = join(ROOT, "index.json");
const CHUNK_MAX = 40 * 1024 * 1024;
const FILE_MAX = 8 * 1024 * 1024 * 1024;

function load() {
  try {
    const rows = JSON.parse(readFileSync(INDEX, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function save(rows) {
  mkdirSync(FILES, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(rows, null, 2));
}

let indexChain = Promise.resolve();

function updateIndex(mutator) {
  const run = indexChain.then(() => {
    const rows = load();
    save(mutator(rows));
  });
  indexChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export function safeFileName(name) {
  const base = basename(String(name || "upload.bin"))
    .replace(/[^\w.\- ()+]+/g, "_")
    .slice(0, 120);
  return base && base !== "." && base !== ".." ? base : "upload.bin";
}

function safeId(value) {
  const id = String(value || "");
  return /^[a-z0-9-]{6,48}$/.test(id) ? id : null;
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readMeta(id) {
  try {
    return JSON.parse(readFileSync(join(PARTS, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function handleRepository(req, res) {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
          const method = (req.method ?? "GET").toUpperCase();
          if (method === "GET" && url.searchParams.get("pack")) {
            const wanted = new Set(url.searchParams.get("pack").split(",").filter(Boolean));
            const rows = load().filter((row) => wanted.has(row.id) && existsSync(join(FILES, row.stored)));
            if (rows.length === 0) {
              sendJson(res, 404, { error: "None of those files are in the repository." });
              return;
            }
            await streamStoredZip(res, rows);
            return;
          }
          if (method === "GET" && !url.searchParams.get("id")) {
            const rows = load().map(({ id, name, note, added, size }) => ({ id, name, note, added, size }));
            sendJson(res, 200, { files: rows });
            return;
          }
          if (method === "GET") {
            const id = url.searchParams.get("id") ?? "";
            const row = load().find((item) => item.id === id);
            const path = row ? join(FILES, row.stored) : "";
            if (!row || !existsSync(path)) {
              sendJson(res, 404, { error: "That file is not in the repository." });
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", "application/octet-stream");
            res.setHeader("content-length", String(statSync(path).size));
            res.setHeader("content-disposition", `attachment; filename="${safeFileName(row.name)}"`);
            createReadStream(path).pipe(res);
            return;
          }
          if (method === "DELETE") {
            const id = url.searchParams.get("id") ?? "";
            let removed = null;
            await updateIndex((rows) => {
              removed = rows.find((item) => item.id === id) ?? null;
              return rows.filter((item) => item.id !== id);
            });
            if (removed && existsSync(join(FILES, removed.stored))) unlinkSync(join(FILES, removed.stored));
            sendJson(res, 200, { ok: true });
            return;
          }
          if (method === "POST") {
            const uploadId = safeId(req.headers["x-upload-id"]);
            const index = Number(req.headers["x-chunk-index"] ?? "0");
            const total = Number(req.headers["x-chunk-total"] ?? "1");
            const fileSize = Number(req.headers["x-file-size"] ?? "0");
            const name = safeFileName(decodeURIComponent(String(req.headers["x-file-name"] ?? "upload.bin")));
            const note = decodeURIComponent(String(req.headers["x-file-note"] ?? "")).slice(0, 400);
            if (!uploadId || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
              sendJson(res, 400, { error: "That upload piece was not accepted." });
              return;
            }
            if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > FILE_MAX) {
              sendJson(res, 413, { error: "File is over 8 GB." });
              return;
            }
            mkdirSync(PARTS, { recursive: true });
            const growing = join(PARTS, `${uploadId}.bin`);
            if (index === 0) {
              const old = readMeta(uploadId);
              if (old && existsSync(growing)) unlinkSync(growing);
              writeFileSync(join(PARTS, `${uploadId}.json`), JSON.stringify({ name, note, size: fileSize, next: 0 }));
              writeFileSync(growing, Buffer.alloc(0));
            }
            const meta = readMeta(uploadId);
            if (!meta || meta.next !== index) {
              sendJson(res, 409, { error: "The pieces arrived out of order. Start the upload again." });
              return;
            }
            const wrote = await appendInto(req, growing);
            const soFar = statSync(growing).size;
            if (soFar > fileSize) {
              unlinkSync(growing);
              sendJson(res, 400, { error: "That file is larger than it claimed." });
              return;
            }
            meta.next = index + 1;
            if (meta.next < total) {
              writeFileSync(join(PARTS, `${uploadId}.json`), JSON.stringify(meta));
              sendJson(res, 200, { ok: true, received: meta.next, wrote });
              return;
            }
            if (soFar !== fileSize) {
              sendJson(res, 400, { error: "The file ended short. Start the upload again." });
              return;
            }
            const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const stored = `${id}-${name}`;
            mkdirSync(FILES, { recursive: true });
            renameSync(growing, join(FILES, stored));
            unlinkSync(join(PARTS, `${uploadId}.json`));
            const row = { id, name: meta.name, note: meta.note, added: new Date().toISOString(), size: soFar, stored };
            await updateIndex((rows) => [row, ...rows]);
            sendJson(res, 200, { id, name: row.name, note: row.note, added: row.added, size: row.size });
            return;
          }
          res.statusCode = 405;
          res.end("Method Not Allowed");
        } catch (err) {
          const tooBig = err && err.code === "LIMIT";
          sendJson(res, tooBig ? 413 : 500, { error: tooBig ? "One piece is too large." : "The repository could not store that file." });
        }
}

export function repositoryPlugin() {
  return {
    name: "app-builder:repository",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url ?? "").split("?", 1)[0] ?? "";
        if (pathOnly !== "/api/repository") {
          next();
          return;
        }
        await handleRepository(req, res);
      });
    },
  };
}

class WritableSink extends Writable {
  constructor(res) {
    super();
    this.response = res;
  }
  _write(chunk, _encoding, callback) {
    if (this.response.write(chunk)) callback();
    else this.response.once("drain", callback);
  }
}

function u16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0);
  return buf;
}

function u64(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

async function writeAll(res, buf) {
  if (res.write(buf)) return;
  await new Promise((resolve) => res.once("drain", resolve));
}

async function streamStoredZip(res, rows) {
  const files = rows.map((row) => {
    const name = Buffer.from(safeFileName(row.name));
    const path = join(FILES, row.stored);
    return { name, path, size: statSync(path).size };
  });
  let total = 56 + 20 + 22;
  for (const file of files) total += 30 + 20 + file.name.length + file.size + 24 + 46 + 28 + file.name.length;
  res.statusCode = 200;
  res.setHeader("content-type", "application/zip");
  res.setHeader("content-length", String(total));
  res.setHeader("content-disposition", 'attachment; filename="repository.zip"');
  const central = [];
  let offset = 0;
  for (const file of files) {
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(45),
      u16(0x08),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(0xffffffff),
      u32(0xffffffff),
      u16(file.name.length),
      u16(20),
      file.name,
      u16(1),
      u16(16),
      u64(file.size),
      u64(file.size),
    ]);
    await writeAll(res, local);
    let crc = 0;
    await pipeline(
      createReadStream(file.path, { highWaterMark: 4 * 1024 * 1024 }),
      new Transform({
        transform(chunk, _encoding, callback) {
          crc = crc32(chunk, crc);
          callback(null, chunk);
        },
      }),
      new WritableSink(res),
    );
    const desc = Buffer.concat([u32(0x08074b50), u32(crc), u64(file.size), u64(file.size)]);
    await writeAll(res, desc);
    central.push({ name: file.name, crc, size: file.size, offset });
    offset += local.length + file.size + desc.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const item of central) {
    const cd = Buffer.concat([
      u32(0x02014b50),
      u16(45),
      u16(45),
      u16(0x08),
      u16(0),
      u16(0),
      u16(0),
      u32(item.crc),
      u32(0xffffffff),
      u32(0xffffffff),
      u16(item.name.length),
      u16(28),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(0xffffffff),
      item.name,
      u16(1),
      u16(24),
      u64(item.size),
      u64(item.size),
      u64(item.offset),
    ]);
    await writeAll(res, cd);
    cdSize += cd.length;
  }
  const zip64 = Buffer.concat([
    u32(0x06064b50),
    u64(44),
    u16(45),
    u16(45),
    u32(0),
    u32(0),
    u64(central.length),
    u64(central.length),
    u64(cdSize),
    u64(cdStart),
  ]);
  await writeAll(res, zip64);
  const locator = Buffer.concat([u32(0x07064b50), u32(0), u64(cdStart + cdSize), u32(1)]);
  await writeAll(res, locator);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0xffff),
    u16(0xffff),
    u16(0xffff),
    u16(0xffff),
    u32(0xffffffff),
    u32(0xffffffff),
    u16(0),
  ]);
  res.end(end);
}

async function appendInto(req, dest) {
  let size = 0;
  const limited = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > CHUNK_MAX) {
        const error = new Error("One piece is too large.");
        error.code = "LIMIT";
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(req, limited, createWriteStream(dest, { flags: "a" }));
  return size;
}
