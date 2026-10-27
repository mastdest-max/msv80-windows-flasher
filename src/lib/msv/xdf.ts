import { formatBytes } from "./format";
import { identifyText, type ProgramHit } from "./identify";

export type XdfScalar = {
  title: string;
  address: number;
  bits: number;
};

export type XdfInfo = {
  title: string;
  description: string;
  author: string;
  regionSize: number | null;
  regionName: string;
  tables: number;
  categories: number;
  programs: ProgramHit[];
  shorts: { id: string; count: number }[];
  scalars: XdfScalar[];
};

export type XdfCompare = {
  tone: "match" | "mismatch" | "unknown";
  lines: string[];
};

function tagValue(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function countTag(text: string, tag: string): number {
  const needle = `<${tag}`;
  let count = 0;
  let index = 0;
  while (index >= 0) {
    index = text.indexOf(needle, index);
    if (index < 0) break;
    count += 1;
    index += needle.length;
  }
  return count;
}

function parseNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = trimmed.toLowerCase().startsWith("0x")
    ? Number.parseInt(trimmed, 16)
    : Number.parseInt(trimmed, 10);
  return Number.isFinite(value) ? value : null;
}

export function looksLikeXdf(text: string): boolean {
  return /<XDFFORMAT\b|<XDFHEADER>|<deftitle>/i.test(text.slice(0, 8000));
}

function scalarList(text: string): XdfScalar[] {
  const out: XdfScalar[] = [];
  const tables = text.split(/<XDFTABLE\b/i).slice(1);
  for (const block of tables) {
    const title = tagValue(block.slice(0, 1800), "title") || "Scalar";
    const embeds = block.match(/<EMBEDDEDDATA\b[^>]*>/gi) ?? [];
    for (const tag of embeds) {
      const rows = parseNum(tag.match(/mmedrowcount="([^"]+)"/i)?.[1] ?? "");
      const cols = parseNum(tag.match(/mmedcolcount="([^"]+)"/i)?.[1] ?? "");
      const bits = parseNum(tag.match(/mmedelementsizebits="([^"]+)"/i)?.[1] ?? "");
      const address = parseNum(tag.match(/mmedaddress="([^"]+)"/i)?.[1] ?? "");
      if (rows !== 1 || cols !== 1 || address == null || bits == null || bits < 8 || bits > 32) continue;
      out.push({ title, address, bits });
      break;
    }
    if (out.length >= 80) break;
  }
  return out;
}

export function parseXdf(text: string): XdfInfo | null {
  if (!looksLikeXdf(text) && !/<XDFTABLE\b/i.test(text.slice(0, 12000))) return null;
  const header = text.slice(0, 12000);
  const title = tagValue(header, "deftitle") || "Untitled definition";
  const description = tagValue(header, "description");
  const author = tagValue(header, "author");
  const regionTag = header.match(/<REGION\b([^>]*)>/i)?.[1] ?? "";
  const regionSize = parseNum(regionTag.match(/\bsize="([^"]+)"/i)?.[1] ?? "");
  const regionName = regionTag.match(/\bname="([^"]+)"/i)?.[1] ?? "";
  const identity = identifyText(`${title}\n${description}`);
  return {
    title,
    description,
    author,
    regionSize,
    regionName,
    tables: countTag(text, "XDFTABLE"),
    categories: countTag(text, "CATEGORY"),
    programs: identity.programs,
    shorts: identity.shorts,
    scalars: scalarList(text),
  };
}

export function compareXdf(
  xdf: XdfInfo,
  image: { span: number; code: string | null; shortId: string | null },
): XdfCompare {
  const lines: string[] = [];
  let software: "match" | "mismatch" | "unknown" = "unknown";
  let size: "match" | "mismatch" | "unknown" = "unknown";

  const xdfCodes = new Set(xdf.programs.map((program) => program.code));
  const xdfShorts = new Set(xdf.shorts.map((short) => short.id));
  if (image.code && xdfCodes.size > 0) {
    if (xdfCodes.has(image.code)) {
      software = "match";
      lines.push(`Software matches. Both carry program ${image.code}.`);
    } else {
      software = "mismatch";
      const listed = [...xdfCodes].slice(0, 3).join(", ");
      lines.push(`Software does not match. This file is ${image.code}; the XDF names ${listed}.`);
    }
  } else if (image.shortId && xdfShorts.size > 0) {
    if (xdfShorts.has(image.shortId)) {
      software = "match";
      lines.push(`Software id ${image.shortId} is in the XDF title.`);
    } else {
      software = "mismatch";
      lines.push(`Software id ${image.shortId} is not the one named by this XDF.`);
    }
  } else {
    lines.push("No shared program id to compare. Check the XDF title against the file.");
  }

  if (xdf.regionSize && image.span > 0) {
    const delta = Math.abs(xdf.regionSize - image.span);
    if (delta <= 4096) {
      size = "match";
      lines.push("File length matches the XDF region size.");
    } else {
      size = "mismatch";
      lines.push(
        `Size does not match. The XDF expects ${formatBytes(xdf.regionSize)}; this file is ${formatBytes(image.span)}.`,
      );
    }
  }

  const tone: XdfCompare["tone"] =
    software === "mismatch" || size === "mismatch" ? "mismatch" : software === "match" || size === "match" ? "match" : "unknown";
  return { tone, lines };
}
