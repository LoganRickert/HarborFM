import { eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { podcastArchiveSettings, episodes } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";

export type ArchiveSettingsRow = typeof podcastArchiveSettings.$inferSelect;

export function getByPodcastId(podcastId: string): ArchiveSettingsRow | undefined {
  return drizzleDb
    .select()
    .from(podcastArchiveSettings)
    .where(eq(podcastArchiveSettings.podcastId, podcastId))
    .limit(1)
    .get();
}

export function upsertSettings(row: {
  podcastId: string;
  name: string;
  mode: string;
  configEnc: string;
}): void {
  const existing = getByPodcastId(row.podcastId);
  const now = sqlNow();
  if (existing) {
    drizzleDb
      .update(podcastArchiveSettings)
      .set({
        name: row.name,
        mode: row.mode,
        configEnc: row.configEnc,
        updatedAt: now,
      })
      .where(eq(podcastArchiveSettings.podcastId, row.podcastId))
      .run();
  } else {
    drizzleDb
      .insert(podcastArchiveSettings)
      .values({
        podcastId: row.podcastId,
        name: row.name,
        mode: row.mode,
        configEnc: row.configEnc,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function updateSettings(
  podcastId: string,
  set: {
    name?: string;
    mode?: string;
    configEnc?: string;
  },
): void {
  drizzleDb
    .update(podcastArchiveSettings)
    .set({ ...set, updatedAt: sqlNow() })
    .where(eq(podcastArchiveSettings.podcastId, podcastId))
    .run();
}

export function deleteSettings(podcastId: string): void {
  drizzleDb
    .delete(podcastArchiveSettings)
    .where(eq(podcastArchiveSettings.podcastId, podcastId))
    .run();
}

export function setEpisodeArchived(
  episodeId: string,
  data: {
    archivedAt: string;
    archiveRemotePath: string;
    archiveSha256: string;
    archiveBytes: number;
    archiveFilename: string;
  },
): void {
  drizzleDb
    .update(episodes)
    .set({
      archivedAt: data.archivedAt,
      archiveRemotePath: data.archiveRemotePath,
      archiveSha256: data.archiveSha256,
      archiveBytes: data.archiveBytes,
      archiveFilename: data.archiveFilename,
      updatedAt: sqlNow(),
    })
    .where(eq(episodes.id, episodeId))
    .run();
}

export function clearEpisodeArchived(episodeId: string): void {
  drizzleDb
    .update(episodes)
    .set({
      archivedAt: null,
      archiveRemotePath: null,
      archiveSha256: null,
      archiveBytes: null,
      archiveFilename: null,
      updatedAt: sqlNow(),
    })
    .where(eq(episodes.id, episodeId))
    .run();
}
