import { kwpBodies } from "./kdcan";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import type { CableLink } from "./serial-session";

export const RSA_PROGRAM = "0049QK0MI20S";
export const RSA_FILE = "MSV80_RSADelete_0049QK0MI20S.0pa";

export function rsaDeleteUrl(): string {
  const prefix = typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
  return `${prefix}/msv80/${RSA_FILE}`;
}

export type SecurityState = { unlocked: boolean; detail: string };

function reply(rx: Uint8Array, service: number): { kind: "ok"; data: Uint8Array } | { kind: "nrc"; nrc: number } | { kind: "none" } {
  const positive = (service + 0x40) & 0xff;
  let nrc: number | null = null;
  for (const body of kwpBodies(rx)) {
    if (body.kind === "nrc" && body.service === service && body.nrc !== 0x78) nrc = body.nrc;
    if (body.kind === "ok" && body.service === positive) return { kind: "ok", data: body.data };
  }
  return nrc == null ? { kind: "none" } : { kind: "nrc", nrc };
}

/** Ask the DME to open security before a BIN read. Does not guess a key and does not write. */
export async function openBinSecurity(link: CableLink, can500: boolean): Promise<SecurityState> {
  await link.requestDme(Uint8Array.of(0x10, 0x86), can500, 3000);
  let seedRx = await link.requestDme(Uint8Array.of(0x27, 0x01), can500, 3000);
  let seed = reply(seedRx, 0x27);
  if (seed.kind === "nrc" && seed.nrc === 0x22) {
    await link.requestDme(Uint8Array.of(0x10, 0x85), can500, 3000);
    seedRx = await link.requestDme(Uint8Array.of(0x27, 0x01), can500, 3000);
    seed = reply(seedRx, 0x27);
  }
  if (seed.kind === "ok") {
    const payload = seed.data[0] === 0x01 ? seed.data.subarray(1) : seed.data;
    if (payload.length === 0 || payload.every((byte) => byte === 0)) {
      return { unlocked: true, detail: "Security is already open. Starting the BIN read." };
    }
    const hex = [...payload].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return {
      unlocked: false,
      detail: `The DME is locked. Seed ${hex}. Start the security bypass only if a tune or a stock file is ready to write next. The car will not start if the bypass is left on its own.`,
    };
  }
  if (seed.kind === "nrc" && (seed.nrc === 0x11 || seed.nrc === 0x12)) {
    return { unlocked: true, detail: "This DME did not ask for a key. Starting the BIN read." };
  }
  if (seed.kind === "nrc" && seed.nrc === 0x37) {
    return { unlocked: false, detail: "The DME is waiting after a refused key. Leave the ignition on and try the BIN again in a minute." };
  }
  return { unlocked: true, detail: "No security seed came back. Starting the BIN read." };
}
