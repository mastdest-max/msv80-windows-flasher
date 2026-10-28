import { kwpBodies } from "./kdcan";

export type Channel = {
  id: string;
  pid: number;
  name: string;
  unit: string;
  digits: number;
  group: "Engine" | "Air" | "Fuel" | "Temperature" | "Chassis" | "N52" | "DME";
  /** BMW measurement id from the Test0 MSV80 log. Absent for ordinary OBD channels. */
  local?: number;
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
  { id: "demand", pid: 0x61, group: "Engine", name: "Driver demand", unit: "%", digits: 0, decode: (a) => a - 125 },
  { id: "refTorque", pid: 0x63, group: "Engine", name: "Reference torque", unit: "Nm", digits: 0, decode: (a, b) => a * 256 + b },
  { id: "runtime", pid: 0x1f, group: "Engine", name: "Run time", unit: "s", digits: 0, decode: (a, b) => a * 256 + b },
  { id: "distance", pid: 0x31, group: "Engine", name: "Distance since clear", unit: "km", digits: 0, decode: (a, b) => a * 256 + b },
  { id: "milTime", pid: 0x4d, group: "Engine", name: "Time with a fault", unit: "min", digits: 0, decode: (a, b) => a * 256 + b },
  { id: "sinceClear", pid: 0x4e, group: "Engine", name: "Time since clear", unit: "min", digits: 0, decode: (a, b) => a * 256 + b },
  { id: "milDist", pid: 0x21, group: "Engine", name: "Distance with a fault", unit: "km", digits: 0, decode: (a, b) => a * 256 + b },
  { id: "fuelRate", pid: 0x5e, group: "Engine", name: "Fuel rate", unit: "L/h", digits: 2, decode: (a, b) => (a * 256 + b) * 0.05 },
  { id: "pedal", pid: 0x49, group: "Air", name: "Accelerator pedal", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "pedalRel", pid: 0x5a, group: "Air", name: "Relative pedal", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "pedalD", pid: 0x4a, group: "Air", name: "Pedal D", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "throttle", pid: 0x45, group: "Air", name: "Throttle", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "plate", pid: 0x11, group: "Air", name: "Throttle plate", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "throttleB", pid: 0x47, group: "Air", name: "Throttle B", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "throttleC", pid: 0x48, group: "Air", name: "Throttle C", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "commanded", pid: 0x4c, group: "Air", name: "Commanded throttle", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "egr", pid: 0x2c, group: "Air", name: "Commanded EGR", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "egrError", pid: 0x2d, group: "Air", name: "EGR error", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "pedalE", pid: 0x4b, group: "Air", name: "Pedal E", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "airStatus", pid: 0x12, group: "Air", name: "Secondary air", unit: "", digits: 0, decode: (a) => a },
  { id: "evapAbs", pid: 0x53, group: "Air", name: "EVAP absolute", unit: "kPa", digits: 2, decode: (a, b) => (a * 256 + b) / 200 },
  { id: "map", pid: 0x0b, group: "Air", name: "Manifold pressure", unit: "kPa", digits: 0, decode: (a) => a },
  { id: "baro", pid: 0x33, group: "Air", name: "Barometric pressure", unit: "kPa", digits: 0, decode: (a) => a },
  { id: "maf", pid: 0x10, group: "Air", name: "Mass air", unit: "g/s", digits: 1, decode: (a, b) => (a * 256 + b) / 100 },
  { id: "iat", pid: 0x0f, group: "Air", name: "Intake air", unit: "°C", digits: 0, decode: (a) => a - 40 },
  { id: "stft", pid: 0x06, group: "Fuel", name: "Short fuel trim", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "ltft", pid: 0x07, group: "Fuel", name: "Long fuel trim", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "stft2", pid: 0x08, group: "Fuel", name: "Short trim bank 2", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "ltft2", pid: 0x09, group: "Fuel", name: "Long trim bank 2", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "lambda", pid: 0x34, group: "Fuel", name: "Lambda", unit: "λ", digits: 3, decode: (a, b) => ((a * 256 + b) * 2) / 65536 },
  { id: "wideband1", pid: 0x24, group: "Fuel", name: "Wideband bank 1", unit: "λ", digits: 3, decode: (a, b) => ((a * 256 + b) * 2) / 65536 },
  { id: "wideband2", pid: 0x26, group: "Fuel", name: "Wideband bank 2", unit: "λ", digits: 3, decode: (a, b) => ((a * 256 + b) * 2) / 65536 },
  { id: "commandedLambda", pid: 0x44, group: "Fuel", name: "Commanded lambda", unit: "λ", digits: 3, decode: (a, b) => (a * 256 + b) / 32768 },
  { id: "o2", pid: 0x14, group: "Fuel", name: "O2 sensor 1", unit: "V", digits: 3, decode: (a) => a * 0.005 },
  { id: "o2b", pid: 0x15, group: "Fuel", name: "O2 sensor 2", unit: "V", digits: 3, decode: (a) => a * 0.005 },
  { id: "o2bank2", pid: 0x18, group: "Fuel", name: "O2 bank 2", unit: "V", digits: 3, decode: (a) => a * 0.005 },
  { id: "injTiming", pid: 0x5d, group: "Fuel", name: "Injection timing", unit: "°", digits: 1, decode: (a, b) => (a * 256 + b) / 128 - 210 },
  { id: "rail", pid: 0x23, group: "Fuel", name: "Fuel rail pressure", unit: "kPa", digits: 0, decode: (a, b) => (a * 256 + b) * 10 },
  { id: "fuelGauge", pid: 0x0a, group: "Fuel", name: "Fuel pressure", unit: "kPa", digits: 0, decode: (a) => a * 3 },
  { id: "purge", pid: 0x2e, group: "Fuel", name: "Purge", unit: "%", digits: 0, decode: (a) => (a * 100) / 255 },
  { id: "railAbs", pid: 0x59, group: "Fuel", name: "Rail absolute", unit: "kPa", digits: 0, decode: (a, b) => (a * 256 + b) * 10 },
  { id: "stftSec", pid: 0x55, group: "Fuel", name: "Rear trim bank 1", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "ltftSec", pid: 0x56, group: "Fuel", name: "Rear long trim bank 1", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "stftSec2", pid: 0x57, group: "Fuel", name: "Rear trim bank 2", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "ltftSec2", pid: 0x58, group: "Fuel", name: "Rear long trim bank 2", unit: "%", digits: 1, decode: (a) => ((a - 128) * 100) / 128 },
  { id: "coolant", pid: 0x05, group: "Temperature", name: "Coolant", unit: "°C", digits: 0, decode: (a) => a - 40 },
  { id: "oil", pid: 0x5c, group: "Temperature", name: "Engine oil", unit: "°C", digits: 0, decode: (a) => a - 40 },
  { id: "cat", pid: 0x3c, group: "Temperature", name: "Catalyst bank 1", unit: "°C", digits: 0, decode: (a, b) => (a * 256 + b) / 10 - 40 },
  { id: "cat2", pid: 0x3e, group: "Temperature", name: "Catalyst bank 2", unit: "°C", digits: 0, decode: (a, b) => (a * 256 + b) / 10 - 40 },
  { id: "cat1b", pid: 0x3d, group: "Temperature", name: "Catalyst bank 1 rear", unit: "°C", digits: 0, decode: (a, b) => (a * 256 + b) / 10 - 40 },
  { id: "cat2b", pid: 0x3f, group: "Temperature", name: "Catalyst bank 2 rear", unit: "°C", digits: 0, decode: (a, b) => (a * 256 + b) / 10 - 40 },
  { id: "egt", pid: 0x78, group: "Temperature", name: "Exhaust temp", unit: "°C", digits: 0, decode: (a, b) => (a * 256 + b) / 10 - 40 },
  { id: "wheelFl", pid: -1, group: "Chassis", name: "Front left wheel", unit: "count", digits: 0, decode: (a) => a },
  { id: "wheelFr", pid: -1, group: "Chassis", name: "Front right wheel", unit: "count", digits: 0, decode: (a) => a },
  { id: "wheelRl", pid: -1, group: "Chassis", name: "Rear left wheel", unit: "count", digits: 0, decode: (a) => a },
  { id: "wheelRr", pid: -1, group: "Chassis", name: "Rear right wheel", unit: "count", digits: 0, decode: (a) => a },
  { id: "caseTemp", pid: -1, group: "Chassis", name: "Clutch temperature", unit: "count", digits: 0, decode: (a) => a },
  { id: "caseAngle", pid: -1, group: "Chassis", name: "Clutch angle", unit: "count", digits: 0, decode: (a) => a },
  { id: "clutchTorque", pid: -1, group: "Chassis", name: "Clutch torque", unit: "count", digits: 0, decode: (a) => a },
  { id: "valvetronic", pid: -1, local: 0x5a49, group: "N52", name: "Valvetronic", unit: "raw", digits: 0, decode: (a) => a },
  { id: "vanosIn", pid: -1, local: 0x4506, group: "N52", name: "Intake VANOS", unit: "raw", digits: 0, decode: (a) => a },
  { id: "vanosOut", pid: -1, local: 0x4507, group: "N52", name: "Exhaust VANOS", unit: "raw", digits: 0, decode: (a) => a },
  { id: "vanosInAdapt", pid: -1, local: 0x5896, group: "N52", name: "Intake VANOS adapt", unit: "raw", digits: 0, decode: (a) => a },
  { id: "vanosOutAdapt", pid: -1, local: 0x5897, group: "N52", name: "Exhaust VANOS adapt", unit: "raw", digits: 0, decode: (a) => a },
  { id: "lambda1", pid: -1, local: 0x5a50, group: "N52", name: "Lambda bank 1", unit: "raw", digits: 0, decode: (a) => a },
  { id: "lambda2", pid: -1, local: 0x5a51, group: "N52", name: "Lambda bank 2", unit: "raw", digits: 0, decode: (a) => a },
  { id: "integrator1", pid: -1, local: 0x5a11, group: "N52", name: "Integrator bank 1", unit: "raw", digits: 0, decode: (a) => a },
  { id: "integrator2", pid: -1, local: 0x5a12, group: "N52", name: "Integrator bank 2", unit: "raw", digits: 0, decode: (a) => a },
  { id: "lambdaCtrl", pid: -1, local: 0x4705, group: "N52", name: "Lambda control", unit: "raw", digits: 0, decode: (a) => a },
  { id: "ignition", pid: -1, local: 0x4610, group: "N52", name: "Ignition angle", unit: "raw", digits: 0, decode: (a) => a },
  { id: "knock", pid: -1, local: 0x5a3d, group: "N52", name: "Knock", unit: "raw", digits: 0, decode: (a) => a },
  { id: "inj1", pid: -1, local: 0x5b00, group: "N52", name: "Injection 1", unit: "raw", digits: 0, decode: (a) => a },
  { id: "inj2", pid: -1, local: 0x5b01, group: "N52", name: "Injection 2", unit: "raw", digits: 0, decode: (a) => a },
  { id: "inj3", pid: -1, local: 0x5b02, group: "N52", name: "Injection 3", unit: "raw", digits: 0, decode: (a) => a },
  { id: "inj4", pid: -1, local: 0x5b03, group: "N52", name: "Injection 4", unit: "raw", digits: 0, decode: (a) => a },
  { id: "inj5", pid: -1, local: 0x5b04, group: "N52", name: "Injection 5", unit: "raw", digits: 0, decode: (a) => a },
  { id: "inj6", pid: -1, local: 0x5b05, group: "N52", name: "Injection 6", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeRpm", pid: -1, local: 0x4807, group: "DME", name: "DME speed", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmePedal", pid: -1, local: 0x4200, group: "DME", name: "DME pedal", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeThrottle", pid: -1, local: 0x4600, group: "DME", name: "DME throttle", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeLoad", pid: -1, local: 0x4203, group: "DME", name: "DME load", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeTarget", pid: -1, local: 0x4201, group: "DME", name: "DME target", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeFill", pid: -1, local: 0x4202, group: "DME", name: "DME filling", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeAir", pid: -1, local: 0x4205, group: "DME", name: "DME intake", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeCoolant", pid: -1, local: 0x4300, group: "DME", name: "DME coolant", unit: "raw", digits: 0, decode: (a) => a },
  { id: "dmeSupply", pid: -1, local: 0x5813, group: "DME", name: "DME supply", unit: "raw", digits: 0, decode: (a) => a },
  { id: "idleAir", pid: -1, local: 0x4402, group: "DME", name: "Idle air", unit: "raw", digits: 0, decode: (a) => a },
  { id: "throttle2", pid: -1, local: 0x4601, group: "DME", name: "Throttle sensor 2", unit: "raw", digits: 0, decode: (a) => a },
  { id: "cyl1", pid: -1, local: 0x5a42, group: "DME", name: "Cylinder 1", unit: "raw", digits: 0, decode: (a) => a },
  { id: "cyl2", pid: -1, local: 0x5a43, group: "DME", name: "Cylinder 2", unit: "raw", digits: 0, decode: (a) => a },
  { id: "cyl3", pid: -1, local: 0x5a44, group: "DME", name: "Cylinder 3", unit: "raw", digits: 0, decode: (a) => a },
  { id: "cyl4", pid: -1, local: 0x5a45, group: "DME", name: "Cylinder 4", unit: "raw", digits: 0, decode: (a) => a },
  { id: "cyl5", pid: -1, local: 0x5a46, group: "DME", name: "Cylinder 5", unit: "raw", digits: 0, decode: (a) => a },
  { id: "cyl6", pid: -1, local: 0x5a47, group: "DME", name: "Cylinder 6", unit: "raw", digits: 0, decode: (a) => a },
];

const PID_DATA_BYTES: Record<number, number> = {
  0x04: 1,
  0x05: 1,
  0x06: 1,
  0x07: 1,
  0x08: 1,
  0x09: 1,
  0x0a: 1,
  0x0b: 1,
  0x0c: 2,
  0x0d: 1,
  0x0e: 1,
  0x0f: 1,
  0x10: 2,
  0x11: 1,
  0x14: 2,
  0x15: 2,
  0x1f: 2,
  0x21: 2,
  0x23: 2,
  0x24: 4,
  0x26: 4,
  0x2c: 1,
  0x2d: 1,
  0x2e: 1,
  0x2f: 1,
  0x30: 1,
  0x31: 2,
  0x32: 2,
  0x33: 1,
  0x34: 2,
  0x3c: 2,
  0x3d: 2,
  0x3e: 2,
  0x3f: 2,
  0x42: 2,
  0x43: 2,
  0x44: 2,
  0x45: 1,
  0x46: 1,
  0x47: 1,
  0x48: 1,
  0x49: 1,
  0x4a: 1,
  0x4c: 1,
  0x4d: 2,
  0x4e: 2,
  0x5a: 1,
  0x18: 2,
  0x5c: 1,
  0x5d: 2,
  0x5e: 2,
  0x61: 1,
  0x62: 1,
  0x12: 1,
  0x4b: 1,
  0x53: 2,
  0x55: 2,
  0x56: 2,
  0x57: 2,
  0x58: 2,
  0x59: 2,
  0x63: 2,
  0x78: 2,
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
        rail: 350 + blip * 140,
        fuelGauge: 380,
        purge: blip * 22,
        level: 62,
        coolant: 86 + i * 0.08,
        oil: 90 + i * 0.12,
        cat: 380 + blip * 90,
        cat2: 360 + blip * 80,
        ambient: 18,
        demand: 5 + blip * 70,
        refTorque: 230,
        runtime: 120 + i,
        fuelRate: 0.6 + blip * 8,
        pedalRel: throttle,
        pedalD: throttle * 0.98,
        throttleB: 8 + blip * 40,
        throttleC: 8 + blip * 36,
        egr: 0,
        stft2: blip * 6 - 1,
        ltft2: 1.8,
        o2: blip > 0.4 ? 0.15 : 0.45,
        o2b: 0.42,
        o2bank2: 0.44,
        wideband1: blip > 0.4 ? 0.9 : 1.008,
        wideband2: blip > 0.4 ? 0.91 : 1.004,
        injTiming: 320 - blip * 40,
        distance: 1280,
        milTime: 0,
        sinceClear: 420,
        warmups: 14,
        milDist: 0,
        pedalE: throttle,
        airStatus: 0,
        evapAbs: 1.2,
        railAbs: 380,
        stftSec: blip * 3 - 0.4,
        ltftSec: 0.5,
        stftSec2: blip * 2 - 0.3,
        ltftSec2: 0.4,
        egt: 280 + blip * 220,
        egrError: 0,
        evap: 18,
        cat1b: 340 + blip * 40,
        cat2b: 330 + blip * 36,
        dmeRpm: rpm,
        dmePedal: throttle * 10,
        dmeThrottle: 40 + blip * 200,
        dmeLoad: load * 10,
        dmeTarget: 20 + blip * 30,
        dmeFill: 18 + blip * 40,
        dmeAir: 28,
        dmeCoolant: 86,
        dmeSupply: 138,
        idleAir: 12,
        throttle2: 40,
        cyl1: 0,
        cyl2: 0,
        cyl3: 0,
        cyl4: 0,
        cyl5: 0,
        cyl6: 0,
        wheelFl: i < 8 ? 0 : 400 + i * 12,
        wheelFr: i < 8 ? 0 : 402 + i * 12,
        wheelRl: i < 8 ? 0 : 398 + i * 12,
        wheelRr: i < 8 ? 0 : 401 + i * 12,
        caseTemp: 40 + i * 0.2,
        caseAngle: 120 + blip * 30,
        clutchTorque: 8 + blip * 40,
        valvetronic: 180 + blip * 400,
        vanosIn: 850,
        vanosOut: -1100,
        vanosInAdapt: 4,
        vanosOutAdapt: -6,
        lambda1: 1000,
        lambda2: 998,
        integrator1: 12,
        integrator2: 8,
        lambdaCtrl: 0,
        ignition: 80 + blip * 40,
        knock: 0,
        inj1: 220,
        inj2: 218,
        inj3: 221,
        inj4: 219,
        inj5: 220,
        inj6: 217,
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
