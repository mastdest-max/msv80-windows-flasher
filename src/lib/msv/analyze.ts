import { formatBytes } from "./format";
import {
  engineFor,
  familyForKey,
  identifyText,
  virtualReadNote,
  type FamilyId,
  type Identity,
  type ProgramHit,
} from "./identify";

export type ImageRole = "bin" | "0da" | "0pa" | "hex" | "srec";
export type Encoding = "binary" | "intel-hex" | "srec";
export type ReadClass = "full" | "calibration" | "partial" | "fragment";
export type Tone = "good" | "warn" | "bad";

export type FoundString = {
  address: number;
  text: string;
  notable: boolean;
};

export type Segment = {
  index: number;
  start: number;
  liveRatio: number;
};

export type Report = {
  role: ImageRole;
  encoding: Encoding;
  byteLength: number;
  baseAddress: number;
  liveBytes: number;
  zeroBytes: number;
  erasedBytes: number;
  absentBytes: number;
  liveRatio: number;
  family: FamilyId | null;
  engine: string;
  program: ProgramHit | null;
  alternates: ProgramHit[];
  shorts: Identity["shorts"];
  hardware: string[];
  confidence: "high" | "medium" | "low";
  readClass: ReadClass;
  title: string;
  detail: string;
  tone: Tone;
  synthetic: boolean;
  virtualRead: string | null;
  strings: FoundString[];
  segments: Segment[];
  hexMeta: { records: number; badChecksums: number } | null;
  warnings: string[];
};

const NOTABLE =
  /0049[A-Z0-9]{8,}|MSV80(?:\.1)?|MSV70|5WK9\d+|9(?:QK|RK|PP)[A-Z0-9]{3}|SYNTHETIC_BENCH|N51|N52/;

const SEGMENT_COUNT = 24;

function asciiRun(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  const stop = Math.min(end, start + 800);
  for (let i = start; i < stop; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

function markerBlob(bytes: Uint8Array): string {
  const markers = ["0049", "9QK", "9RK", "9PP", "5WK9", "MSV80", "MSV70", "SYNTHETIC_BENCH"];
  const needles = markers.map((marker) => marker.split("").map((ch) => ch.charCodeAt(0)));
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    for (const needle of needles) {
      if (i + needle.length > bytes.length || bytes[i] !== needle[0]) continue;
      let matched = true;
      for (let j = 1; j < needle.length; j++) {
        if (bytes[i + j] !== needle[j]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      parts.push(asciiRun(bytes, i, Math.min(bytes.length, i + 48)));
      i += needle.length - 1;
      break;
    }
  }
  return parts.join("\n");
}

function collectRuns(bytes: Uint8Array, base: number): FoundString[] {
  const found: FoundString[] = [];
  let start = -1;
  const push = (from: number, to: number) => {
    if (to - from < 5) return;
    const text = asciiRun(bytes, from, to);
    found.push({
      address: base + from,
      text: text.length > 96 ? `${text.slice(0, 96)}…` : text,
      notable: NOTABLE.test(text),
    });
  };
  for (let i = 0; i <= bytes.length; i++) {
    const printable = i < bytes.length && bytes[i] >= 0x20 && bytes[i] < 0x7f;
    if (printable) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      push(start, i);
      start = -1;
    }
  }
  return found;
}

export function classifySpan(span: number): ReadClass {
  if (span >= 2_000_000 && span <= 2_900_000) return "full";
  if (span >= 160_000 && span <= 420_000) return "calibration";
  if (span < 32_768) return "fragment";
  return "partial";
}

function includesAscii(bytes: Uint8Array, needle: string): boolean {
  const chars = needle.split("").map((ch) => ch.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - chars.length; i++) {
    for (let j = 0; j < chars.length; j++) {
      if (bytes[i + j] !== chars[j]) continue outer;
    }
    return true;
  }
  return false;
}

function verdict(input: {
  readClass: ReadClass;
  family: FamilyId | null;
  program: ProgramHit | null;
  alternates: ProgramHit[];
  liveRatio: number;
  span: number;
  synthetic: boolean;
  virtualRead: string | null;
}): { title: string; detail: string; tone: Tone } {
  const size = formatBytes(input.span);
  const code = input.program?.code;
  const example = input.program?.example;
  const family = input.family;
  const named = code ? `${code}${example && example !== code ? ` (${example})` : ""}` : "no program id";
  const also =
    input.alternates.length > 0
      ? ` Also in this image: ${input.alternates
          .slice(0, 3)
          .map((item) => item.code)
          .join(", ")}.`
      : "";
  const virtual = input.virtualRead ? ` ${input.virtualRead}` : "";

  if (input.synthetic) {
    return {
      title: "Synthetic sample",
      detail: "Planted identification strings so the layout is visible. This is not a dump from a car, and it must not be flashed.",
      tone: "warn",
    };
  }
  if (input.readClass === "fragment") {
    return {
      title: "Too small to be a read",
      detail: `${size} is below a calibration and far below a full MSV80 image, which is about 2–2.5 MB.`,
      tone: "bad",
    };
  }
  if (input.liveRatio < 0.015) {
    return {
      title: "Looks erased",
      detail: "Almost no live data. An unfinished read or a blank chip looks like this.",
      tone: "bad",
    };
  }
  if (input.readClass === "full" && (family === "MSV80" || family === "MSV80.1")) {
    return {
      title: "Full-size read",
      detail: `${size} image. Program ${named} on ${family} (${engineFor(family)}).${virtual}${also}`,
      tone: "good",
    };
  }
  if (input.readClass === "full" && family === "MSV70") {
    return {
      title: "Full-size MSV70 image",
      detail: `${size}, program ${named}. This is MSV70 (0049PP0), not MSV80. Point a matching MSV70 definition at it.${also}`,
      tone: "warn",
    };
  }
  if (input.readClass === "full") {
    return {
      title: "Full-size, unidentified",
      detail: `${size} is in the full-flash range, but there is no 0049 program string. It may not be a Siemens MSV image.`,
      tone: "bad",
    };
  }
  if (input.readClass === "calibration" && family) {
    return {
      title: "Calibration extract",
      detail: `${size} is the size of a converted .0DA, not a full flash. Program ${named} on ${family}.${virtual} The rest of the ECU is not in this file.${also}`,
      tone: "warn",
    };
  }
  if (input.readClass === "calibration") {
    return {
      title: "Calibration-sized, unidentified",
      detail: `${size} matches a converted .0DA, but there is no 0049 program string.`,
      tone: "bad",
    };
  }
  if (family) {
    return {
      title: "Partial image",
      detail: `${size} is neither a ~256 KB calibration nor a ~2.5 MB full read. Program ${named} was found on ${family}, but the dump looks incomplete.${also}`,
      tone: "warn",
    };
  }
  return {
    title: "Unidentified image",
    detail: `${size}, and no MSV70 or MSV80 program string. This bench does not recognize it.`,
    tone: "bad",
  };
}

export function analyzeImage(options: {
  bytes: Uint8Array;
  base: number;
  present: Uint8Array | null;
  role: ImageRole;
  encoding: Encoding;
  hexMeta?: { records: number; badChecksums: number } | null;
  extraWarnings?: string[];
}): Report {
  const { bytes, base, present } = options;
  let liveBytes = 0;
  let zeroBytes = 0;
  let erasedBytes = 0;
  let absentBytes = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (present && present[i] === 0) {
      absentBytes += 1;
      continue;
    }
    const value = bytes[i];
    if (value === 0x00) zeroBytes += 1;
    else if (value === 0xff) erasedBytes += 1;
    else liveBytes += 1;
  }
  const covered = bytes.length - absentBytes;
  const liveRatio = covered > 0 ? liveBytes / covered : 0;
  const runs = collectRuns(bytes, base);
  const identity = identifyText(markerBlob(bytes));
  const program = identity.programs[0] ?? null;
  const alternates = identity.programs.slice(1, 4);
  const family = (program ? familyForKey(program.key) : null) ?? identity.named;
  const confidence = program ? "high" : family ? "medium" : "low";
  const synthetic = includesAscii(bytes, "SYNTHETIC_BENCH_SAMPLE");
  const readClass = classifySpan(bytes.length);
  const virtualRead = virtualReadNote(family, program?.code ?? null);
  const judged = verdict({
    readClass,
    family,
    program,
    alternates,
    liveRatio,
    span: bytes.length,
    synthetic,
    virtualRead,
  });

  const warnings = [...(options.extraWarnings ?? [])];
  if (options.hexMeta && options.hexMeta.badChecksums > 0) {
    warnings.push(`${options.hexMeta.badChecksums} HEX checksum${options.hexMeta.badChecksums === 1 ? "" : "s"} failed.`);
  }
  if (absentBytes > bytes.length * 0.02) {
    warnings.push("The HEX file leaves holes inside its address span. Empty gaps are not live calibration.");
  }
  if (identity.programs.length > 1) {
    const second = identity.programs[1];
    if (program && familyForKey(second.key) && familyForKey(second.key) !== family) {
      warnings.push("More than one ECU family shows up in this file. Trust the primary program only after you compare it with INPA.");
    }
  }

  const notable = runs.filter((run) => run.notable);
  const plain = runs.filter((run) => !run.notable);
  const strings = [...notable, ...plain].slice(0, 80);

  const segments: Segment[] = [];
  const size = SEGMENT_COUNT;
  const chunk = Math.max(1, Math.ceil(bytes.length / size));
  for (let index = 0; index < size && index * chunk < Math.max(bytes.length, 1); index++) {
    const start = index * chunk;
    const end = Math.min(bytes.length, start + chunk);
    let live = 0;
    let seen = 0;
    for (let i = start; i < end; i++) {
      if (present && present[i] === 0) continue;
      seen += 1;
      if (bytes[i] !== 0x00 && bytes[i] !== 0xff) live += 1;
    }
    segments.push({ index, start, liveRatio: seen > 0 ? live / seen : 0 });
  }

  return {
    role: options.role,
    encoding: options.encoding,
    byteLength: bytes.length,
    baseAddress: base,
    liveBytes,
    zeroBytes,
    erasedBytes,
    absentBytes,
    liveRatio,
    family,
    engine: engineFor(family),
    program,
    alternates,
    shorts: identity.shorts,
    hardware: identity.hardware,
    confidence,
    readClass,
    title: judged.title,
    detail: judged.detail,
    tone: judged.tone,
    synthetic,
    virtualRead,
    strings,
    segments,
    hexMeta: options.hexMeta ?? null,
    warnings,
  };
}
