import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  episodeSegments,
  podcasts,
  users,
} from "../../db/schema.js";

/** Return true if a podcast with this slug exists. */
export function podcastSlugExists(slug: string): boolean {
  const row = drizzleDb
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(eq(podcasts.slug, slug))
    .limit(1)
    .get();
  return !!row;
}

/** Insert a new podcast (e.g. from import). Row must include required fields. */
export function insertPodcast(
  row: Record<string, unknown> & {
    id: string;
    ownerUserId: string;
    title: string;
    slug: string;
  },
): void {
  drizzleDb.insert(podcasts).values(row as typeof podcasts.$inferInsert).run();
}

/** Set podcast artwork path and clear artworkUrl. */
export function updatePodcastArtwork(
  podcastId: string,
  relativePath: string,
): void {
  drizzleDb
    .update(podcasts)
    .set({ artworkPath: relativePath, artworkUrl: null })
    .where(eq(podcasts.id, podcastId))
    .run();
}

/** Get user's max podcasts limit (null = no limit). */
export function getUserMaxPodcasts(userId: string): number | null {
  const row = drizzleDb
    .select({ maxPodcasts: users.maxPodcasts })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.maxPodcasts ?? null;
}

/** Count podcasts owned by user. */
export function countUserPodcasts(userId: string): number {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)`.as("count") })
    .from(podcasts)
    .where(eq(podcasts.ownerUserId, userId))
    .get();
  return row?.count ?? 0;
}

/** Next position for a new segment in an episode (0 if none). */
export function getNextSegmentPosition(episodeId: string): number {
  const row = drizzleDb
    .select({
      pos: sql<number>`COALESCE(MAX(${episodeSegments.position}), -1) + 1`,
    })
    .from(episodeSegments)
    .where(eq(episodeSegments.episodeId, episodeId))
    .get() as { pos: number } | undefined;
  return row?.pos ?? 0;
}

/** Insert an episode segment. */
export function insertSegment(row: {
  id: string;
  episodeId: string;
  position: number;
  type: "recorded" | "reusable";
  name: string;
  audioPath: string;
  durationSec: number;
}): void {
  drizzleDb.insert(episodeSegments).values(row).run();
}

/** Add bytes to user's disk usage. */
export function addUserDiskBytes(userId: string, bytes: number): void {
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`COALESCE(${users.diskBytesUsed}, 0) + ${bytes}`,
    })
    .where(eq(users.id, userId))
    .run();
}

/** Whether the user has canTranscribe enabled. */
export function getUserCanTranscribe(userId: string): boolean {
  const row = drizzleDb
    .select({
      canTranscribe: sql<number>`COALESCE(${users.canTranscribe}, 0)`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.canTranscribe === 1;
}
