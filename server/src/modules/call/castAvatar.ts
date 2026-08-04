import { basename } from "node:path";
import { eq } from "drizzle-orm";
import { API_PREFIX } from "../../config.js";
import { drizzleDb } from "../../db/index.js";
import { podcastCast } from "../../db/schema.js";
import type { MeetingInviteRow } from "./meetings.js";

export type CastAvatarStamp = {
  castId: string;
  castPhotoUrl: string;
  castLocked: boolean;
};

type CastRow = {
  id: string;
  podcastId: string;
  name: string;
  email: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  isPublic: boolean;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function listShowCast(podcastId: string): CastRow[] {
  return drizzleDb
    .select({
      id: podcastCast.id,
      podcastId: podcastCast.podcastId,
      name: podcastCast.name,
      email: podcastCast.email,
      photoPath: podcastCast.photoPath,
      photoUrl: podcastCast.photoUrl,
      isPublic: podcastCast.isPublic,
    })
    .from(podcastCast)
    .where(eq(podcastCast.podcastId, podcastId))
    .all();
}

function castHasPhoto(cast: CastRow): boolean {
  return Boolean(cast.photoUrl?.trim() || cast.photoPath?.trim());
}

/** Relative or absolute URL suitable for roster <img src>. */
export function buildCastPhotoUrl(cast: CastRow): string | null {
  const remote = cast.photoUrl?.trim();
  if (remote) return remote;
  const path = cast.photoPath?.trim();
  if (!path) return null;
  const filename = basename(path);
  if (!filename) return null;
  return `/${API_PREFIX}/public/artwork/${encodeURIComponent(cast.podcastId)}/cast/${encodeURIComponent(cast.id)}/${encodeURIComponent(filename)}`;
}

function stampFromCast(cast: CastRow, castLocked: boolean): CastAvatarStamp | null {
  if (!castHasPhoto(cast)) return null;
  const castPhotoUrl = buildCastPhotoUrl(cast);
  if (!castPhotoUrl) return null;
  return { castId: cast.id, castPhotoUrl, castLocked };
}

/**
 * Name match for unlocked participants: public cast only.
 */
export function resolvePublicCastByName(
  podcastId: string,
  displayName: string,
): CastAvatarStamp | null {
  const needle = normalizeName(displayName);
  if (!needle) return null;
  const match = listShowCast(podcastId).find(
    (c) =>
      c.isPublic === true &&
      castHasPhoto(c) &&
      normalizeName(c.name) === needle,
  );
  return match ? stampFromCast(match, false) : null;
}

/**
 * Invite path may bind private cast. Order: castId → email → displayName.
 */
export function resolveCastForInvite(
  podcastId: string,
  invite: Pick<MeetingInviteRow, "castId" | "email" | "displayName">,
): CastAvatarStamp | null {
  const cast = listShowCast(podcastId);
  if (invite.castId?.trim()) {
    const byId = cast.find((c) => c.id === invite.castId!.trim());
    if (byId) {
      const stamped = stampFromCast(byId, true);
      if (stamped) return stamped;
    }
  }
  const email = invite.email?.trim();
  if (email) {
    const want = normalizeEmail(email);
    const byEmail = cast.find(
      (c) => c.email?.trim() && normalizeEmail(c.email) === want && castHasPhoto(c),
    );
    if (byEmail) {
      const stamped = stampFromCast(byEmail, true);
      if (stamped) return stamped;
    }
  }
  const name = invite.displayName?.trim();
  if (name) {
    const want = normalizeName(name);
    const byName = cast.find(
      (c) => castHasPhoto(c) && normalizeName(c.name) === want,
    );
    if (byName) {
      const stamped = stampFromCast(byName, true);
      if (stamped) return stamped;
    }
  }
  return null;
}
