/**
 * Shared artwork extension and mimetype maps for podcast cover images.
 * Use these instead of inline maps so CodeQL and maintenance stay simple.
 */

/** extname() result (e.g. ".png") -> extension without dot */
export const EXT_DOT_TO_EXT: Record<string, string> = {
  ".png": "png",
  ".webp": "webp",
  ".jpg": "jpg",
};

/** Extension without dot -> Content-Type */
export const EXT_TO_MIMETYPE: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
};

/** extname() result -> Content-Type (single lookup when you only need mimetype) */
export const EXT_DOT_TO_MIMETYPE: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
};

/** Upload mimetype -> extension without dot */
export const MIMETYPE_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/x-png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
};

/** Detect image type from magic bytes. Returns extension without dot, or null. */
export function imageExtFromMagic(buf: Uint8Array): "png" | "webp" | "jpg" | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "webp";
  }
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpg";
  }
  return null;
}
