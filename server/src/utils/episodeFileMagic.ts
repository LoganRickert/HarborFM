/**
 * Strict allowlist + magic-byte validation for Episode Files uploads.
 */

export const EPISODE_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const EPISODE_FILES_MAX_PER_EPISODE = 100;

export const EPISODE_FILE_UNSUPPORTED_TYPE_MESSAGE =
  "Unsupported file type. Allowed: jpg, png, gif, webp, heic, pdf, docx, xlsx, pptx, zip, txt, csv, md";

export type EpisodeFileKind =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "heic"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "zip"
  | "txt"
  | "csv"
  | "md";

const EXT_TO_KIND: Record<string, EpisodeFileKind> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  heic: "heic",
  heif: "heic",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  zip: "zip",
  txt: "txt",
  csv: "csv",
  md: "md",
};

const KIND_MIME: Record<EpisodeFileKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
};

const KIND_EXT: Record<EpisodeFileKind, string> = {
  jpeg: "jpg",
  png: "png",
  gif: "gif",
  webp: "webp",
  heic: "heic",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  zip: "zip",
  txt: "txt",
  csv: "csv",
  md: "md",
};

export function extensionFromFilename(filename: string): string | null {
  const base = filename.trim().split(/[/\\]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return null;
  return base.slice(i + 1).toLowerCase();
}

export function kindFromExtension(ext: string | null): EpisodeFileKind | null {
  if (!ext) return null;
  return EXT_TO_KIND[ext.toLowerCase()] ?? null;
}

export function mimeForKind(kind: EpisodeFileKind): string {
  return KIND_MIME[kind];
}

export function extForKind(kind: EpisodeFileKind): string {
  return KIND_EXT[kind];
}

function bufStartsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

function isZipMagic(buf: Buffer): boolean {
  return bufStartsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || bufStartsWith(buf, [0x50, 0x4b, 0x05, 0x06]);
}

function zipContains(buf: Buffer, needle: string): boolean {
  return buf.includes(Buffer.from(needle, "utf8"));
}

function isHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // ISO BMFF: size(4) + 'ftyp' + brand
  if (buf.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = buf.toString("ascii", 8, 12).toLowerCase();
  return (
    brand === "heic" ||
    brand === "heix" ||
    brand === "heif" ||
    brand === "mif1" ||
    brand === "msf1" ||
    brand === "hevc"
  );
}

function isMostlyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.length === 0) return true;
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) bad++;
  }
  return bad / sample.length < 0.02;
}

/**
 * Validate buffer against declared kind (from file extension).
 * Returns null if valid; otherwise an error message.
 */
export function validateEpisodeFileMagic(
  kind: EpisodeFileKind,
  buf: Buffer,
): string | null {
  switch (kind) {
    case "jpeg":
      if (!bufStartsWith(buf, [0xff, 0xd8, 0xff])) return "File is not a valid JPEG";
      return null;
    case "png":
      if (!bufStartsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        return "File is not a valid PNG";
      return null;
    case "gif":
      if (
        !bufStartsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) &&
        !bufStartsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      )
        return "File is not a valid GIF";
      return null;
    case "webp":
      if (
        buf.length < 12 ||
        buf.toString("ascii", 0, 4) !== "RIFF" ||
        buf.toString("ascii", 8, 12) !== "WEBP"
      )
        return "File is not a valid WebP";
      return null;
    case "heic":
      if (!isHeic(buf)) return "File is not a valid HEIC/HEIF image";
      return null;
    case "pdf":
      if (!bufStartsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "File is not a valid PDF";
      return null;
    case "docx":
      if (!isZipMagic(buf) || !zipContains(buf, "word/"))
        return "File is not a valid Word document (.docx)";
      return null;
    case "xlsx":
      if (!isZipMagic(buf) || !zipContains(buf, "xl/"))
        return "File is not a valid Excel spreadsheet (.xlsx)";
      return null;
    case "pptx":
      if (!isZipMagic(buf) || !zipContains(buf, "ppt/"))
        return "File is not a valid PowerPoint presentation (.pptx)";
      return null;
    case "zip":
      if (!isZipMagic(buf)) return "File is not a valid ZIP archive";
      return null;
    case "txt":
    case "csv":
    case "md":
      if (!isMostlyText(buf)) return "File does not look like plain text";
      return null;
    default:
      return "Unsupported file type";
  }
}

export function isImageKind(kind: EpisodeFileKind): boolean {
  return (
    kind === "jpeg" ||
    kind === "png" ||
    kind === "gif" ||
    kind === "webp" ||
    kind === "heic"
  );
}
