import { and, eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { episodes, podcasts, reusableAssets } from "../../db/schema.js";

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
