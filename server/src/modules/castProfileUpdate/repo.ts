import { randomBytes } from "crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { existsSync, unlinkSync } from "fs";
import {
  CAST_PROFILE_PHOTO_MAX_BYTES,
  CAST_PROFILE_PHOTO_MAX_SIDE,
  CAST_PROFILE_TOKEN_TTL_MS,
  VERIFICATION_TOKEN_BYTES,
} from "../../config.js";
import { drizzleDb } from "../../db/index.js";
import {
  podcastCast,
  podcastCastProfilePending,
  podcastCastProfileTokens,
  podcasts,
} from "../../db/schema.js";
import {
  assertPathUnder,
  castPhotoDir,
  ensureDir,
  pathRelativeToData,
  resolveDataPath,
} from "../../services/paths.js";
import { imageExtFromMagic, MIMETYPE_TO_EXT } from "../../utils/artwork.js";
import { sha256Hex } from "../../utils/hash.js";
import { parseUtcDatetime } from "../../utils/datetime.js";
import { join } from "path";
import { writeFileSync } from "fs";
import { loadImage } from "canvas";
import {
  parseCastSocialLinks,
  serializeCastSocialLinks,
} from "@harborfm/shared";

export type CastProfileTokenRow = {
  id: string;
  podcastId: string;
  castId: string;
  tokenHash: string;
  createdByUserId: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type CastProfilePendingRow = {
  castId: string;
  podcastId: string;
  name: string;
  nickname: string | null;
  description: string | null;
  socialLinks: string;
  timeZone: string | null;
  photoPath: string | null;
  submittedAt: string;
  updatedAt: string;
};

export type CastProfileCastContext = {
  id: string;
  podcastId: string;
  name: string;
  nickname: string | null;
  role: "host" | "guest";
  description: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  socialLinks: string | null;
  email: string | null;
  timeZone: string | null;
  isPublic: number;
  podcastTitle: string;
};

export function generateCastProfileToken(): { raw: string; hash: string } {
  const raw = randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

/** True when the invite is past its TTL (default 14 days from createdAt). */
export function isCastProfileTokenExpired(
  createdAt: string,
  nowMs: number = Date.now(),
): boolean {
  const trimmed = createdAt.trim();
  if (!trimmed) return true;
  const createdMs = /T|\+|Z$/i.test(trimmed)
    ? Date.parse(trimmed)
    : parseUtcDatetime(trimmed);
  if (!Number.isFinite(createdMs)) return true;
  return nowMs - createdMs > CAST_PROFILE_TOKEN_TTL_MS;
}

export function revokeActiveTokensForCast(castId: string): void {
  drizzleDb
    .update(podcastCastProfileTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(podcastCastProfileTokens.castId, castId),
        isNull(podcastCastProfileTokens.revokedAt),
      ),
    )
    .run();
}

/** Insert a new invite token and revoke any prior active tokens for the cast. */
export function rotateCastProfileToken(input: {
  podcastId: string;
  castId: string;
  createdByUserId: string | null;
}): { raw: string; hash: string; id: string } {
  const { raw, hash } = generateCastProfileToken();
  revokeActiveTokensForCast(input.castId);
  const id = nanoid();
  drizzleDb
    .insert(podcastCastProfileTokens)
    .values({
      id,
      podcastId: input.podcastId,
      castId: input.castId,
      tokenHash: hash,
      createdByUserId: input.createdByUserId,
    })
    .run();
  return { raw, hash, id };
}

export function findTokenByHash(
  tokenHash: string,
): CastProfileTokenRow | undefined {
  return drizzleDb
    .select()
    .from(podcastCastProfileTokens)
    .where(eq(podcastCastProfileTokens.tokenHash, tokenHash))
    .limit(1)
    .get() as CastProfileTokenRow | undefined;
}

export function getCastProfileContext(
  castId: string,
): CastProfileCastContext | null {
  const row = drizzleDb
    .select({
      id: podcastCast.id,
      podcastId: podcastCast.podcastId,
      name: podcastCast.name,
      nickname: podcastCast.nickname,
      role: podcastCast.role,
      description: podcastCast.description,
      photoPath: podcastCast.photoPath,
      photoUrl: podcastCast.photoUrl,
      socialLinks: podcastCast.socialLinks,
      email: podcastCast.email,
      timeZone: podcastCast.timeZone,
      isPublic: sql<number>`COALESCE(${podcastCast.isPublic}, 1)`.as("isPublic"),
      podcastTitle: podcasts.title,
    })
    .from(podcastCast)
    .innerJoin(podcasts, eq(podcastCast.podcastId, podcasts.id))
    .where(eq(podcastCast.id, castId))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    ...row,
    role: row.role as "host" | "guest",
  };
}

export function resolveCastProfileFromRawToken(rawToken: string): {
  token: CastProfileTokenRow;
  cast: CastProfileCastContext;
} | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const token = findTokenByHash(sha256Hex(trimmed));
  if (!token || token.revokedAt) return null;
  if (isCastProfileTokenExpired(token.createdAt)) return null;
  const cast = getCastProfileContext(token.castId);
  if (!cast || cast.podcastId !== token.podcastId) return null;
  return { token, cast };
}

export function getPendingForCast(
  castId: string,
): CastProfilePendingRow | undefined {
  return drizzleDb
    .select()
    .from(podcastCastProfilePending)
    .where(eq(podcastCastProfilePending.castId, castId))
    .limit(1)
    .get() as CastProfilePendingRow | undefined;
}

export function castPendingPhotoDir(podcastId: string): string {
  const dir = join(castPhotoDir(podcastId), "pending");
  ensureDir(dir);
  return dir;
}

export function deletePendingPhotoFile(
  podcastId: string,
  photoPath: string | null | undefined,
): void {
  if (!photoPath?.trim()) return;
  try {
    const dir = castPendingPhotoDir(podcastId);
    const safe = assertPathUnder(resolveDataPath(photoPath), dir);
    if (existsSync(safe)) unlinkSync(safe);
  } catch {
    // ignore
  }
}

export function upsertPending(input: {
  castId: string;
  podcastId: string;
  name: string;
  nickname: string | null;
  description: string | null;
  socialLinks: string[];
  timeZone: string | null;
  photoPath: string | null;
  replacePhoto: boolean;
}): CastProfilePendingRow {
  const existing = getPendingForCast(input.castId);
  const socialLinksJson = serializeCastSocialLinks(input.socialLinks);

  if (existing) {
    let nextPhotoPath = existing.photoPath;
    if (input.replacePhoto) {
      if (existing.photoPath && existing.photoPath !== input.photoPath) {
        deletePendingPhotoFile(input.podcastId, existing.photoPath);
      }
      nextPhotoPath = input.photoPath;
    }
    const updatedAt = new Date().toISOString();
    drizzleDb
      .update(podcastCastProfilePending)
      .set({
        name: input.name,
        nickname: input.nickname,
        description: input.description,
        socialLinks: socialLinksJson,
        timeZone: input.timeZone,
        photoPath: nextPhotoPath,
        updatedAt,
      })
      .where(eq(podcastCastProfilePending.castId, input.castId))
      .run();
  } else {
    drizzleDb
      .insert(podcastCastProfilePending)
      .values({
        castId: input.castId,
        podcastId: input.podcastId,
        name: input.name,
        nickname: input.nickname,
        description: input.description,
        socialLinks: socialLinksJson,
        timeZone: input.timeZone,
        photoPath: input.replacePhoto ? input.photoPath : null,
      })
      .run();
  }

  return getPendingForCast(input.castId)!;
}

export function deletePendingRow(castId: string): void {
  const pending = getPendingForCast(castId);
  if (!pending) return;
  deletePendingPhotoFile(pending.podcastId, pending.photoPath);
  drizzleDb
    .delete(podcastCastProfilePending)
    .where(eq(podcastCastProfilePending.castId, castId))
    .run();
}

export type CastProfileFlags = {
  hasPendingProfileUpdate: boolean;
  hasActiveProfileInvite: boolean;
};

/** Batch flags for cast list responses. */
export function getCastProfileFlagsForIds(
  castIds: string[],
): Map<string, CastProfileFlags> {
  const map = new Map<string, CastProfileFlags>();
  for (const id of castIds) {
    map.set(id, {
      hasPendingProfileUpdate: false,
      hasActiveProfileInvite: false,
    });
  }
  if (castIds.length === 0) return map;

  const pendingRows = drizzleDb
    .select({ castId: podcastCastProfilePending.castId })
    .from(podcastCastProfilePending)
    .where(inArray(podcastCastProfilePending.castId, castIds))
    .all() as { castId: string }[];
  const pendingSet = new Set(pendingRows.map((r) => r.castId));

  const tokenRows = drizzleDb
    .select({
      castId: podcastCastProfileTokens.castId,
      createdAt: podcastCastProfileTokens.createdAt,
    })
    .from(podcastCastProfileTokens)
    .where(
      and(
        inArray(podcastCastProfileTokens.castId, castIds),
        isNull(podcastCastProfileTokens.revokedAt),
      ),
    )
    .all() as { castId: string; createdAt: string }[];
  const activeInviteSet = new Set(
    tokenRows
      .filter((r) => !isCastProfileTokenExpired(r.createdAt))
      .map((r) => r.castId),
  );

  for (const id of castIds) {
    const hasPending = pendingSet.has(id);
    map.set(id, {
      hasPendingProfileUpdate: hasPending,
      hasActiveProfileInvite: !hasPending && activeInviteSet.has(id),
    });
  }
  return map;
}

export function listPendingCastIdsForPodcast(podcastId: string): string[] {
  const rows = drizzleDb
    .select({ castId: podcastCastProfilePending.castId })
    .from(podcastCastProfilePending)
    .where(eq(podcastCastProfilePending.podcastId, podcastId))
    .all() as { castId: string }[];
  return rows.map((r) => r.castId);
}

export async function validateAndStorePendingPhoto(opts: {
  podcastId: string;
  castId: string;
  buffer: Buffer;
  mimetype: string;
}): Promise<{ photoPath: string } | { error: string }> {
  const { podcastId, castId, buffer, mimetype } = opts;
  if (!mimetype.startsWith("image/")) {
    return { error: "Not an image" };
  }
  if (buffer.length > CAST_PROFILE_PHOTO_MAX_BYTES) {
    return { error: "Image too large (max 1MB)" };
  }
  const magicExt = imageExtFromMagic(buffer);
  if (!magicExt) {
    return { error: "Unrecognized image format" };
  }
  const claimedExt = MIMETYPE_TO_EXT[mimetype] ?? magicExt;
  if (claimedExt !== magicExt && !(claimedExt === "jpg" && magicExt === "jpg")) {
    // Allow jpeg mime aliases; otherwise require magic match.
    if (!(mimetype.includes("jpeg") || mimetype.includes("jpg")) || magicExt !== "jpg") {
      return { error: "Image content does not match type" };
    }
  }

  try {
    const img = await loadImage(buffer);
    if (
      img.width > CAST_PROFILE_PHOTO_MAX_SIDE ||
      img.height > CAST_PROFILE_PHOTO_MAX_SIDE
    ) {
      return {
        error: `Image dimensions too large (max ${CAST_PROFILE_PHOTO_MAX_SIDE}px per side)`,
      };
    }
  } catch {
    return { error: "Could not read image" };
  }

  const dir = castPendingPhotoDir(podcastId);
  const filename = `${castId}.${magicExt}`;
  const destPath = join(dir, filename);
  writeFileSync(destPath, buffer);
  return { photoPath: pathRelativeToData(destPath) };
}

export function pendingSocialLinks(pending: CastProfilePendingRow): string[] {
  return parseCastSocialLinks(pending.socialLinks);
}
