import { existsSync, unlinkSync, writeFileSync } from "fs";
import {
  processedDir,
  assertResolvedPathUnder,
  chaptersJsonPath,
  getDataDir,
} from "./paths.js";

export interface ChapterMarker {
  time: number;
  title?: string;
  color?: string;
}

/**
 * Write or remove episode chapters JSON (Podcast 2.0 format).
 * When markers is empty or null, deletes the file if it exists.
 * Only people who can view the episode MP3 can view chapters (same access as transcript).
 */
export function writeEpisodeChaptersJson(
  podcastId: string,
  episodeId: string,
  markers: ChapterMarker[] | null | undefined,
): void {
  const path = chaptersJsonPath(podcastId, episodeId);
  assertResolvedPathUnder(path, getDataDir());

  if (!markers || markers.length === 0) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // ignore
      }
    }
    return;
  }

  const sorted = [...markers].sort((a, b) => a.time - b.time);
  const chapters = sorted.map((m) => ({
    startTime: m.time,
    title: (m.title ?? "").trim() || undefined,
    toc: true,
  }));

  const payload = {
    version: "1.2",
    chapters,
  };

  processedDir(podcastId, episodeId); // Ensure dir exists
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}
