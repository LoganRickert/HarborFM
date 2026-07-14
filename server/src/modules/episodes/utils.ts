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

function parseJsonObjectArray(raw: string | null | undefined): Record<string, unknown>[] | null {
  if (raw == null || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Row from Drizzle (camelCase). Adds artworkFilename and parsed JSON columns for API. */
export function episodeRowWithFilename<
  T extends {
    artworkPath?: string | null;
    podcastId?: string;
    finalMarkers?: string | null;
    finalSoundbites?: string | null;
    contentLinks?: string | null;
    podcastTxts?: string | null;
    socialInteracts?: string | null;
    locations?: string | null;
    license?: string | null;
    podcastImages?: string | null;
    fundingLinks?: string | null;
    chat?: string | null;
    valueBlocks?: string | null;
  },
>(
  row: T,
): T & {
  artworkFilename: string | null;
  finalMarkers?: Record<string, unknown>[] | null;
  finalSoundbites?: Record<string, unknown>[] | null;
  contentLinks?: Record<string, unknown>[] | null;
  podcastTxts?: Record<string, unknown>[] | null;
  socialInteracts?: Record<string, unknown>[] | null;
  locations?: Record<string, unknown>[] | null;
  license?: Record<string, unknown> | null;
  podcastImages?: Record<string, unknown>[] | null;
  fundingLinks?: Record<string, unknown>[] | null;
  chat?: Record<string, unknown> | null;
  valueBlocks?: Record<string, unknown>[] | null;
} {
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
  return {
    ...row,
    artworkFilename,
    finalMarkers: parseJsonObjectArray(row.finalMarkers ?? null),
    finalSoundbites: parseJsonObjectArray(row.finalSoundbites ?? null),
    contentLinks: parseJsonObjectArray(row.contentLinks ?? null),
    podcastTxts: parseJsonObjectArray(row.podcastTxts ?? null),
    socialInteracts: parseJsonObjectArray(row.socialInteracts ?? null),
    locations: parseJsonObjectArray(row.locations ?? null),
    license: parseJsonObject(row.license ?? null),
    podcastImages: parseJsonObjectArray(row.podcastImages ?? null),
    fundingLinks: parseJsonObjectArray(row.fundingLinks ?? null),
    chat: parseJsonObject(row.chat ?? null),
    valueBlocks: parseJsonObjectArray(row.valueBlocks ?? null),
  };
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
