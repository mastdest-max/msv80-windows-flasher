import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
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
    },
  });
  await window.loadURL(url);
}

app.whenReady().then(open);
app.on("window-all-closed", () => app.quit());
