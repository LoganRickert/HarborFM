/**
 * Content-Type for streaming/serving audio from a file path.
 * Matches the extension set allowed for library and segment audio (wav, webm, ogg, m4a/mp4, default mp3).
 */
export function contentTypeFromAudioPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (
    lower.endsWith(".m4a") ||
    lower.endsWith(".mp4") ||
    lower.endsWith(".mov")
  )
    return "audio/mp4";
  return "audio/mpeg";
}

/**
 * MIME type from ffprobe/ffmpeg format name (e.g. "wav", "matroska,webm").
 * Uses includes() so compound names like "matroska,webm" are handled.
 */
export function mimeFromAudioFormatName(formatName: string): string {
  const lower = formatName.toLowerCase();
  if (lower.includes("wav")) return "audio/wav";
  if (lower.includes("mp3")) return "audio/mpeg";
  if (lower.includes("webm")) return "audio/webm";
  if (lower.includes("m4a") || lower.includes("mp4") || lower.includes("mov"))
    return "audio/mp4";
  return "audio/mpeg";
}
