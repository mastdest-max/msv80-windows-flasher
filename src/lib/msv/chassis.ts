import { kwpBodies } from "./kdcan";

export type ChassisRow = {
  id: string;
  name: string;
  module: string;
  text: string;
};

export function words(data: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) out.push((data[i] << 8) | data[i + 1]);
  return out;
}

function hex(data: Uint8Array): string {
  return [...data].map((value) => value.toString(16).padStart(2, "0")).join(" ").toUpperCase();
}

export function localPayload(raw: Uint8Array, id: number): Uint8Array | "refused" | null {
  for (const body of kwpBodies(raw)) {
    if (body.kind === "nrc") return "refused";
    if (body.kind === "ok" && body.service === 0x61 && body.data[0] === id) return body.data.subarray(1);
  }
  return null;
}

export function describeLocal(raw: Uint8Array, id: number): string {
  const payload = localPayload(raw, id);
  if (payload === "refused") return `Refused block ${id.toString(16).toUpperCase()}.`;
  if (!payload) return "No reply.";
  return describeBlock(payload, "single");
}

export function describeBlock(data: Uint8Array, kind: "single" | "wheels" | "case"): string {
  if (data.length === 0) return "The module answered with an empty block.";
  const raw = hex(data);
  if (kind === "wheels" && data.length >= 8) {
    const speeds = words(data).slice(0, 4);
    return `Front left ${speeds[0]}, front right ${speeds[1]}, rear left ${speeds[2]}, rear right ${speeds[3]}. Unscaled counts, not km/h yet. Raw ${raw}.`;
  }
  if (kind === "case" && data.length >= 4) {
    const [temp, angle] = words(data);
    return `Temperature count ${temp}, actuator count ${angle}. Not °C or degrees until the scaling is confirmed. Raw ${raw}.`;
  }
  const value = words(data)[0];
  return value == null
    ? `Raw ${raw}.`
    : `Count ${value}. Not degrees until the scaling is confirmed. Raw ${raw}.`;
}
