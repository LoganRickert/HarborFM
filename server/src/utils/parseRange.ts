/**
 * Parse Range request header for a single range.
 * - No Range header or invalid → full file, return fileSize.
 * - Single range (e.g. bytes=0-4999 or bytes=1000-) → return requested length.
 * - Multiple ranges (e.g. bytes=0-100,200-300) → return null (do not count as listen).
 */
export function getSingleRangeRequestedLength(
  rangeHeader: string | undefined,
  fileSize: number,
): number | null {
  if (fileSize <= 0) return null;
  const raw = (rangeHeader ?? "").trim();
  if (!raw || !raw.toLowerCase().startsWith("bytes=")) return fileSize; // full file

  const spec = raw.slice(6).trim();
  const parts = spec.split(",");
  if (parts.length !== 1) return null; // multiple ranges → not a listen

  const part = parts[0]!.trim();
  const dash = part.indexOf("-");
  if (dash < 0) return null;

  const startStr = part.slice(0, dash).trim();
  const endStr = part.slice(dash + 1).trim();

  let start: number;
  let end: number | null = null;
  if (startStr === "") {
    // suffix-byte-range: "-500" means last 500 bytes
    const suffix = parseInt(endStr, 10);
    if (Number.isNaN(suffix) || suffix < 0) return null;
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    if (Number.isNaN(start) || start < 0) return null;
    if (endStr === "") {
      end = fileSize - 1;
    } else {
      end = parseInt(endStr, 10);
      if (Number.isNaN(end) || end < start) return null;
    }
  }

  const length = (end ?? fileSize - 1) - start + 1;
  if (length <= 0) return null;
  return Math.min(length, fileSize - start);
}
