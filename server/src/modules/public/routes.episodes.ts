import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "fs";
import { API_PREFIX, WAVEFORM_EXTENSION } from "../../config.js";
import {
  assertPathUnder,
  chaptersJsonPath,
  processedDir,
  resolveDataPath,
  transcriptSrtPath,
} from "../../services/paths.js";
import { validateSubscriberTokenByValue } from "../../services/subscriberTokens.js";
import {
  SUBSCRIBER_TOKENS_COOKIE,
  ensurePublicFeedsEnabled,
  likeEscape,
  publicCastDto,
  publicEpisodeDto,
} from "./utils.js";
import * as repo from "./repo.js";

export async function registerEpisodesRoutes(app: FastifyInstance) {
  app.get(
    "/public/podcasts/:podcastSlug/episodes",
    {
      schema: {
        tags: ["Public"],
        summary: "List podcast episodes",
        description:
          "Returns published episodes for a podcast (paginated). No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: { podcastSlug: { type: "string" } },
          required: ["podcastSlug"],
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
            offset: { type: "string" },
            sort: { type: "string", enum: ["newest", "oldest"] },
            q: { type: "string" },
            episodeType: { type: "string", enum: ["full", "trailer", "bonus"] },
          },
        },
        response: {
          200: {
            description: "Episodes list with total, limit, offset, hasMore",
          },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const query = request.query as {
        limit?: string;
        offset?: string;
        sort?: string;
        q?: string;
        episodeType?: string;
      };
      const limit = Math.min(parseInt(query.limit || "50", 10) || 50, 100);
      const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);
      const sort = query.sort === "oldest" ? "oldest" : "newest";
      const searchQ = (query.q ?? "").trim();
      const episodeTypeRaw = (query.episodeType ?? "").trim().toLowerCase();
      const episodeType =
        episodeTypeRaw === "full" || episodeTypeRaw === "trailer" || episodeTypeRaw === "bonus"
          ? episodeTypeRaw
          : null;

      const podcast = repo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.publicFeedDisabled === 1 &&
        podcast.subscriberOnlyFeedEnabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const includeSubscriberOnlyEpisodes = podcast.subscriberOnlyFeedEnabled === 1;
      const subscriberOnlyFeed = podcast.publicFeedDisabled === 1;
      const includeScheduledEpisodes = podcast.showScheduledEpisodes === 1;
      const searchPattern = searchQ ? `%${likeEscape(searchQ)}%` : null;

      const { rows, total } = repo.listPublishedEpisodes(podcast.id, {
        limit,
        offset,
        sort,
        searchPattern,
        includeSubscriberOnly: includeSubscriberOnlyEpisodes,
        includeScheduledEpisodes,
        episodeType,
      });

      let episodesList = rows.map((r) =>
        publicEpisodeDto(podcast.id, r, { subscriberOnlyFeed, podcastSlug }),
      );

      const cookieValue = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
      if (cookieValue) {
        try {
          const tokenMap = JSON.parse(cookieValue);
          if (typeof tokenMap === "object" && !Array.isArray(tokenMap)) {
            const token = tokenMap[podcastSlug];
            if (token) {
              const tokenRow = validateSubscriberTokenByValue(token);
              if (tokenRow && tokenRow.podcastId === podcast.id) {
                episodesList = episodesList.map((ep) => {
                  const scheduledNotReleased = (ep as { scheduled_not_released?: number }).scheduled_not_released === 1;
                  if (scheduledNotReleased) return ep;
                  return {
                    ...ep,
                    private_audio_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(ep.id))}`,
                    private_waveform_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(ep.slug))}/waveform`,
                    private_srt_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(ep.slug))}/transcript.srt`,
                    private_chapters_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(ep.slug))}/chapters.json`,
                  };
                });
              }
            }
          }
        } catch {
          // Invalid cookie, ignore
        }
      }

      // Don't send chapter/soundbite markers for subscriber-only episodes when user has no access
      episodesList = episodesList.map((ep) => ({
        ...ep,
        markers:
          ep.subscriber_only === 1 && !(ep as Record<string, unknown>).private_audio_url
            ? []
            : ep.markers,
        soundbites:
          ep.subscriber_only === 1 && !(ep as Record<string, unknown>).private_audio_url
            ? []
            : ep.soundbites,
      }));

      return {
        episodes: episodesList,
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      };
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/episodes/:episodeSlug",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode by slug",
        description:
          "Returns a published episode by podcast and episode slug. No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
          required: ["podcastSlug", "episodeSlug"],
        },
        response: {
          200: { description: "Episode metadata" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, episodeSlug } = request.params as {
        podcastSlug: string;
        episodeSlug: string;
      };
      const podcast = repo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.publicFeedDisabled === 1 &&
        podcast.subscriberOnlyFeedEnabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const row = repo.getPublicEpisodeBySlug(
        podcast.id,
        episodeSlug,
        podcast.showScheduledEpisodes === 1,
      );
      if (!row) return reply.status(404).send({ error: "Episode not found" });

      const episode = publicEpisodeDto(podcast.id, row, {
        subscriberOnlyFeed: podcast.publicFeedDisabled === 1,
        podcastSlug,
      }) as Record<string, unknown>;

      const scheduledNotReleased = episode.scheduled_not_released === 1;
      const cookieValue = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
      if (cookieValue && !scheduledNotReleased) {
        try {
          const tokenMap = JSON.parse(cookieValue);
          if (typeof tokenMap === "object" && !Array.isArray(tokenMap)) {
            const token = tokenMap[podcastSlug];
            if (token) {
              const tokenRow = validateSubscriberTokenByValue(token);
              if (tokenRow && tokenRow.podcastId === podcast.id) {
                episode.private_audio_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(row.id))}`;
                episode.private_waveform_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(episodeSlug)}/waveform`;
                episode.private_srt_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(episodeSlug)}/transcript.srt`;
                episode.private_chapters_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(episodeSlug)}/chapters.json`;
                if (row.videoFinalPath) {
                  episode.private_video_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(row.id))}/video`;
                }
              }
            }
          }
        } catch {
          // Invalid cookie, ignore
        }
      }

      // Don't send chapter/soundbite markers for subscriber-only episodes when user has no access
      if (
        episode.subscriber_only === 1 &&
        !(episode as Record<string, unknown>).private_audio_url
      ) {
        episode.markers = [];
        episode.soundbites = [];
      }

      return episode;
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/episodes/:episodeSlug/cast",
    {
      schema: {
        tags: ["Public"],
        summary: "List episode cast",
        description:
          "Returns cast members assigned to this episode (hosts and guests). No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
          required: ["podcastSlug", "episodeSlug"],
        },
        response: {
          200: {
            description: "Cast list",
            type: "object",
            properties: { cast: { type: "array" } },
          },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, episodeSlug } = request.params as {
        podcastSlug: string;
        episodeSlug: string;
      };
      const podcastId = repo.getPodcastIdBySlug(podcastSlug);
      if (!podcastId) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const castRows = repo.getEpisodeCastBySlugs(podcastSlug, episodeSlug);
      return {
        cast: castRows.map((r) => publicCastDto(r, podcastId)),
      };
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/episodes/:episodeSlug/waveform",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode waveform",
        description:
          "Returns waveform JSON for a published episode. No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
          required: ["podcastSlug", "episodeSlug"],
        },
        response: {
          200: { description: "Waveform JSON" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, episodeSlug } = request.params as {
        podcastSlug: string;
        episodeSlug: string;
      };
      const podcast = repo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.publicFeedDisabled === 1 &&
        podcast.subscriberOnlyFeedEnabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const row = repo.getEpisodeForWaveform(podcast.id, episodeSlug);
      if (
        !row ||
        row.subscriberOnly === 1 ||
        !row.audioFinalPath
      ) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const audioPath = resolveDataPath(row.audioFinalPath);
      if (!audioPath || !existsSync(audioPath)) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const waveformPath = audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
      if (!existsSync(waveformPath))
        return reply.status(404).send({ error: "Waveform not found" });
      try {
        assertPathUnder(waveformPath, processedDir(podcast.id, row.id));
      } catch {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const json = readFileSync(waveformPath, "utf-8");
      return reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", "public, max-age=3600")
        .send(json);
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/episodes/:episodeSlug/transcript.srt",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode transcript (SRT)",
        description:
          "Returns the transcript in SRT format if available. No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
          required: ["podcastSlug", "episodeSlug"],
        },
        response: {
          200: { description: "SRT file" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, episodeSlug } = request.params as {
        podcastSlug: string;
        episodeSlug: string;
      };
      const podcast = repo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.publicFeedDisabled === 1 &&
        podcast.subscriberOnlyFeedEnabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const row = repo.getPublishedEpisodeBySlug(podcast.id, episodeSlug);
      if (!row || row.subscriberOnly === 1)
        return reply.status(404).send({ error: "Transcript not found" });

      const srtPath = transcriptSrtPath(podcast.id, row.id);
      if (!existsSync(srtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      try {
        assertPathUnder(srtPath, processedDir(podcast.id, row.id));
      } catch {
        return reply.status(404).send({ error: "Transcript not found" });
      }
      const body = readFileSync(srtPath) as Buffer;
      return reply
        .header("Content-Type", "application/srt; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .header("Content-Length", String(body.length))
        .send(body);
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/episodes/:episodeSlug/chapters.json",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode chapters (JSON)",
        description:
          "Returns chapter markers in Podcast 2.0 JSON format if available. Same access as transcript.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            episodeSlug: { type: "string" },
          },
          required: ["podcastSlug", "episodeSlug"],
        },
        response: {
          200: { description: "Chapters JSON" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, episodeSlug } = request.params as {
        podcastSlug: string;
        episodeSlug: string;
      };
      const podcast = repo.getPodcastMetaForFeed(podcastSlug);
      if (!podcast)
        return reply.status(404).send({ error: "Chapters not found" });
      if (
        podcast.publicFeedDisabled === 1 &&
        podcast.subscriberOnlyFeedEnabled !== 1
      )
        return reply.status(404).send({ error: "Chapters not found" });

      const row = repo.getPublishedEpisodeBySlug(podcast.id, episodeSlug);
      if (!row || row.subscriberOnly === 1)
        return reply.status(404).send({ error: "Chapters not found" });

      const path = chaptersJsonPath(podcast.id, row.id);
      if (!existsSync(path))
        return reply.status(404).send({ error: "Chapters not found" });
      try {
        assertPathUnder(path, processedDir(podcast.id, row.id));
      } catch {
        return reply.status(404).send({ error: "Chapters not found" });
      }
      const body = readFileSync(path) as Buffer;
      return reply
        .header("Content-Type", "application/json+chapters; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .header("Content-Length", String(body.length))
        .send(body);
    },
  );
}
