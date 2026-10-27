import type { SerialPortLike } from "@/lib/msv/serial-session";

/** xHP's own app opens this address with a raw socket. A normal Chrome tab cannot. */
export const XHP_HOST = "192.168.4.1";
const TCP_PORTS = [35000, 23];

type TcpOpened = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
type TcpHandle = { opened: Promise<TcpOpened>; close: () => Promise<void> | void };

const BRIDGE = "ws://127.0.0.1:8770";
const BLOCKED =
  "Chrome still cannot open the adapter port by itself. Download the bridge, run python3 xhp-bridge.py on this computer, join the adapter Wi-Fi, then press Connect again.";

function tcpConstructors(): Array<(host: string, port: number) => TcpHandle> {
  const ctor = (globalThis as { TCPSocket?: unknown }).TCPSocket;
  if (typeof ctor !== "function") return [];
  const Factory = ctor as new (...args: unknown[]) => TcpHandle;
  return [
    (host, port) => new Factory(host, port),
    (host, port) => new Factory(host, { port }),
  ];
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(label));
      },
    );
  });
}

function streamsFromWebSocket(socket: WebSocket): TcpOpened & { close: () => Promise<void> } {
  const reader = new ReadableStream<Uint8Array>({
    start(controller) {
      socket.onmessage = (event) => {
        const data = event.data;
        if (typeof data === "string") {
          if (data === "ok") return;
          return;
        }
        if (data instanceof ArrayBuffer) controller.enqueue(new Uint8Array(data));
        else if (ArrayBuffer.isView(data)) controller.enqueue(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      };
      socket.onclose = () => controller.close();
      socket.onerror = () => controller.error(new Error("The adapter socket closed."));
    },
    cancel() {
      socket.close();
    },
  });
  const writer = new WritableStream<Uint8Array>({
    write(chunk) {
      socket.send(chunk);
    },
    close() {
      socket.close();
    },
  });
  return {
    readable: reader,
    writable: writer,
    close: () => {
      socket.close();
      return Promise.resolve();
    },
  };
}

function openBridge(): Promise<TcpOpened & { close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(BRIDGE);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(BLOCKED));
      return;
    }
    socket.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(BLOCKED));
    }, 2500);
    const fail = () => {
      clearTimeout(timer);
      reject(new Error(BLOCKED));
    };
    socket.onerror = fail;
    socket.onclose = fail;
    socket.onmessage = (event) => {
      if (event.data !== "ok") return;
      clearTimeout(timer);
      socket.onerror = null;
      socket.onclose = null;
      resolve(streamsFromWebSocket(socket));
    };
  });
}

async function openTcp(host: string, port: number): Promise<TcpOpened & { close: () => Promise<void> }> {
  const factories = tcpConstructors();
  if (factories.length === 0) throw new Error(BLOCKED);
  let last = BLOCKED;
  for (const make of factories) {
    try {
      const socket = make(host, port);
      const opened = await withTimeout(socket.opened, 4000, `No answer from ${host}:${port}.`);
      return {
        readable: opened.readable,
        writable: opened.writable,
        close: async () => {
          await socket.close();
        },
      };
    } catch (err) {
      last = err instanceof Error ? err.message : last;
    }
  }
  throw new Error(last);
}

export function xhpWifiPort(log: (line: string) => void): SerialPortLike {
  let readable: ReadableStream<Uint8Array> | null = null;
  let writable: WritableStream<Uint8Array> | null = null;
  let closer: (() => Promise<void>) | null = null;
  return {
    get readable() {
      return readable;
    },
    get writable() {
      return writable;
    },
    async open() {
      log("Opening the adapter through the local bridge.");
      try {
        const opened = await openBridge();
        readable = opened.readable;
        writable = opened.writable;
        closer = opened.close;
        log("xHP adapter port is open.");
        return;
      } catch {
        /* The bridge is what gives Chrome the raw port. */
      }
      if (tcpConstructors().length > 0) {
        for (const port of TCP_PORTS) {
          try {
            log(`Opening ${XHP_HOST}:${port}.`);
            const opened = await openTcp(XHP_HOST, port);
            readable = opened.readable;
            writable = opened.writable;
            closer = opened.close;
            log(`xHP adapter open at ${XHP_HOST}:${port}.`);
            return;
          } catch {
            /* Try the next port. */
          }
        }
      }
      throw new Error(BLOCKED);
    },
    async close() {
      await closer?.();
      readable = null;
      writable = null;
    },
    async setSignals() {},
    direct: true,
    getInfo() {
      return {};
    },
  };
}
