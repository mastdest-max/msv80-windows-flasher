import { kwpBodies } from "./kdcan";
import type { HexSpan } from "./intel-hex";
import { describeNrc } from "./read-job";
import type { CableLink } from "./serial-session";

const BLOCK = 128;

export type FlashProgress = {
  phase: string;
  sent: number;
  total: number;
};

type Hit = { kind: "ok"; data: Uint8Array } | { kind: "nrc"; nrc: number } | { kind: "none" };

function answer(rx: Uint8Array, service: number): Hit {
  const positive = (service + 0x40) & 0xff;
  let nrc: number | null = null;
  for (const body of kwpBodies(rx)) {
    if (body.kind === "nrc" && body.service === service && body.nrc !== 0x78) nrc = body.nrc;
    if (body.kind === "ok" && body.service === positive) return { kind: "ok", data: body.data };
  }
  return nrc == null ? { kind: "none" } : { kind: "nrc", nrc };
}

async function ask(link: CableLink, can500: boolean, payload: Uint8Array, service: number, timeoutMs: number): Promise<Hit> {
  const rx = await link.requestDme(payload, can500, timeoutMs);
  return answer(rx, service);
}

function refuse(hit: Hit, action: string): string {
  if (hit.kind === "nrc") return `${action} ${describeNrc(hit.nrc)}`;
  return `${action} The DME did not answer.`;
}

function downloadPayload(address: number, size: number): Uint8Array {
  return Uint8Array.of(
    0x34,
    0x00,
    0x44,
    (address >>> 24) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 8) & 0xff,
    address & 0xff,
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
  );
}

/**
 * Write coalesced program spans with KWP 0x34 / 0x36 / 0x37.
 * Stops before any erase if the DME demands a security key.
 */
export async function flashSpans(
  link: CableLink,
  can500: boolean,
  spans: HexSpan[],
  onProgress: (progress: FlashProgress) => void,
): Promise<void> {
  const total = spans.reduce((sum, span) => sum + span.bytes.length, 0);
  onProgress({ phase: "Opening the programming session.", sent: 0, total });
  const session = await ask(link, can500, Uint8Array.of(0x10, 0x85), 0x10, 4000);
  if (session.kind !== "ok") {
    const seed = await ask(link, can500, Uint8Array.of(0x27, 0x01), 0x27, 4000);
    if (seed.kind === "ok" && seed.data.length > 1) {
      const hex = [...seed.data.subarray(1)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
      throw new Error(`The DME asked for security access. Seed ${hex}. Nothing was erased. The key lives in the WinKFP PRG, and this app will not invent one.`);
    }
    throw new Error(refuse(session.kind === "none" ? seed : session, "The programming session did not open."));
  }

  let erased = false;
  let sent = 0;
  for (const span of spans) {
    onProgress({ phase: `Asking to write ${span.bytes.length.toLocaleString()} bytes at ${span.address.toString(16)}.`, sent, total });
    let ready = await ask(link, can500, downloadPayload(span.address, span.bytes.length), 0x34, 8000);
    if (ready.kind === "nrc" && (ready.nrc === 0x22 || ready.nrc === 0x24 || ready.nrc === 0x33)) {
      if (ready.nrc === 0x33) {
        throw new Error("The DME refused the write until security access is granted. Nothing further was sent.");
      }
      if (!erased) {
        onProgress({ phase: "The DME wants the old block cleared first.", sent, total });
        const erase = await ask(link, can500, Uint8Array.of(0x31, 0x01, 0xff, 0x00), 0x31, 20000);
        if (erase.kind !== "ok") throw new Error(refuse(erase, "The DME would not clear the block."));
        erased = true;
        ready = await ask(link, can500, downloadPayload(span.address, span.bytes.length), 0x34, 8000);
      }
    }
    if (ready.kind !== "ok") {
      throw new Error(
        `${refuse(ready, "The DME would not accept this block.")}${erased ? " A clear was already sent. Leave the ignition on and run this job again." : ""}`,
      );
    }
    let sequence = 1;
    for (let offset = 0; offset < span.bytes.length; offset += BLOCK) {
      const piece = span.bytes.subarray(offset, Math.min(span.bytes.length, offset + BLOCK));
      const frame = new Uint8Array(2 + piece.length);
      frame[0] = 0x36;
      frame[1] = sequence & 0xff;
      frame.set(piece, 2);
      const hit = await ask(link, can500, frame, 0x36, 5000);
      if (hit.kind !== "ok") {
        throw new Error(
          `${refuse(hit, `The write stopped at byte ${sent.toLocaleString()}.`)}${erased ? " Leave the ignition on and run this job again." : ""}`,
        );
      }
      sequence = (sequence + 1) & 0xff;
      sent += piece.length;
      if (sent % (BLOCK * 8) === 0 || sent === total) onProgress({ phase: "Writing the program.", sent, total });
    }
    const done = await ask(link, can500, Uint8Array.of(0x37), 0x37, 8000);
    if (done.kind !== "ok") throw new Error(refuse(done, "The DME did not close the block."));
  }
  onProgress({ phase: "Resetting the DME.", sent: total, total });
  await ask(link, can500, Uint8Array.of(0x11, 0x01), 0x11, 4000);
}
