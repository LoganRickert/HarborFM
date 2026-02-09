/**
 * Shared artwork extension and mimetype maps for podcast cover images.
 * Use these instead of inline maps so CodeQL and maintenance stay simple.
 */

/** extname() result (e.g. ".png") -> extension without dot */
export const EXT_DOT_TO_EXT: Record<string, string> = {
  '.png': 'png',
  '.webp': 'webp',
  '.jpg': 'jpg',
};

/** Extension without dot -> Content-Type */
export const EXT_TO_MIMETYPE: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
};

/** extname() result -> Content-Type (single lookup when you only need mimetype) */
export const EXT_DOT_TO_MIMETYPE: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};

/** Upload mimetype -> extension without dot */
export const MIMETYPE_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/webp': 'webp',
};
