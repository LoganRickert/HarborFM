import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { basename } from "path";
import { drizzleDb } from "../../db/index.js";
import {
  episodeCast,
  episodeSegments,
  episodes,
  podcastCast,
  podcasts,
  users,
} from "../../db/schema.js";

export type EpisodeRow = typeof episodes.$inferSelect;
export type EpisodeInsert = typeof episodes.$inferInsert;

/** List episodes for a podcast, ordered by status then publishAt/createdAt desc. */
export function listByPodcastId(podcastId: string): EpisodeRow[] {
  return drizzleDb
    .select()
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId))
    .orderBy(
      sql`CASE ${episodes.status} WHEN 'draft' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'published' THEN 3 ELSE 4 END`,
      desc(sql`COALESCE(${episodes.publishAt}, ${episodes.createdAt})`),
    )
    .all();
}

/** Get full episode row by id. */
export function getById(id: string): EpisodeRow | undefined {
  return drizzleDb
    .select()
    .from(episodes)
    .where(eq(episodes.id, id))
    .limit(1)
    .get();
}

/** Max episodes allowed for create (podcast max ?? owner user max). */
export function getCreateLimit(podcastId: string): { maxEpisodes: number | null } {
  const podcastRow = drizzleDb
    .select({
      ownerUserId: podcasts.ownerUserId,
      maxEpisodes: podcasts.maxEpisodes,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  const ownerMax = podcastRow
    ? drizzleDb
        .select({ maxEpisodes: users.maxEpisodes })
        .from(users)
        .where(eq(users.id, podcastRow.ownerUserId))
        .limit(1)
        .get()
    : undefined;
  const maxEpisodes = podcastRow?.maxEpisodes ?? ownerMax?.maxEpisodes ?? null;
  return { maxEpisodes };
}

/** Count episodes for a podcast. */
export function countByPodcastId(podcastId: string): number {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)`.as("count") })
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId))
    .get();
  return row?.count ?? 0;
}

/** True if an episode exists with the given slug (optionally excluding an episode id for PATCH). */
export function slugExists(
  podcastId: string,
  slug: string,
  excludeEpisodeId?: string,
): boolean {
  const conditions = excludeEpisodeId
    ? and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.slug, slug),
        ne(episodes.id, excludeEpisodeId),
      )
    : and(eq(episodes.podcastId, podcastId), eq(episodes.slug, slug));
  const row = drizzleDb
    .select({ id: episodes.id })
    .from(episodes)
    .where(conditions)
    .limit(1)
    .get();
  return !!row;
}

export type EpisodeMeta = {
  podcastId: string;
  title: string;
  slug: string | null;
  status: string;
  publishAt: string | null;
};

/** Get episode meta fields for PATCH logic. */
export function getEpisodeMeta(id: string): EpisodeMeta | undefined {
  const row = drizzleDb
    .select({
      podcastId: episodes.podcastId,
      title: episodes.title,
      slug: episodes.slug,
      status: episodes.status,
      publishAt: episodes.publishAt,
    })
    .from(episodes)
    .where(eq(episodes.id, id))
    .limit(1)
    .get();
  return row;
}

/**
 * Get artwork path for an episode.
 * If podcastId is provided, only returns path when episode belongs to that podcast.
 * undefined = not found, null = no artwork, string = relative path.
 */
export function getArtworkPath(
  episodeId: string,
  podcastId?: string,
): string | null | undefined {
  const conditions = podcastId
    ? and(
        eq(episodes.id, episodeId),
        eq(episodes.podcastId, podcastId),
      )
    : eq(episodes.id, episodeId);
  const row = drizzleDb
    .select({ artworkPath: episodes.artworkPath })
    .from(episodes)
    .where(conditions)
    .limit(1)
    .get();
  return row === undefined ? undefined : row.artworkPath ?? null;
}

export type EpisodeForDelete = {
  podcastId: string;
  artworkPath: string | null;
  audioSourcePath: string | null;
};

/** Get episode fields needed for delete handler. */
export function getEpisodeForDelete(episodeId: string): EpisodeForDelete | undefined {
  return drizzleDb
    .select({
      podcastId: episodes.podcastId,
      artworkPath: episodes.artworkPath,
      audioSourcePath: episodes.audioSourcePath,
    })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
}

/** Get segment audio paths for an episode (for delete storage calc / cleanup). */
export function getSegmentAudioPaths(
  episodeId: string,
): { audioPath: string | null }[] {
  return drizzleDb
    .select({ audioPath: episodeSegments.audioPath })
    .from(episodeSegments)
    .where(
      and(
        eq(episodeSegments.episodeId, episodeId),
        sql`${episodeSegments.audioPath} IS NOT NULL`,
      ),
    )
    .all();
}

export type CastRowWithFilename = {
  id: string;
  podcastId: string;
  name: string;
  role: string;
  description: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  socialLinkText: string | null;
  isPublic: boolean;
  createdAt: string;
  photoFilename: string | null;
};

/** Get cast assigned to episode (join podcastCast + episodeCast), with photoFilename. */
export function getEpisodeCast(episodeId: string): CastRowWithFilename[] {
  const rows = drizzleDb
    .select({
      id: podcastCast.id,
      podcastId: podcastCast.podcastId,
      name: podcastCast.name,
      role: podcastCast.role,
      description: podcastCast.description,
      photoPath: podcastCast.photoPath,
      photoUrl: podcastCast.photoUrl,
      socialLinkText: podcastCast.socialLinkText,
      isPublic: podcastCast.isPublic,
      createdAt: podcastCast.createdAt,
    })
    .from(podcastCast)
    .innerJoin(episodeCast, eq(episodeCast.castId, podcastCast.id))
    .where(eq(episodeCast.episodeId, episodeId))
    .orderBy(podcastCast.role, podcastCast.createdAt)
    .all();
  return rows.map((r) => ({
    ...r,
    photoFilename: r.photoPath ? basename(r.photoPath) : null,
  }));
}

/** Insert episode. Caller must handle unique violation (409). */
export function insertEpisode(row: EpisodeInsert): void {
  drizzleDb.insert(episodes).values(row).run();
}

/** Update episode by id with partial set. */
export function updateEpisode(id: string, set: Record<string, unknown>): void {
  drizzleDb.update(episodes).set(set).where(eq(episodes.id, id)).run();
}

/** Delete all episode_cast rows for an episode. */
export function deleteEpisodeCast(episodeId: string): void {
  drizzleDb.delete(episodeCast).where(eq(episodeCast.episodeId, episodeId)).run();
}

/** Delete episode by id. */
export function deleteEpisode(episodeId: string): void {
  drizzleDb.delete(episodes).where(eq(episodes.id, episodeId)).run();
}

/** Replace episode cast: delete existing, insert one row per castId. */
export function replaceEpisodeCast(episodeId: string, castIds: string[]): void {
  drizzleDb.delete(episodeCast).where(eq(episodeCast.episodeId, episodeId)).run();
  for (const castId of castIds) {
    drizzleDb.insert(episodeCast).values({ episodeId, castId }).run();
  }
}

/** True iff every castId exists and belongs to the podcast. */
export function validateCastIds(podcastId: string, castIds: string[]): boolean {
  if (castIds.length === 0) return true;
  const existing = drizzleDb
    .select({ id: podcastCast.id })
    .from(podcastCast)
    .where(
      and(
        inArray(podcastCast.id, castIds),
        eq(podcastCast.podcastId, podcastId),
      ),
    )
    .all();
  return existing.length === castIds.length;
}
