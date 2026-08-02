import { randomBytes } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { VERIFICATION_TOKEN_BYTES } from "../../config.js";
import { drizzleDb } from "../../db/index.js";
import { episodeGuestReviews, episodes, podcasts } from "../../db/schema.js";
import { sha256Hex } from "../../utils/hash.js";

export type GuestReviewStatus = "pending" | "approved" | "feedback";

export type GuestReviewRow = {
  id: string;
  episodeId: string;
  meetingId: string | null;
  email: string;
  displayName: string | null;
  tokenHash: string;
  status: string;
  feedbackText: string | null;
  respondedAt: string | null;
  lastSentAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type EpisodeReviewContext = {
  id: string;
  podcastId: string;
  title: string;
  slug: string | null;
  status: string;
  unlisted: boolean;
  publishAt: string | null;
  audioFinalPath: string | null;
  audioMime: string | null;
  artworkPath: string | null;
  artworkUrl: string | null;
  podcastSlug: string;
  podcastTitle: string;
  podcastArtworkPath: string | null;
  podcastArtworkUrl: string | null;
};

function asBoolFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function generateReviewToken(): { raw: string; hash: string } {
  const raw = randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

export function getEpisodeReviewContext(
  episodeId: string,
): EpisodeReviewContext | null {
  const row = drizzleDb
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      title: episodes.title,
      slug: episodes.slug,
      status: episodes.status,
      unlisted: episodes.unlisted,
      publishAt: episodes.publishAt,
      audioFinalPath: episodes.audioFinalPath,
      audioMime: episodes.audioMime,
      artworkPath: episodes.artworkPath,
      artworkUrl: episodes.artworkUrl,
      podcastSlug: podcasts.slug,
      podcastTitle: podcasts.title,
      podcastArtworkPath: podcasts.artworkPath,
      podcastArtworkUrl: podcasts.artworkUrl,
    })
    .from(episodes)
    .innerJoin(podcasts, eq(episodes.podcastId, podcasts.id))
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    ...row,
    unlisted: asBoolFlag(row.unlisted),
    artworkPath: row.artworkPath ?? null,
    artworkUrl: row.artworkUrl ?? null,
    podcastArtworkPath: row.podcastArtworkPath ?? null,
    podcastArtworkUrl: row.podcastArtworkUrl ?? null,
  };
}

/** Preview chrome is valid while unlisted, or listed + scheduled. */
export function isPreviewEligible(ep: {
  status: string;
  unlisted?: boolean | number | null;
}): boolean {
  if (ep.status === "draft") return false;
  if (asBoolFlag(ep.unlisted)) {
    return ep.status === "scheduled" || ep.status === "published";
  }
  return ep.status === "scheduled";
}

/** Listed + published: review links should redirect to the public URL. */
export function isFullyPublic(ep: {
  status: string;
  unlisted?: boolean | number | null;
}): boolean {
  return ep.status === "published" && !asBoolFlag(ep.unlisted);
}

export function findReviewByTokenHash(
  tokenHash: string,
): GuestReviewRow | undefined {
  return drizzleDb
    .select()
    .from(episodeGuestReviews)
    .where(eq(episodeGuestReviews.tokenHash, tokenHash))
    .limit(1)
    .get();
}

export function findActiveReviewByEpisodeAndEmail(
  episodeId: string,
  email: string,
): GuestReviewRow | undefined {
  const emailLower = email.trim().toLowerCase();
  const rows = drizzleDb
    .select()
    .from(episodeGuestReviews)
    .where(
      and(
        eq(episodeGuestReviews.episodeId, episodeId),
        isNull(episodeGuestReviews.revokedAt),
      ),
    )
    .all();
  return rows.find((r) => r.email.trim().toLowerCase() === emailLower);
}

export function createGuestReview(input: {
  episodeId: string;
  meetingId: string | null;
  email: string;
  displayName?: string | null;
  tokenHash: string;
}): GuestReviewRow {
  const nowIso = new Date().toISOString();
  const id = nanoid();
  drizzleDb
    .insert(episodeGuestReviews)
    .values({
      id,
      episodeId: input.episodeId,
      meetingId: input.meetingId,
      email: input.email.trim(),
      displayName: input.displayName?.trim() || null,
      tokenHash: input.tokenHash,
      status: "pending",
      feedbackText: null,
      respondedAt: null,
      lastSentAt: null,
      createdAt: nowIso,
      revokedAt: null,
    })
    .run();
  const row = drizzleDb
    .select()
    .from(episodeGuestReviews)
    .where(eq(episodeGuestReviews.id, id))
    .limit(1)
    .get();
  if (!row) throw new Error("Failed to create guest review");
  return row;
}

export function markReviewSent(id: string): void {
  drizzleDb
    .update(episodeGuestReviews)
    .set({ lastSentAt: new Date().toISOString() })
    .where(eq(episodeGuestReviews.id, id))
    .run();
}

export function rotateReviewToken(
  id: string,
  tokenHash: string,
): void {
  drizzleDb
    .update(episodeGuestReviews)
    .set({
      tokenHash,
      revokedAt: null,
      lastSentAt: null,
    })
    .where(eq(episodeGuestReviews.id, id))
    .run();
}

export function revokeReviewsForEpisode(episodeId: string): void {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGuestReviews)
    .set({ revokedAt: nowIso })
    .where(
      and(
        eq(episodeGuestReviews.episodeId, episodeId),
        isNull(episodeGuestReviews.revokedAt),
      ),
    )
    .run();
}

export function setReviewApproved(id: string): void {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGuestReviews)
    .set({
      status: "approved",
      respondedAt: nowIso,
      feedbackText: null,
    })
    .where(eq(episodeGuestReviews.id, id))
    .run();
}

export function setReviewFeedback(id: string, feedbackText: string): void {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGuestReviews)
    .set({
      status: "feedback",
      feedbackText,
      respondedAt: nowIso,
    })
    .where(eq(episodeGuestReviews.id, id))
    .run();
}

export function resolveReviewFromRawToken(rawToken: string): {
  review: GuestReviewRow;
  episode: EpisodeReviewContext;
} | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const review = findReviewByTokenHash(sha256Hex(trimmed));
  if (!review || review.revokedAt) return null;
  const episode = getEpisodeReviewContext(review.episodeId);
  if (!episode) return null;
  return { review, episode };
}
