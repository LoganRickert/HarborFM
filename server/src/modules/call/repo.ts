import { and, eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { episodes, podcasts, reusableAssets } from "../../db/schema.js";
import { getCanonicalFeedUrl } from "../../services/dns/custom-domain-resolver.js";
import { readSettings } from "../settings/index.js";

/** Get podcast id for an episode (for call start). */
export function getEpisodePodcastId(
  episodeId: string,
): { podcastId: string } | undefined {
  return drizzleDb
    .select({ podcastId: episodes.podcastId })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
}

/**
 * Prefer the podcast linking/managed domain origin for guest join links when configured.
 * Falls back to requestOrigin (app host) when no custom domain is active.
 */
export function getCallJoinOrigin(
  podcastId: string,
  fallbackOrigin: string,
): string {
  const row = drizzleDb
    .select({
      linkDomain: podcasts.linkDomain,
      managedDomain: podcasts.managedDomain,
      managedSubDomain: podcasts.managedSubDomain,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!row) return fallbackOrigin;
  const canonical = getCanonicalFeedUrl(row, readSettings());
  if (!canonical) return fallbackOrigin;
  try {
    return new URL(canonical).origin;
  } catch {
    return fallbackOrigin;
  }
}

/** Build absolute (or path-only) guest join URL for a call token. */
export function buildCallJoinUrl(
  podcastId: string,
  token: string,
  fallbackOrigin: string,
): string {
  const origin = getCallJoinOrigin(podcastId, fallbackOrigin);
  return origin ? `${origin}/call/join/${token}` : `/call/join/${token}`;
}

/** Podcast fields needed for join-info page (title, artwork). */
export function getPodcastForJoinInfo(podcastId: string): {
  title: string;
  artworkPath: string | null;
  artworkUrl: string | null;
} | undefined {
  return drizzleDb
    .select({
      title: podcasts.title,
      artworkPath: podcasts.artworkPath,
      artworkUrl: podcasts.artworkUrl,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
}

/** Episode fields needed for join-info page (id, title, artwork). */
export function getEpisodeForJoinInfo(
  episodeId: string,
  podcastId: string,
): {
  id: string;
  title: string;
  artworkPath: string | null;
  artworkUrl: string | null;
} | undefined {
  return drizzleDb
    .select({
      id: episodes.id,
      title: episodes.title,
      artworkPath: episodes.artworkPath,
      artworkUrl: episodes.artworkUrl,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.podcastId, podcastId),
      ),
    )
    .limit(1)
    .get();
}

export type ReusableAssetRow = typeof reusableAssets.$inferSelect;

/** Get a reusable asset by id (for internal library asset streaming). */
export function getReusableAssetById(assetId: string): ReusableAssetRow | undefined {
  return drizzleDb
    .select()
    .from(reusableAssets)
    .where(eq(reusableAssets.id, assetId))
    .limit(1)
    .get();
}
