import { basename } from "path";
import { assertPathUnder, artworkDir, resolveDataPath } from "../../services/paths.js";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Row from Drizzle (camelCase). Adds artworkFilename and parsed finalMarkers for API. */
export function episodeRowWithFilename<
  T extends { artworkPath?: string | null; podcastId?: string; finalMarkers?: string | null },
>(row: T): T & { artworkFilename: string | null; finalMarkers?: Record<string, unknown>[] | null } {
  const pathRaw = row.artworkPath ?? null;
  const path = pathRaw ? resolveDataPath(pathRaw) : "";
  const podcastId = row.podcastId ?? "";
  let artworkFilename: string | null = null;
  if (path && podcastId) {
    try {
      const dir = artworkDir(podcastId);
      assertPathUnder(path, dir);
      artworkFilename = basename(path);
    } catch {
      // path invalid or outside allowed dir: don't expose filename
    }
  }
  const raw = row.finalMarkers ?? null;
  let parsedFinalMarkers: Record<string, unknown>[] | null = null;
  if (raw != null && typeof raw === "string" && raw.trim()) {
    try {
      parsedFinalMarkers = JSON.parse(raw) as Record<string, unknown>[];
    } catch {
      parsedFinalMarkers = null;
    }
  }
  return { ...row, artworkFilename, finalMarkers: parsedFinalMarkers };
}

/** Cast row from Drizzle (camelCase). Normalize isPublic to boolean for API. */
export function castRowToDto(r: {
  id: string;
  podcastId: string;
  name: string;
  role: string;
  description?: string | null;
  photoPath?: string | null;
  photoUrl?: string | null;
  socialLinkText?: string | null;
  isPublic?: number | boolean;
  createdAt: string;
} & { photoFilename?: string | null }) {
  return {
    id: r.id,
    podcastId: r.podcastId,
    name: r.name,
    role: r.role,
    description: r.description ?? null,
    photoPath: r.photoPath ?? null,
    photoUrl: r.photoUrl ?? null,
    photoFilename: r.photoFilename ?? null,
    socialLinkText: r.socialLinkText ?? null,
    isPublic: Number(r.isPublic ?? 1) === 1,
    createdAt: r.createdAt,
  };
}

export const ARTWORK_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/i;
