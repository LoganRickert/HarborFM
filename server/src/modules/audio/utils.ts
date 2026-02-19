const ALLOWED_MIME_LIST: string[] = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
];

/** True if the given mimetype is an allowed audio upload type. */
export function isAllowedAudioMime(mimetype: string): boolean {
  return ALLOWED_MIME_LIST.includes(mimetype) || mimetype.startsWith("audio/");
}
