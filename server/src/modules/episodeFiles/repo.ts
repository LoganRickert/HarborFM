import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../db/drizzle.js";
import { episodeFiles, episodes, podcasts, users } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";

export type EpisodeFileRow = typeof episodeFiles.$inferSelect;

export function listEpisodeFiles(episodeId: string): EpisodeFileRow[] {
  return drizzleDb
    .select()
    .from(episodeFiles)
    .where(eq(episodeFiles.episodeId, episodeId))
    .orderBy(asc(episodeFiles.sortOrder), asc(episodeFiles.createdAt))
    .all();
}

export function countEpisodeFiles(episodeId: string): number {
  const row = drizzleDb
    .select({ n: sql<number>`count(*)`.as("n") })
    .from(episodeFiles)
    .where(eq(episodeFiles.episodeId, episodeId))
    .get();
  return row?.n ?? 0;
}

export function getEpisodeFile(
  episodeId: string,
  fileId: string,
): EpisodeFileRow | undefined {
  return drizzleDb
    .select()
    .from(episodeFiles)
    .where(and(eq(episodeFiles.episodeId, episodeId), eq(episodeFiles.id, fileId)))
    .limit(1)
    .get();
}

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

export function getOwnerUserIdForEpisode(episodeId: string): string | undefined {
  const row = drizzleDb
    .select({ ownerUserId: podcasts.ownerUserId })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  return row?.ownerUserId;
}

export function nextSortOrder(episodeId: string): number {
  const row = drizzleDb
    .select({
      max: sql<number | null>`max(${episodeFiles.sortOrder})`.as("max"),
    })
    .from(episodeFiles)
    .where(eq(episodeFiles.episodeId, episodeId))
    .get();
  return (row?.max ?? -1) + 1;
}

export function insertFileItem(values: {
  episodeId: string;
  title: string;
  description: string | null;
  storageName: string;
  mimeType: string;
  byteSize: number;
  originalFilename: string;
}): EpisodeFileRow {
  const id = nanoid();
  const sortOrder = nextSortOrder(values.episodeId);
  drizzleDb
    .insert(episodeFiles)
    .values({
      id,
      episodeId: values.episodeId,
      kind: "file",
      title: values.title,
      description: values.description,
      sortOrder,
      storageName: values.storageName,
      mimeType: values.mimeType,
      byteSize: values.byteSize,
      originalFilename: values.originalFilename,
      url: null,
    })
    .run();
  return getEpisodeFile(values.episodeId, id)!;
}

export function insertLinkItem(values: {
  episodeId: string;
  title: string;
  description: string | null;
  url: string;
}): EpisodeFileRow {
  const id = nanoid();
  const sortOrder = nextSortOrder(values.episodeId);
  drizzleDb
    .insert(episodeFiles)
    .values({
      id,
      episodeId: values.episodeId,
      kind: "link",
      title: values.title,
      description: values.description,
      sortOrder,
      storageName: null,
      mimeType: null,
      byteSize: null,
      originalFilename: null,
      url: values.url,
    })
    .run();
  return getEpisodeFile(values.episodeId, id)!;
}

export function updateEpisodeFile(
  episodeId: string,
  fileId: string,
  patch: { title?: string; description?: string | null; url?: string },
): EpisodeFileRow | undefined {
  const set: Record<string, unknown> = { updatedAt: sqlNow() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.url !== undefined) set.url = patch.url;
  drizzleDb
    .update(episodeFiles)
    .set(set)
    .where(and(eq(episodeFiles.episodeId, episodeId), eq(episodeFiles.id, fileId)))
    .run();
  return getEpisodeFile(episodeId, fileId);
}

export function reorderEpisodeFiles(episodeId: string, itemIds: string[]): void {
  const existing = listEpisodeFiles(episodeId);
  if (existing.length !== itemIds.length) {
    throw new Error("Reorder list must include every item exactly once");
  }
  const idSet = new Set(existing.map((r) => r.id));
  for (const id of itemIds) {
    if (!idSet.has(id)) throw new Error("Unknown item in reorder list");
  }
  itemIds.forEach((id, index) => {
    drizzleDb
      .update(episodeFiles)
      .set({ sortOrder: index, updatedAt: sqlNow() })
      .where(and(eq(episodeFiles.episodeId, episodeId), eq(episodeFiles.id, id)))
      .run();
  });
}

export function deleteEpisodeFile(episodeId: string, fileId: string): EpisodeFileRow | undefined {
  const row = getEpisodeFile(episodeId, fileId);
  if (!row) return undefined;
  drizzleDb
    .delete(episodeFiles)
    .where(and(eq(episodeFiles.episodeId, episodeId), eq(episodeFiles.id, fileId)))
    .run();
  return row;
}

export function sumFileBytesForEpisode(episodeId: string): number {
  const row = drizzleDb
    .select({
      total: sql<number>`COALESCE(sum(${episodeFiles.byteSize}), 0)`.as("total"),
    })
    .from(episodeFiles)
    .where(and(eq(episodeFiles.episodeId, episodeId), eq(episodeFiles.kind, "file")))
    .get();
  return row?.total ?? 0;
}

export function addUserDiskBytes(userId: string, bytes: number): void {
  if (bytes <= 0) return;
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`COALESCE(${users.diskBytesUsed}, 0) + ${bytes}`,
    })
    .where(eq(users.id, userId))
    .run();
}

export function subtractUserDiskBytes(userId: string, bytes: number): void {
  if (bytes <= 0) return;
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`CASE
        WHEN COALESCE(${users.diskBytesUsed}, 0) - ${bytes} < 0 THEN 0
        ELSE COALESCE(${users.diskBytesUsed}, 0) - ${bytes}
      END`,
    })
    .where(eq(users.id, userId))
    .run();
}

export function toDto(
  row: EpisodeFileRow,
  downloadUrl: string | null,
): Record<string, unknown> {
  return {
    id: row.id,
    episodeId: row.episodeId,
    kind: row.kind,
    title: row.title,
    description: row.description ?? null,
    sortOrder: row.sortOrder,
    mimeType: row.mimeType ?? null,
    byteSize: row.byteSize ?? null,
    originalFilename: row.originalFilename ?? null,
    url: row.url ?? null,
    downloadUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
