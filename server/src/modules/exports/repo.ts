import { and, desc, eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  episodes as episodesTable,
  exportRuns,
  exports as exportsTable,
  podcasts,
} from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";

export type ExportRow = {
  id: string;
  podcastId: string;
  name: string;
  mode: string;
  publicBaseUrl: string | null;
  createdAt: string;
  updatedAt: string;
  configEnc?: string | null;
};

export type ExportInsert = {
  id: string;
  podcastId: string;
  name: string;
  publicBaseUrl: string | null;
  mode: string;
  configEnc: string;
};

export type ExportRunRow = {
  id: string;
  exportId: string;
  podcastId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  log: string | null;
  createdAt: string;
};

export type ExportRunInsert = {
  id: string;
  exportId: string;
  podcastId: string;
  status: string;
  startedAt: ReturnType<typeof sqlNow>;
};

export type PublishedEpisodeRow = {
  id: string;
  audioFinalPath: string | null;
  audioMime: string | null;
  artworkPath: string | null;
};

/** List exports for a podcast, order by updatedAt desc. */
export function listByPodcastId(podcastId: string): ExportRow[] {
  return drizzleDb
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.podcastId, podcastId))
    .orderBy(desc(exportsTable.updatedAt))
    .all() as ExportRow[];
}

/** Get export by id. */
export function getById(id: string): ExportRow | undefined {
  return drizzleDb
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.id, id))
    .limit(1)
    .get() as ExportRow | undefined;
}

/** Insert export. */
export function insertExport(row: ExportInsert): void {
  drizzleDb.insert(exportsTable).values(row).run();
}

/** Update export by id. */
export function updateExport(id: string, set: Record<string, unknown>): void {
  drizzleDb.update(exportsTable).set(set).where(eq(exportsTable.id, id)).run();
}

/** Delete export by id. */
export function deleteExport(id: string): void {
  drizzleDb.delete(exportsTable).where(eq(exportsTable.id, id)).run();
}

/** Get podcast artwork path (relative). undefined = not found. */
export function getPodcastArtworkPath(podcastId: string): string | null | undefined {
  const row = drizzleDb
    .select({ artworkPath: podcasts.artworkPath })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row === undefined ? undefined : row.artworkPath ?? null;
}

/** Get published episodes for deploy (status=published, publishAt <= now). */
export function getPublishedEpisodeRowsForDeploy(
  podcastId: string,
): PublishedEpisodeRow[] {
  return drizzleDb
    .select({
      id: episodesTable.id,
      audioFinalPath: episodesTable.audioFinalPath,
      audioMime: episodesTable.audioMime,
      artworkPath: episodesTable.artworkPath,
    })
    .from(episodesTable)
    .where(
      and(
        eq(episodesTable.podcastId, podcastId),
        eq(episodesTable.status, "published"),
        sql`(${episodesTable.publishAt} IS NULL OR datetime(${episodesTable.publishAt}) <= datetime('now'))`,
        sql`(${episodesTable.expiresAt} IS NULL OR datetime(${episodesTable.expiresAt}) > datetime('now'))`,
      ),
    )
    .all() as PublishedEpisodeRow[];
}

/** Insert export run. */
export function insertExportRun(row: ExportRunInsert): void {
  drizzleDb.insert(exportRuns).values(row).run();
}

/** Update export run by id. */
export function updateExportRun(id: string, set: Record<string, unknown>): void {
  drizzleDb.update(exportRuns).set(set).where(eq(exportRuns.id, id)).run();
}

/** Get export run by id. */
export function getExportRunById(id: string): ExportRunRow | undefined {
  return drizzleDb
    .select()
    .from(exportRuns)
    .where(eq(exportRuns.id, id))
    .limit(1)
    .get() as ExportRunRow | undefined;
}
