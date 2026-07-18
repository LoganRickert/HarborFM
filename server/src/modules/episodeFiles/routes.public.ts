import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "fs";
import { API_PREFIX } from "../../config.js";
import * as publicRepo from "../public/repo.js";
import { ensurePublicFeedsEnabled } from "../public/utils.js";
import {
  assertPathUnder,
  episodeFilePath,
  episodeFilesDir,
} from "../../services/paths.js";
import * as repo from "./repo.js";

function publicDownloadUrl(
  podcastSlug: string,
  episodeSlug: string,
  fileId: string,
): string {
  return `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/files/${encodeURIComponent(fileId)}`;
}

export async function registerEpisodeFilesPublicRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/public/podcasts/:podcastSlug/episodes/:episodeSlug/files",
    {
      schema: {
        tags: ["Public"],
        summary: "List public episode files",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, episodeSlug } = request.params as {
        podcastSlug: string;
        episodeSlug: string;
      };
      const podcast = publicRepo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.publicFeedDisabled === 1 &&
        podcast.subscriberOnlyFeedEnabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const episode = publicRepo.getPublicEpisodeBySlug(
        podcast.id,
        episodeSlug,
        podcast.showScheduledEpisodes === 1,
      );
      if (!episode)
        return reply.status(404).send({ error: "Episode not found" });

      const items = repo.listEpisodeFiles(episode.id).map((row) =>
        repo.toDto(
          row,
          row.kind === "file"
            ? publicDownloadUrl(podcastSlug, episodeSlug, row.id)
            : null,
        ),
      );
      return { items };
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/episodes/:episodeSlug/files/:fileId",
    {
      schema: {
        tags: ["Public"],
        summary: "Download a public episode file",
        security: [],
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, episodeSlug, fileId } = request.params as {
        podcastSlug: string;
        episodeSlug: string;
        fileId: string;
      };
      const podcast = publicRepo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.publicFeedDisabled === 1 &&
        podcast.subscriberOnlyFeedEnabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const episode = publicRepo.getPublicEpisodeBySlug(
        podcast.id,
        episodeSlug,
        podcast.showScheduledEpisodes === 1,
      );
      if (!episode)
        return reply.status(404).send({ error: "Episode not found" });

      const row = repo.getEpisodeFile(episode.id, fileId);
      if (!row || row.kind !== "file" || !row.storageName) {
        return reply.status(404).send({ error: "File not found" });
      }
      const path = episodeFilePath(podcast.id, episode.id, row.storageName);
      try {
        assertPathUnder(path, episodeFilesDir(podcast.id, episode.id));
      } catch {
        return reply.status(404).send({ error: "File not found" });
      }
      if (!existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const filename = row.originalFilename || row.storageName;
      reply.header(
        "Content-Type",
        row.mimeType || "application/octet-stream",
      );
      reply.header(
        "Content-Disposition",
        `inline; filename="${filename.replace(/"/g, "")}"`,
      );
      return reply.send(createReadStream(path));
    },
  );
}
