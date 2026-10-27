import { analyzeImage, type ImageRole, type Report } from "./analyze";
import { materialize, parseIntelHex, parseSrec, looksLikeIntelHex, looksLikeSrec } from "./parse";
import { looksLikeXdf, parseXdf, type XdfInfo } from "./xdf";

export type LoadedImage = {
  name: string;
  bytes: Uint8Array;
  report: Report;
};

export type LoadedXdf = {
  name: string;
  info: XdfInfo;
};

export type DropResult =
  | { type: "image"; image: LoadedImage }
  | { type: "xdf"; xdf: LoadedXdf }
  | { type: "error"; message: string };

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function headText(bytes: Uint8Array, count = 6000): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, count));
  let text = "";
  for (let i = 0; i < slice.length; i++) text += String.fromCharCode(slice[i]);
  return text;
}

function roleFor(ext: string, encoding: Report["encoding"]): ImageRole {
  if (ext === "0da") return "0da";
  if (ext === "0pa") return "0pa";
  if (encoding === "srec" || ext === "s19" || ext === "srec") return "srec";
  if (encoding === "intel-hex" || ext === "hex") return "hex";
  return "bin";
}

export function imageFromBinary(name: string, bytes: Uint8Array, role: ImageRole = "bin", base = 0): LoadedImage {
  return {
    name,
    bytes,
    report: analyzeImage({ bytes, base, present: null, role, encoding: "binary" }),
  };
}

function imageFromHexParse(
  name: string,
  role: ImageRole,
  encoding: Report["encoding"],
  parsed: ReturnType<typeof parseIntelHex>,
): LoadedImage | { error: string } {
  const image = materialize(parsed.chunks);
  if (!image) return { error: `${name} has no data records.` };
  const warnings: string[] = [];
  if (image.clipped) {
    warnings.push("Address span was too wide. Showing the densest 2 MB window.");
  }
  if (parsed.errors.length > 0) warnings.push(parsed.errors[0]);
  return {
    name,
    bytes: image.bytes,
    report: analyzeImage({
      bytes: image.bytes,
      base: image.base,
      present: image.present,
      role,
      encoding,
      hexMeta: { records: parsed.records, badChecksums: parsed.badChecksums },
      extraWarnings: warnings,
    }),
  };
}

export function imageFromIntelText(name: string, text: string, role: ImageRole = "0da"): DropResult {
  const parsed = parseIntelHex(text);
  const image = imageFromHexParse(name, role, "intel-hex", parsed);
  if ("error" in image) return { type: "error", message: image.error };
  return { type: "image", image };
}

export function readDroppedFile(name: string, bytes: Uint8Array): DropResult {
  if (bytes.length === 0) return { type: "error", message: `${name} is empty.` };
  if (bytes.length > 32 * 1024 * 1024) return { type: "error", message: `${name} is over 32 MB.` };

  const ext = extension(name);
  const head = headText(bytes);

  if (ext === "xdf" || ext === "xml" || looksLikeXdf(head)) {
    const text = new TextDecoder().decode(bytes);
    const info = parseXdf(text);
    if (!info) return { type: "error", message: `${name} is not a TunerPro XDF.` };
    return { type: "xdf", xdf: { name, info } };
  }

  if (ext === "0da" || ext === "0pa" || ext === "hex" || looksLikeIntelHex(head)) {
    const text = new TextDecoder().decode(bytes);
    if (looksLikeIntelHex(text.slice(0, 8000)) || looksLikeIntelHex(head)) {
      return imageFromIntelText(name, text, roleFor(ext, "intel-hex"));
    }
  }

  if (ext === "s19" || ext === "srec" || looksLikeSrec(head)) {
    const text = new TextDecoder().decode(bytes);
    const image = imageFromHexParse(name, "srec", "srec", parseSrec(text));
    if ("error" in image) return { type: "error", message: image.error };
    return { type: "image", image };
  }

  return { type: "image", image: imageFromBinary(name, bytes, "bin") };
}
