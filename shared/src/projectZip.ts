/** HarborFM project / segment zip format version. */
export const PROJECT_FORMAT_VERSION = 1;

export type ProjectZipKind = "episode" | "segment";

export type ProjectZipManifest = {
  formatVersion?: number;
  kind?: string;
};

/**
 * Quick structural checks for a HarborFM project zip (client or server).
 * Does not extract audio; only inspects the root manifest and entry names.
 * Returns null when valid, otherwise a human-readable error message.
 */
export function validateProjectZipClient(
  manifest: ProjectZipManifest | null | undefined,
  entryNames: string[],
  expectedKind: ProjectZipKind,
): string | null {
  const names = entryNames.map(normalizeZipEntryName);
  const hasEntry = (path: string) =>
    names.some((n) => n === path || n.startsWith(`${path}/`));

  if (!manifest || typeof manifest !== "object") {
    return "Missing harborfm-project.json";
  }
  if (!hasEntry("harborfm-project.json")) {
    return "Missing harborfm-project.json";
  }
  if (manifest.formatVersion !== PROJECT_FORMAT_VERSION) {
    return `Unsupported project formatVersion (expected ${PROJECT_FORMAT_VERSION})`;
  }

  if (expectedKind === "episode") {
    if (manifest.kind === "segment") {
      return "This zip is a segment project. Use Import Segment from Manage Segment on the episode editor, not Import Project on the Episodes page.";
    }
    if (!hasEntry("episode/episode.json")) {
      return "Missing episode/episode.json";
    }
    if (!hasEntry("segments")) {
      return "Missing segments/ directory";
    }
    return null;
  }

  // segment
  if (manifest.kind !== "segment") {
    return 'This zip is not a segment project (expected kind: "segment")';
  }
  if (hasEntry("segment")) {
    return null;
  }
  const segmentFolders = uniqueTopLevelUnder(names, "segments");
  if (segmentFolders.length === 1) {
    return null;
  }
  if (segmentFolders.length > 1) {
    return "Segment project has multiple segments/ folders; expected a single segment/";
  }
  return "Missing segment/ directory in project zip";
}

function normalizeZipEntryName(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Distinct first path segments under `prefix/` (e.g. segments/foo -> foo). */
function uniqueTopLevelUnder(names: string[], prefix: string): string[] {
  const base = `${prefix}/`;
  const found = new Set<string>();
  for (const n of names) {
    if (!n.startsWith(base)) continue;
    const rest = n.slice(base.length);
    const folder = rest.split("/")[0];
    if (folder) found.add(folder);
  }
  return [...found].sort();
}
