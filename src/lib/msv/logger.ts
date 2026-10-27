import { kwpBodies } from "./kdcan";

export type Channel = {
  id: string;
  pid: number;
  name: string;
  unit: string;
  digits: number;
  group: "Engine" | "Air" | "Fuel" | "Temperature";
  decode: (a: number, b: number) => number;
};

export const FAST_CHANNEL_IDS = ["rpm", "pedal", "throttle", "plate"];

export const CHANNELS: Channel[] = [
  { id: "rpm", pid: 0x0c, group: "Engine", name: "Engine speed", unit: "rpm", digits: 0, decode: (a, b) => (a * 256 + b) / 4 },
  { id: "load", pid: 0x04, group: "Engine", name: "Engine load", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "absload", pid: 0x43, group: "Engine", name: "Absolute load", unit: "%", digits: 0, decode: (a, b) => ((a * 256 + b) * 100) / 255 },
  { id: "torque", pid: 0x62, group: "Engine", name: "Engine torque", unit: "%", digits: 0, decode: (a) => a - 125 },
  { id: "timing", pid: 0x0e, group: "Engine", name: "Timing advance", unit: "°", digits: 1, decode: (a) => a / 2 - 64 },
  { id: "speed", pid: 0x0d, group: "Engine", name: "Vehicle speed", unit: "km/h", digits: 0, decode: (a) => a },
  { id: "voltage", pid: 0x42, group: "Engine", name: "Module voltage", unit: "V", digits: 1, decode: (a, b) => (a * 256 + b) / 1000 },
  { id: "pedal", pid: 0x49, group: "Air", name: "Accelerator pedal", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "throttle", pid: 0x45, group: "Air", name: "Throttle", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "plate", pid: 0x11, group: "Air", name: "Throttle plate", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "commanded", pid: 0x4c, group: "Air", name: "Commanded throttle", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "map", pid: 0x0b, group: "Air", name: "Manifold pressure", unit: "kPa", digits: 0, decode: (a) => a },
  { id: "baro", pid: 0x33, group: "Air", name: "Barometric pressure", unit: "kPa", digits: 0, decode: (a) => a },
  { id: "maf", pid: 0x10, group: "Air", name: "Mass air", unit: "g/s", digits: 1, decode: (a, b) => (a * 256 + b) / 100 },
  { id: "iat", pid: 0x0f, group: "Air", name: "Intake air", unit: "°C", digits: 0, decode: (a) => a - 40 },
  { id: "stft", pid: 0x06, group: "Fuel", name: "Short fuel trim", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "ltft", pid: 0x07, group: "Fuel", name: "Long fuel trim", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "lambda", pid: 0x34, group: "Fuel", name: "Lambda", unit: "λ", digits: 3, decode: (a, b) => ((a * 256 + b) * 2) / 65536 },
  { id: "commandedLambda", pid: 0x44, group: "Fuel", name: "Commanded lambda", unit: "λ", digits: 3, decode: (a, b) => (a * 256 + b) / 32768 },
  { id: "rail", pid: 0x23, group: "Fuel", name: "Fuel rail pressure", unit: "bar", digits: 1, decode: (a, b) => (a * 256 + b) / 10 },
  { id: "coolant", pid: 0x05, group: "Temperature", name: "Coolant", unit: "°C", digits: 0, decode: (a) => a - 40 },
  { id: "oil", pid: 0x5c, group: "Temperature", name: "Engine oil", unit: "°C", digits: 0, decode: (a) => a - 40 },
  { id: "cat", pid: 0x3c, group: "Temperature", name: "Catalyst", unit: "°C", digits: 0, decode: (a, b) => (a * 256 + b) / 10 - 40 },
  { id: "ambient", pid: 0x46, group: "Temperature", name: "Ambient air", unit: "°C", digits: 0, decode: (a) => a - 40 },
];

const PID_DATA_BYTES: Record<number, number> = {
  0x04: 1,
  0x05: 1,
  0x06: 1,
  0x07: 1,
  0x0b: 1,
  0x0c: 2,
  0x0d: 1,
  0x0e: 1,
  0x0f: 1,
  0x10: 2,
  0x11: 1,
  0x23: 2,
  0x33: 1,
  0x34: 2,
  0x3c: 2,
  0x42: 2,
  0x43: 2,
  0x44: 2,
  0x45: 1,
  0x46: 1,
  0x49: 1,
  0x4c: 1,
  0x5c: 1,
  0x62: 1,
};

export type Sample = {
  t: number;
  values: Record<string, number | null>;
};

export type LogSession = {
  source: "sample" | "live";
  note: string;
  samples: Sample[];
};

/** Mode 01 payload. Prefer a checksummed KWP frame so the checksum is not used as the value. */
export function parseObdPayload(bytes: Uint8Array, pid: number): { a: number; b: number } | null {
  const need = PID_DATA_BYTES[pid] ?? 1;
  let sawMode01 = false;
  for (const body of kwpBodies(bytes)) {
    if (body.kind !== "ok" || body.service !== 0x41) continue;
    sawMode01 = true;
    if (body.data.length < 1 + need) continue;
    if (body.data[0] === pid) return pairAt(body.data, 1, need);
    const packed = packedPid(body.data, pid);
    if (packed) return packed;
  }
  if (sawMode01) return null;
  for (let i = 0; i + 2 + need <= bytes.length; i++) {
    if (bytes[i] !== 0x41 || bytes[i + 1] !== pid) continue;
    return pairAt(bytes, i + 2, need);
  }
  return null;
}

function pairAt(data: Uint8Array, at: number, need: number): { a: number; b: number } | null {
  const a = data[at] ?? 0;
  const b = need > 1 ? (data[at + 1] ?? 0) : 0;
  if (need > 1 && a === 0xff && b === 0xff) return null;
  return { a, b };
}

function packedPid(data: Uint8Array, pid: number): { a: number; b: number } | null {
  let index = 0;
  while (index < data.length) {
    const id = data[index] ?? 0;
    const size = PID_DATA_BYTES[id];
    if (size == null || index + 1 + size > data.length) return null;
    if (id === pid) return pairAt(data, index + 1, size);
    index += 1 + size;
  }
  return null;
}

export function parseObdText(text: string, pid: number): { a: number; b: number } | null {
  const hex = text.toUpperCase().replace(/[^0-9A-F]/g, "");
  const key = `41${pid.toString(16).padStart(2, "0").toUpperCase()}`;
  const at = hex.indexOf(key);
  if (at < 0 || hex.length < at + key.length + 2) return null;
  const a = Number.parseInt(hex.slice(at + key.length, at + key.length + 2), 16);
  const bRaw = hex.slice(at + key.length + 2, at + key.length + 4);
  const b = bRaw.length === 2 ? Number.parseInt(bRaw, 16) : 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return { a, b };
}

/** A fixed trace so the chart and CSV work before the lead is on the car. */
export function sampleLog(): LogSession {
  const samples: Sample[] = [];
  for (let i = 0; i < 48; i++) {
    const blip = Math.exp(-((i - 18) ** 2) / 16);
    const rpm = 740 + blip * 2100 + Math.sin(i / 2.5) * 12;
    const throttle = 4 + blip * 42;
    const load = 18 + blip * 55;
    const maf = 3.2 + blip * 28 + rpm / 900;
    samples.push({
      t: i * 500,
      values: {
        rpm,
        load,
        absload: load * 1.15,
        torque: 8 + blip * 72,
        timing: 6 + blip * 14,
        speed: i < 8 ? 0 : Math.min(48, (i - 8) * 1.6 + blip * 6),
        voltage: 13.8 + blip * 0.3,
        pedal: throttle,
        throttle,
        plate: 12 + blip * 55,
        commanded: 10 + blip * 58,
        map: 32 + blip * 18,
        baro: 98,
        maf,
        iat: 28 + blip * 4,
        stft: blip * 8 - 1.5,
        ltft: 2.4,
        lambda: blip > 0.4 ? 0.9 : 1.01,
        commandedLambda: blip > 0.4 ? 0.88 : 1,
        rail: 3.6 + blip * 1.4,
        coolant: 86 + i * 0.08,
        oil: 90 + i * 0.12,
        cat: 380 + blip * 90,
        ambient: 18,
      },
    });
  }
  return {
    source: "sample",
    note: "Sample trace, not from a car. The chart and CSV are here so you can check the logger before the lead is plugged into the DME.",
    samples,
  };
}

export function logToCsv(log: LogSession): string {
  const header = ["time_s", ...CHANNELS.map((channel) => `${channel.id}_${channel.unit.replace("°", "")}`)];
  const rows = log.samples.map((sample) => [
    (sample.t / 1000).toFixed(2),
    ...CHANNELS.map((channel) => {
      const value = sample.values[channel.id];
      return value == null ? "" : value.toFixed(channel.digits);
    }),
  ]);
  return [header, ...rows].map((row) => row.join(",")).join("\n");
}

export function latestOf(log: LogSession, id: string): number | null {
  for (let i = log.samples.length - 1; i >= 0; i--) {
    const value = log.samples[i].values[id];
    if (value != null) return value;
  }
  return null;
}
