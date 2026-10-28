import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { connect as connectTcp, createServer as createTcpServer } from "node:net";
import { extname, join, normalize } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, session } from "electron";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".py": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const XHP_HOST = "192.168.4.1";
const XHP_PORTS = [23, 35000];

function wsFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) header = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function tryAdapterPort(port) {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: XHP_HOST, port, noDelay: true });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    }, 2000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function openAdapter() {
  let refused = false;
  let offline = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const port of XHP_PORTS) {
      if (refused && port === 35000) continue;
      try {
        return await tryAdapterPort(port);
      } catch (err) {
        const code = err && err.code;
        if (code === "ECONNREFUSED" && port === 35000) refused = true;
        else if (code === "ENETUNREACH" || code === "EHOSTUNREACH" || code === "ENETDOWN" || code === "EHOSTDOWN") offline = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  if (offline) {
    throw new Error("Windows is not on the adapter Wi-Fi. Turn off Connect automatically on your home Wi-Fi, join the adapter, and leave the scanner plugged in.");
  }
  throw new Error("The adapter did not open. Leave it plugged in, join its Wi-Fi, and press Connect again.");
}

function startXhpBridge() {
  let active = null;
  const server = createTcpServer((browser) => {
    let buffer = Buffer.alloc(0);
    let opened = false;
    let tcp = null;
    let gone = false;
    const drop = () => {
      gone = true;
      const socket = tcp;
      tcp = null;
      if (socket) socket.destroy();
      if (active === socket) active = null;
    };
    const takeFrames = () => {
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buffer.length < offset + maskLen + length) return;
        let payload = buffer.subarray(offset + maskLen, offset + maskLen + length);
        if (masked) {
          const mask = buffer.subarray(offset, offset + 4);
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        buffer = buffer.subarray(offset + maskLen + length);
        if (opcode === 0x8) {
          browser.end();
          drop();
          return;
        }
        if (opcode === 0x9) {
          browser.write(wsFrame(0x0a, payload));
          continue;
        }
        if (tcp && (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) && payload.length) tcp.write(payload);
      }
    };
    browser.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!opened) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString("latin1");
        buffer = buffer.subarray(end + 4);
        const key = head.match(/Sec-WebSocket-Key:\s*(.+)/i)?.[1]?.trim() ?? "";
        const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
        browser.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        opened = true;
        openAdapter()
          .then((socket) => {
            if (gone || browser.destroyed) {
              socket.destroy();
              return;
            }
            if (active) active.destroy();
            tcp = socket;
            active = socket;
            browser.write(wsFrame(0x1, "ok"));
            socket.on("data", (data) => {
              if (!browser.destroyed) browser.write(wsFrame(0x2, data));
            });
            socket.on("close", () => browser.end());
            socket.on("error", () => browser.end());
            if (buffer.length) takeFrames();
          })
          .catch((err) => {
            browser.write(wsFrame(0x1, err instanceof Error ? err.message : "The adapter did not open."));
            browser.end();
          });
        return;
      }
      takeFrames();
    });
    browser.on("close", drop);
    browser.on("error", drop);
  });
  server.on("error", () => {
    /* 8770 is already taken by a bridge the user started. */
  });
  server.listen(8770, "127.0.0.1");
}

function allowUsbLead() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_contents, permission) => permission === "serial");
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "serial");
  });
  ses.setDevicePermissionHandler((details) => details.deviceType === "serial");
  ses.on("select-serial-port", (event, portList, _contents, callback) => {
    event.preventDefault();
    if (portList.length === 0) {
      dialog.showMessageBox({ type: "warning", title: "USB lead", message: "No USB lead is plugged in.", buttons: ["OK"] });
      callback("");
      return;
    }
    const labels = portList.map((port) => port.displayName || port.portName || "Serial port");
    dialog
      .showMessageBox({
        type: "question",
        buttons: [...labels, "Cancel"],
        defaultId: 0,
        cancelId: labels.length,
        title: "USB lead",
        message: "Choose the cable.",
      })
      .then(({ response }) => {
        callback(response >= 0 && response < portList.length ? portList[response].portId : "");
      });
  });
}

function serve(handleRepository) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/repository") {
        await handleRepository(req, res);
        return;
      }
      const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      const wanted = relative === "/" || relative === "\\" ? "index.html" : relative.replace(/^[/\\]/, "");
      const file = join(dist, wanted);
      if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}

async function open() {
  process.chdir(app.getPath("userData"));
  const store = join(here, "repository-store.mjs");
  const devStore = join(here, "..", "scripts", "repository-store.mjs");
  const { handleRepository } = await import(pathToFileURL(existsSync(store) ? store : devStore).href);
  allowUsbLead();
  startXhpBridge();
  const url = await serve(handleRepository);
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "MSV Bench",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(here, "preload.cjs"),
    },
  });
  await window.loadURL(url);
}

app.whenReady().then(open);
app.on("window-all-closed", () => app.quit());
