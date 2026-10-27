import { hexBytes, kwpBodies } from "./kdcan";

export type FamilyId = "MSV80" | "MSV80.1" | "MSV70";

export type ProgramHit = {
  key: string;
  code: string;
  count: number;
  example: string;
};

export type Identity = {
  programs: ProgramHit[];
  shorts: { id: string; count: number }[];
  hardware: string[];
  named: FamilyId | null;
};

const FAMILY_BY_KEY: Record<string, FamilyId> = {
  QK: "MSV80",
  RK: "MSV80.1",
  PP: "MSV70",
};

export function familyForKey(key: string): FamilyId | null {
  return FAMILY_BY_KEY[key] ?? null;
}

export function engineFor(family: FamilyId | null): string {
  if (family === "MSV80.1") return "N51";
  if (family === "MSV80") return "N52N / N52K";
  if (family === "MSV70") return "N52";
  return "Unknown";
}

function pullProgram(text: string, start: number): { key: string; code: string; full: string; end: number } | null {
  if (text.slice(start, start + 4) !== "0049") return null;
  const key = text.slice(start + 4, start + 6);
  if (!/^[A-Z0-9]{2}$/.test(key) || text[start + 6] !== "0") return null;
  const code = text.slice(start + 7, start + 12);
  if (!/^[A-Z][A-Z0-9]{3}S$/.test(code)) return null;
  let suffix = "";
  let index = start + 12;
  while (index < text.length && suffix.length < 6) {
    if (text.startsWith("0049", index) || text.startsWith("WBA", index)) break;
    const ch = text[index];
    if (!/[A-Z0-9]/.test(ch)) break;
    suffix += ch;
    index += 1;
  }
  return { key, code, full: `0049${key}0${code}${suffix}`, end: index };
}

export function identifyText(text: string): Identity {
  const programs = new Map<string, { key: string; code: string; count: number; examples: Map<string, number> }>();
  for (let i = 0; i <= text.length - 12; i++) {
    if (text[i] !== "0" || !text.startsWith("0049", i)) continue;
    const hit = pullProgram(text, i);
    if (!hit) continue;
    const slot = programs.get(hit.code) ?? {
      key: hit.key,
      code: hit.code,
      count: 0,
      examples: new Map<string, number>(),
    };
    slot.count += 1;
    slot.examples.set(hit.full, (slot.examples.get(hit.full) ?? 0) + 1);
    programs.set(hit.code, slot);
    i = Math.max(i, hit.end - 1);
  }

  const shorts = new Map<string, number>();
  for (let i = 0; i <= text.length - 6; i++) {
    if (text[i] !== "9") continue;
    if (i >= 3 && text.slice(i - 3, i + 1) === "0049") continue;
    const fam = text.slice(i, i + 3);
    if (fam !== "9QK" && fam !== "9RK" && fam !== "9PP") continue;
    const rest = text.slice(i + 3, i + 6);
    if (!/^[A-Z0-9]{3}$/.test(rest)) continue;
    const id = fam + rest;
    shorts.set(id, (shorts.get(id) ?? 0) + 1);
    i += 5;
  }

  const hardware = new Set<string>();
  for (const match of text.matchAll(/5WK9\d{4,5}/g)) hardware.add(match[0]);

  let named: FamilyId | null = null;
  if (text.includes("MSV80.1")) named = "MSV80.1";
  else if (text.includes("MSV70")) named = "MSV70";
  else if (text.includes("MSV80")) named = "MSV80";

  const programList = [...programs.values()]
    .map((slot) => {
      let example = slot.code;
      let best = -1;
      for (const [full, count] of slot.examples) {
        if (count > best) {
          best = count;
          example = full;
        }
      }
      return { key: slot.key, code: slot.code, count: slot.count, example };
    })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return {
    programs: programList,
    shorts: [...shorts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
      .slice(0, 6),
    hardware: [...hardware].slice(0, 4),
    named,
  };
}

export function virtualReadNote(family: FamilyId | null, code: string | null): string | null {
  if (family === "MSV80.1" && code === "MK80S") {
    return "MK80S is on the published virtual-read list for MSV80.1.";
  }
  if (family === "MSV80" && code === "MI20S") {
    return "MI20S is on the published virtual-read list for MSV80.";
  }
  if (family === "MSV80.1") {
    return "On MSV80.1, a short virtual read is documented for MK80S. Other programs usually need a full read.";
  }
  if (family === "MSV80") {
    return "On MSV80, a short virtual read is documented for MI20S. Other programs usually need a full read.";
  }
  return null;
}

/** Safe label for a live reply. A short ident string is not a 0049 program. */
export function describeIdentity(text: string): { program: string | null; family: string | null; hasProgram: boolean } {
  const identity = identifyText(text);
  const found = identity.programs[0];
  if (found) {
    const familyId = familyForKey(found.key);
    return {
      program: `${found.code} · ${found.example}`,
      family: familyId ? `${familyId} · ${engineFor(familyId)}` : identity.named,
      hasProgram: true,
    };
  }
  const line =
    text
      .split("\n")
      .map((row) => row.replace(/#$/, "").trim())
      .find((row) => /[A-Z0-9]{4,}/.test(row)) ?? null;
  return { program: line, family: identity.named, hasProgram: false };
}

export type IdentSummary = {
  title: string | null;
  family: string | null;
  note: string;
  hasProgram: boolean;
};

function asciiRun(bytes: Uint8Array): string {
  let text = "";
  let run = "";
  const flush = () => {
    if (run.length >= 2) text = text ? `${text} ${run}` : run;
    run = "";
  };
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];
    if (value >= 0x20 && value < 0x7f && value !== 0x23) run += String.fromCharCode(value);
    else flush();
  }
  flush();
  return text.trim();
}

function repeatedBlock(bytes: Uint8Array): string {
  for (let size = 4; size <= 8; size++) {
    if (bytes.length < size * 2 || bytes.length % size !== 0) continue;
    let same = true;
    for (let i = size; i < bytes.length; i++) {
      if (bytes[i] !== bytes[i % size]) {
        same = false;
        break;
      }
    }
    if (same) return `${hexBytes(bytes.subarray(0, size))} × ${bytes.length / size}`;
  }
  return hexBytes(bytes);
}

export type IdentFact = { label: string; english: string };

function storedNumber(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex.replace(/^0+/, "") || "0";
}

function repeatedStored(payload: Uint8Array): { value: string; times: number } | null {
  for (const size of [6, 4]) {
    if (payload.length < size * 2 || payload.length % size !== 0) continue;
    let same = true;
    for (let i = size; i < payload.length; i++) {
      if (payload[i] !== payload[i % size]) {
        same = false;
        break;
      }
    }
    if (!same) continue;
    return { value: storedNumber(payload.subarray(0, size)), times: payload.length / size };
  }
  return null;
}

function isBcd(value: number): boolean {
  return (value >> 4) <= 9 && (value & 0x0f) <= 9;
}

function packedNumbers(payload: Uint8Array): string[] {
  const found: string[] = [];
  for (let i = 0; i + 6 <= payload.length; i++) {
    const chunk = payload.subarray(i, i + 6);
    if (chunk[0] !== 0 || chunk[1] !== 0 || chunk[2] === 0) continue;
    if (![...chunk].every(isBcd)) continue;
    if (i + 6 < payload.length && payload[i + 6] >= 0x30 && payload[i + 6] <= 0x39) continue;
    const value = storedNumber(chunk);
    if (value.length < 6 || value.length > 8) continue;
    found.push(value);
    i += 5;
  }
  return found;
}

function bcdCode(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || ![...bytes].every(isBcd)) return null;
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(" ");
}

function letterRuns(payload: Uint8Array): string[] {
  const found: string[] = [];
  let run = "";
  const flush = () => {
    if (run.length >= 2) found.push(run);
    run = "";
  };
  for (const value of payload) {
    if (value >= 0x41 && value <= 0x5a) run += String.fromCharCode(value);
    else flush();
  }
  flush();
  return found;
}

function dateAfterLetters(payload: Uint8Array): string | null {
  for (let i = 0; i + 6 < payload.length; i++) {
    if (payload[i] < 0x41 || payload[i] > 0x5a) continue;
    let end = i;
    while (end < payload.length && payload[end] >= 0x20 && payload[end] < 0x7f) end += 1;
    if (end === i || end + 4 > payload.length) continue;
    const date = bcdCode(payload.subarray(end, end + 4));
    if (date) return date;
  }
  return null;
}

/** English for identification replies such as 5A 90 / 5A 86. Not a flash image. */
export function explainIdent(raw: Uint8Array): IdentFact[] {
  const facts: IdentFact[] = [];
  let refused = false;
  for (const body of kwpBodies(raw)) {
    if (body.kind === "nrc" && body.service === 0x1a) {
      refused = true;
      continue;
    }
    if (body.kind !== "ok" || body.service !== 0x5a || body.data.length < 1) continue;
    const id = body.data[0];
    const payload = body.data.subarray(1);
    const label = `1A ${id.toString(16).toUpperCase()}`;
    const letters = asciiRun(payload);
    const repeated = repeatedStored(payload);
    if (id === 0x90) {
      facts.push({ label, english: letters ? `VIN ending ${letters}.` : "No VIN digits." });
    } else if (id === 0x86) {
      const described = describeIdentity(extractPrintable(payload));
      const vin = bmwVin(extractPrintable(payload));
      const numbers = packedNumbers(payload);
      const parts = [];
      if (described.program) parts.push(`Program ${described.program}.`);
      else parts.push("No 0049 program in this block.");
      if (vin) parts.push(`Full VIN ${vin}.`);
      if (numbers.length) parts.push(`Stored numbers ${numbers.join(" and ")}.`);
      const filler = letters.match(/\b\d{4,}\b/);
      if (filler) parts.push(`Letters ${filler[0]}.`);
      facts.push({ label, english: parts.join(" ") });
    } else if (repeated) {
      facts.push({
        label,
        english: `Number ${repeated.value}, stored ${repeated.times} times.`,
      });
    } else if (id === 0x80) {
      const numbers = packedNumbers(payload);
      const mark = letterRuns(payload).join(" ");
      const date = dateAfterLetters(payload);
      const parts = [];
      if (numbers[0]) parts.push(`Number ${numbers[0]}.`);
      if (mark) parts.push(`Letters ${mark}.`);
      if (date) parts.push(`Date code ${date}.`);
      facts.push({ label, english: parts.join(" ") || "ECU identification with no readable letters." });
    } else if (id === 0x9a && (payload.length === 0 || (payload.length === 1 && payload[0] === 0))) {
      facts.push({ label, english: "Nothing stored." });
    } else if (letters) {
      facts.push({ label, english: `Letters ${letters}.` });
    }
  }
  if (refused) {
    facts.push({ label: "Refused", english: "One identification request is not supported on this DME. On the last read that was 1A 92." });
  }
  return facts;
}

/** What the DME actually returned. 1A 90 on this car is the VIN suffix, not the 0049 program. */
export function summarizeIdent(raw: Uint8Array): IdentSummary {
  const described = describeIdentity(extractPrintable(raw));
  if (described.hasProgram) {
    const vin = bmwVin(extractPrintable(raw));
    return {
      title: described.program,
      family: described.family,
      note: `Program ${described.program?.split(" · ")[0] ?? ""}. ${described.family ?? "Family from the 0049 key."}${vin ? ` VIN ${vin}.` : ""} This is identification, not the flash.`,
      hasProgram: true,
    };
  }
  const lines: string[] = [];
  let title: string | null = null;
  let unsupported = false;
  for (const body of kwpBodies(raw)) {
    if (body.kind === "nrc" && body.service === 0x1a) {
      if (body.nrc === 0x12) unsupported = true;
      continue;
    }
    if (body.kind !== "ok" || body.service !== 0x5a || body.data.length < 1) continue;
    const id = body.data[0];
    const payload = body.data.subarray(1);
    const text = asciiRun(payload);
    if (id === 0x90 && text) {
      title = `VIN …${text}`;
      lines.push(`VIN last digits ${text}.`);
    } else if (id === 0x91) {
      lines.push(`Hardware reference ${repeatedBlock(payload)}.`);
    } else if (id === 0x80) {
      const marker = text ? ` Marker ${text}.` : "";
      const date = payload.length >= 17 ? hexBytes(payload.subarray(13, 17)) : "";
      lines.push(`ECU identification${marker}${date ? ` Date code ${date}.` : ""}`);
    } else if (id === 0x97 && text) {
      lines.push(`1A 97 ${text}.`);
    } else if (text) {
      lines.push(`1A ${id.toString(16).toUpperCase()} ${text}.`);
    }
  }
  if (unsupported) {
    lines.push("1A 92 is not supported on this DME, so the 0049 program name is not in these identification services.");
  }
  if (!title && described.program) title = described.program;
  return {
    title,
    family: null,
    note: lines.join(" ") || "The DME answered, but the identification block had no readable fields.",
    hasProgram: false,
  };
}

function extractPrintable(bytes: Uint8Array): string {
  let text = "";
  let run = "";
  const flush = () => {
    if (run.length >= 4) text += `${run}\n`;
    run = "";
  };
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];
    if (value >= 0x20 && value < 0x7f) run += String.fromCharCode(value);
    else flush();
  }
  flush();
  return text;
}

function bmwVin(text: string): string | null {
  const flat = text.replace(/[^A-Z0-9]/g, "");
  const full = flat.match(/WBA[A-HJ-NPR-Z0-9]{14}/);
  if (full) return full[0];
  const head = flat.match(/WBA[A-Z0-9]{7}/);
  if (!head) return null;
  const tail = text
    .split(/[^A-Z0-9]+/)
    .find((token) => token.length === 7 && /^[A-Z][A-Z0-9]{6}$/.test(token) && !head[0].includes(token));
  return tail ? head[0] + tail : null;
}
