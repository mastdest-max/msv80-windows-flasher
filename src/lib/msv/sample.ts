const MARKER = "SYNTHETIC_BENCH_SAMPLE_NOT_A_CALIBRATION";

function write(bytes: Uint8Array, offset: number, text: string) {
  for (let i = 0; i < text.length && offset + i < bytes.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

function paint(bytes: Uint8Array, from: number, to: number, step = 1) {
  const end = Math.min(bytes.length, to);
  for (let i = from; i < end; i += step) {
    let value = (i * 17 + (i >> 3)) & 0xff;
    if (value === 0x00 || value === 0xff) value = 0x5a;
    bytes[i] = value;
  }
}

function plantIdentity(bytes: Uint8Array, offset: number) {
  write(bytes, offset, "0049RK0MK80SMAQ1S");
  write(bytes, offset + 0x20, "MSV80.1");
  write(bytes, offset + 0x30, "9RKMK8");
  write(bytes, offset + 0x40, "5WK91169");
  write(bytes, offset + 0x50, "N51 SULEV");
  write(bytes, offset + 0x60, MARKER);
  write(bytes, offset + 0x90, "MK80S SAMPLE");
}

function plantMaps(bytes: Uint8Array, offset: number) {
  const names = ["IGNITION BASE", "VANOS INTAKE", "VANOS EXHAUST", "THROTTLE PLATE", "INJECTION TIME", "IDLE AIR", "KNOCK LIMIT"];
  names.forEach((name, index) => write(bytes, offset + index * 0x40, name));
}

/** Calibration-sized MSV80.1 sample. Filler maps, not a file from a car. */
export function syntheticCalibration(): Uint8Array {
  const bytes = new Uint8Array(255_952);
  plantIdentity(bytes, 0x80);
  plantMaps(bytes, 0x200);
  paint(bytes, 0x400, 0x8000);
  paint(bytes, 0xc000, 0x10000, 4);
  plantMaps(bytes, 0x14000);
  paint(bytes, 0x14200, 0x1a000);
  return bytes;
}

/** Full-size shell with a boot band and a calibration band. The gap stays empty. */
export function syntheticFullShell(): Uint8Array {
  const bytes = new Uint8Array(2_621_440);
  bytes.fill(0xff);
  write(bytes, 0x100, "MSV80.1 PROGRAM SAMPLE");
  plantIdentity(bytes, 0x140);
  paint(bytes, 0x1000, 0x6000);
  plantIdentity(bytes, 0x1c0000);
  plantMaps(bytes, 0x1c0200);
  paint(bytes, 0x1c0400, 0x1c8000);
  return bytes;
}
