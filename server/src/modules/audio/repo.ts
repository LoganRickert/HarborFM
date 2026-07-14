import { and, eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { episodes, podcasts, users } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";

/** Adjust user storage usage by delta (can be negative). Clamps to >= 0. */
export function addUserStorageDelta(userId: string, delta: number): void {
  if (delta === 0) return;
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`CASE
        WHEN COALESCE(${users.diskBytesUsed}, 0) + ${delta} < 0 THEN 0
        ELSE COALESCE(${users.diskBytesUsed}, 0) + ${delta}
      END`,
    })
    .where(eq(users.id, userId))
    .run();
}

/** Update episode audio fields after source upload. */
export function updateEpisodeAudio(
  episodeId: string,
  values: {
    audioSourcePath: string;
    audioMime: string;
    audioBytes: number;
    audioDurationSec: number;
  },
): void {
  drizzleDb
    .update(episodes)
    .set({
      audioSourcePath: values.audioSourcePath,
      audioMime: values.audioMime,
      audioBytes: values.audioBytes,
      audioDurationSec: values.audioDurationSec,
      updatedAt: sqlNow(),
    })
    .where(eq(episodes.id, episodeId))
    .run();
}

/** Update episode audio fields after process/transcode. */
export function updateEpisodeAfterProcess(
  episodeId: string,
  values: {
    audioFinalPath: string;
    audioMime: string;
    audioBytes: number;
    audioDurationSec: number;
  },
): void {
  drizzleDb
    .update(episodes)
    .set({
      audioFinalPath: values.audioFinalPath,
      audioMime: values.audioMime,
      audioBytes: values.audioBytes,
      audioDurationSec: values.audioDurationSec,
      updatedAt: sqlNow(),
    })
    .where(eq(episodes.id, episodeId))
    .run();
}

export type EpisodeRow = typeof episodes.$inferSelect;

/** Get full episode row by id. */
export function getEpisodeById(episodeId: string): EpisodeRow | undefined {
  return drizzleDb
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
}

/** Get episode audio final path (for waveform / download). */
export function getEpisodeAudioFinalPath(
  episodeId: string,
): { audioFinalPath: string | null } | undefined {
  return drizzleDb
    .select({ audioFinalPath: episodes.audioFinalPath })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
}

/** Podcast title for download filenames. */
export function getPodcastTitle(
  podcastId: string,
): string | null {
  const row = drizzleDb
    .select({ title: podcasts.title })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row?.title ?? null;
}

/** Podcast fields for public stream (id, publicFeedDisabled). */
export function getPublicPodcastForStream(
  podcastId: string,
): { id: string; publicFeedDisabled: boolean | null } | undefined {
  return drizzleDb
    .select({
      id: podcasts.id,
      publicFeedDisabled: podcasts.publicFeedDisabled,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
}

/** Published episode for public stream (final audio, not subscriber-only). */
export function getPublishedEpisodeForStream(
  podcastId: string,
  episodeId: string,
): EpisodeRow | undefined {
  return drizzleDb
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.podcastId, podcastId),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get();
}
