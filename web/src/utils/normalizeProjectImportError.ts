const TOO_LARGE_MESSAGE =
  'This project zip is too large to upload all at once. Refresh the page and try again.';

const INTERRUPTED_MESSAGE =
  'Upload was interrupted. Check your connection and try again.';

/**
 * Rewrite opaque upload/import failures into user-friendly messages.
 */
export function normalizeProjectImportError(
  message: string | undefined | null,
  status?: number,
): string {
  const raw = (message ?? '').trim();
  const lower = raw.toLowerCase();

  if (
    status === 413 ||
    /request file too large/i.test(raw) ||
    /payload too large/i.test(raw) ||
    /file too large/i.test(raw) ||
    /entity too large/i.test(raw) ||
    /<html[\s>]/i.test(raw)
  ) {
    return TOO_LARGE_MESSAGE;
  }

  if (
    status === 0 ||
    /network error/i.test(raw) ||
    /failed to fetch/i.test(raw) ||
    /aborted/i.test(lower) ||
    /networkerror/i.test(lower)
  ) {
    return INTERRUPTED_MESSAGE;
  }

  return raw || 'Import failed';
}
