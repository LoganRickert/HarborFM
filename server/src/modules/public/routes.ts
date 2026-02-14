import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { existsSync, readFileSync } from "fs";
import { basename, dirname, extname } from "path";
import { publicPodcastsListQuerySchema } from "@harborfm/shared";
import { db } from "../../db/index.js";
import { getExportPathPrefix } from "../../services/export-config.js";
import {
  getClientIp,
  getUserAgent,
  getIpBan,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import { recordRssRequest } from "../../services/podcastStats.js";
import {
  assertPathUnder,
  assertSafeId,
  artworkDir,
  castPhotoDir,
  processedDir,
  rssDir,
  transcriptSrtPath,
} from "../../services/paths.js";
import { EXT_DOT_TO_MIMETYPE } from "../../utils/artwork.js";
import { isHumanUserAgent } from "../../utils/isBot.js";
import {
  generateRss,
  getCachedRssIfFresh,
  getOrCreateTokenFeedTemplate,
  SUBSCRIBER_TOKEN_ID_PLACEHOLDER,
  writeRssToFile,
} from "../../services/rss.js";
import {
  validateSubscriberTokenByValue,
  validateSubscriberTokenByValueWithExistence,
  touchSubscriberToken,
} from "../../services/subscriberTokens.js";
import { readSettings } from "../settings/index.js";
import { getCookieSecureFlag } from "../../services/cookies.js";
import {
  getPodcastByHost,
  getCanonicalFeedUrl,
} from "../../services/dns/custom-domain-resolver.js";
import {
  API_PREFIX,
  RSS_CACHE_MAX_AGE_MS,
  RSS_FEED_FILENAME,
  WAVEFORM_EXTENSION,
} from "../../config.js";

export async function publicRoutes(app: FastifyInstance) {
  function ensurePublicFeedsEnabled(
    reply: import("fastify").FastifyReply,
  ): boolean {
    const settings = readSettings();
    if (!settings.public_feeds_enabled) {
      // Hide the existence of feeds when disabled.
      reply.status(404).send({ error: "Not found" });
      return false;
    }
    return true;
  }

  /** Custom Terms/Privacy: return when set so /terms and /privacy can show custom or default. No auth. */
  app.get(
    "/public/legal",
    {
      schema: {
        tags: ["Public"],
        summary: "Get custom legal text",
        description:
          "Returns custom terms and privacy policy markdown if set. Used to decide whether to show custom or default on /terms and /privacy.",
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              terms: {
                type: ["string", "null"],
                description: "Custom terms markdown or null",
              },
              privacy: {
                type: ["string", "null"],
                description: "Custom privacy markdown or null",
              },
            },
          },
        },
      },
    },
    async () => {
      const settings = readSettings();
      const terms = (settings.custom_terms ?? "").trim() || null;
      const privacy = (settings.custom_privacy ?? "").trim() || null;
      return { terms, privacy };
    },
  );

  function publicPodcastDto(row: Record<string, unknown>) {
    const path = row.artwork_path as string | null | undefined;
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description ?? "",
      language: row.language ?? "en",
      author_name: row.author_name ?? "",
      artwork_url: row.artwork_url ?? null,
      artwork_uploaded: Boolean(path),
      artwork_filename: path ? basename(path) : null,
      site_url: row.site_url ?? null,
      explicit: row.explicit ?? 0,
      subscriber_only_feed_enabled: row.subscriber_only_feed_enabled ?? 0,
      public_feed_disabled: row.public_feed_disabled ?? 0,
      apple_podcasts_url: row.apple_podcasts_url ?? null,
      spotify_url: row.spotify_url ?? null,
      amazon_music_url: row.amazon_music_url ?? null,
      podcast_index_url: row.podcast_index_url ?? null,
      listen_notes_url: row.listen_notes_url ?? null,
      castbox_url: row.castbox_url ?? null,
      x_url: row.x_url ?? null,
      facebook_url: row.facebook_url ?? null,
      instagram_url: row.instagram_url ?? null,
      tiktok_url: row.tiktok_url ?? null,
      youtube_url: row.youtube_url ?? null,
    };
  }

  function publicEpisodeDto(
    podcastId: string,
    row: Record<string, unknown>,
    opts: { subscriberOnlyFeed: boolean; podcastSlug?: string } = {
      subscriberOnlyFeed: false,
    },
  ) {
    const audioBytes = row.audio_bytes != null ? Number(row.audio_bytes) : null;
    const hasAudio =
      Boolean(row.audio_final_path) && (audioBytes == null || audioBytes > 0);
    const subscriberOnly = (row.subscriber_only as number) === 1;
    const allowPublicAudio = !opts.subscriberOnlyFeed && !subscriberOnly;
    const path = row.artwork_path as string | null | undefined;
    const baseDesc = String(row.description ?? "");
    const snapshot =
      row.description_copyright_snapshot != null
        ? String(row.description_copyright_snapshot).trim()
        : "";
    const description = snapshot
      ? `${baseDesc}\r\n\r\nMusic:\r\n${snapshot}`
      : baseDesc;

    // Check if transcript exists (only if we have the slug)
    const srtPath =
      opts.podcastSlug && row.slug
        ? transcriptSrtPath(podcastId, String(row.id))
        : null;
    const hasSrt = srtPath && existsSync(srtPath);
    const allowPublicSrt =
      hasSrt && !opts.subscriberOnlyFeed && !subscriberOnly;

    return {
      id: row.id,
      podcast_id: row.podcast_id,
      title: row.title,
      slug: row.slug,
      description,
      guid: row.guid,
      season_number: row.season_number ?? null,
      episode_number: row.episode_number ?? null,
      episode_type: row.episode_type ?? null,
      explicit: row.explicit ?? null,
      publish_at: row.publish_at ?? null,
      artwork_url: row.artwork_url ?? null,
      artwork_filename: path ? basename(path) : null,
      audio_mime: row.audio_mime ?? null,
      audio_bytes: audioBytes,
      audio_duration_sec: row.audio_duration_sec ?? null,
      audio_url:
        hasAudio && allowPublicAudio
          ? `/${API_PREFIX}/${podcastId}/episodes/${String(row.id)}`
          : null,
      srt_url:
        opts.podcastSlug && allowPublicSrt
          ? `/${API_PREFIX}/public/podcasts/${encodeURIComponent(opts.podcastSlug)}/episodes/${encodeURIComponent(String(row.slug))}/transcript.srt`
          : null,
      subscriber_only: subscriberOnly ? 1 : 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // Safe filename for artwork: nanoid.ext or episodeId.ext (alphanumeric, hyphen, underscore + .png|.webp|.jpg)
  const ARTWORK_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/i;

  // Serve uploaded episode cover image (public so feed and edit preview can use it).
  app.get(
    "/public/artwork/:podcastId/episodes/:episodeId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode artwork",
        description:
          "Returns the episode cover image (PNG/WebP/JPG). No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastId", "episodeId", "filename"],
        },
        response: {
          200: { description: "Image binary" },
          206: { description: "Partial content (byte range)" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId, filename } = request.params as {
        podcastId: string;
        episodeId: string;
        filename: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(episodeId, "episodeId");
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const row = db
        .prepare(
          "SELECT artwork_path FROM episodes WHERE id = ? AND podcast_id = ?",
        )
        .get(episodeId, podcastId) as
        | { artwork_path: string | null }
        | undefined;
      if (!row?.artwork_path || basename(row.artwork_path) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      try {
        const safePath = assertPathUnder(
          row.artwork_path,
          artworkDir(podcastId),
        );
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error") {
          const err = result.metadata.error as Error & { status?: number };
          const status = (err.status ?? 404) as 404 | 500;
          return reply
            .status(status)
            .send({ error: err.message ?? "Not found" });
        }
        reply.status(result.statusCode as 200 | 206 | 416);
        const headers = result.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) reply.header(key, value);
        }
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  // Serve uploaded podcast cover image (public so feed and edit preview can use it). URL includes filename so cache busts on new upload.
  app.get(
    "/public/artwork/:podcastId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get podcast artwork",
        description:
          "Returns the podcast/show cover image (PNG/WebP/JPG). No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastId", "filename"],
        },
        response: {
          200: { description: "Image binary" },
          206: { description: "Partial content (byte range)" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, filename } = request.params as {
        podcastId: string;
        filename: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const row = db
        .prepare("SELECT artwork_path FROM podcasts WHERE id = ?")
        .get(podcastId) as { artwork_path: string | null } | undefined;
      if (!row?.artwork_path || basename(row.artwork_path) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      try {
        const safePath = assertPathUnder(
          row.artwork_path,
          artworkDir(podcastId),
        );
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error") {
          const err = result.metadata.error as Error & { status?: number };
          const status = (err.status ?? 404) as 404 | 500;
          return reply
            .status(status)
            .send({ error: err.message ?? "Not found" });
        }
        reply.status(result.statusCode as 200 | 206 | 416);
        const headers = result.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) reply.header(key, value);
        }
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  // Serve cast member photo (public).
  app.get(
    "/public/artwork/:podcastId/cast/:castId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get cast photo",
        description:
          "Returns a cast member photo (PNG/WebP/JPG). No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            castId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastId", "castId", "filename"],
        },
        response: {
          200: { description: "Image binary" },
          206: { description: "Partial content" },
          416: { description: "Range not satisfiable" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, castId, filename } = request.params as {
        podcastId: string;
        castId: string;
        filename: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(castId, "castId");
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!ARTWORK_FILENAME_REGEX.test(filename)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const row = db
        .prepare(
          "SELECT photo_path FROM podcast_cast WHERE id = ? AND podcast_id = ? AND is_public = 1",
        )
        .get(castId, podcastId) as { photo_path: string | null } | undefined;
      if (!row?.photo_path || basename(row.photo_path) !== filename) {
        return reply.status(404).send({ error: "Not found" });
      }
      try {
        const safePath = assertPathUnder(row.photo_path, castPhotoDir(podcastId));
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error") {
          return reply.status(404).send({ error: "Not found" });
        }
        reply.status(result.statusCode as 200 | 206 | 416);
        const headers = result.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) reply.header(key, value);
        }
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  // Public config (no auth): used by the web client to gate /feed routes.
  app.get(
    "/public/config",
    {
      schema: {
        tags: ["Public"],
        summary: "Get public config",
        description:
          "Returns whether public feeds are enabled. No authentication required.",
        security: [],
        response: {
          200: {
            description: "Config",
            type: "object",
            properties: {
              public_feeds_enabled: { type: "boolean" },
              custom_feed_slug: {
                type: "string",
                description:
                  "When request Host is a custom podcast domain (link_domain, managed_domain, or managed_sub_domain), the podcast slug to show at /.",
              },
              gdpr_consent_banner_enabled: {
                type: "boolean",
                description:
                  "When true, show GDPR-style cookie/tracking consent banner on public pages.",
              },
            },
            required: ["public_feeds_enabled"],
          },
        },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      const host =
        (request.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim() ||
        request.hostname ||
        "";
      const match = getPodcastByHost(host);
      const payload: {
        public_feeds_enabled: boolean;
        custom_feed_slug?: string;
        gdpr_consent_banner_enabled: boolean;
      } = {
        public_feeds_enabled: Boolean(settings.public_feeds_enabled),
        gdpr_consent_banner_enabled: Boolean(settings.gdpr_consent_banner_enabled),
      };
      if (match) payload.custom_feed_slug = match.slug;
      return reply.send(payload);
    },
  );

  // List podcasts with pagination, search, and sort (public, no auth required)
  app.get(
    "/public/podcasts",
    {
      schema: {
        tags: ["Public"],
        summary: "List podcasts (paginated)",
        description:
          "Returns podcasts with optional search and sort. No authentication required. 404 when public feeds are disabled.",
        security: [],
        querystring: {
          type: "object",
          properties: {
            limit: {
              type: "string",
              description: "Page size (default 25, max 100)",
            },
            offset: { type: "string", description: "Offset for pagination" },
            q: {
              type: "string",
              description: "Search in title, slug, author, description",
            },
            sort: {
              type: "string",
              enum: ["newest", "oldest"],
              description: "Sort by created_at",
            },
          },
        },
        response: {
          200: { description: "Paginated list of podcast metadata" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const parsed = publicPodcastsListQuerySchema.safeParse(request.query);
      const query = parsed.success ? parsed.data : {};
      const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
      const offset = Math.max(query.offset ?? 0, 0);
      const searchQ = (query.q ?? "").trim();
      const sortNewestFirst = query.sort !== "oldest";

      // LIKE pattern: escape % and _ so they match literally in SQLite
      const likeEscape = (s: string) =>
        s.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const likePattern = searchQ ? `%${likeEscape(searchQ)}%` : null;

      const unlistedFilter = " (COALESCE(unlisted, 0) = 0) ";
      const whereClause = likePattern
        ? `WHERE ${unlistedFilter} AND (title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR author_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`
        : `WHERE ${unlistedFilter}`;
      const orderClause = sortNewestFirst
        ? "ORDER BY created_at DESC"
        : "ORDER BY created_at ASC";
      const args = likePattern
        ? [likePattern, likePattern, likePattern, likePattern]
        : [];

      const countRow = db
        .prepare(`SELECT COUNT(*) as count FROM podcasts ${whereClause}`)
        .get(...args) as { count: number };
      const total = countRow.count;

      const rows = db
        .prepare(
          `SELECT id, title, slug, description, language, author_name, artwork_url, artwork_path, site_url, explicit, created_at,
                COALESCE(public_feed_disabled, 0) AS public_feed_disabled,
                COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled,
                apple_podcasts_url, spotify_url, amazon_music_url, podcast_index_url, listen_notes_url, castbox_url,
                x_url, facebook_url, instagram_url, tiktok_url, youtube_url
         FROM podcasts ${whereClause} ${orderClause} LIMIT ? OFFSET ?`,
        )
        .all(...[...args, limit, offset]) as Record<string, unknown>[];

      const podcasts = rows.map((row) => {
        const dto = publicPodcastDto(row) as Record<string, unknown>;
        dto.created_at = row.created_at;
        const exportRow = db
          .prepare(
            `SELECT id, podcast_id, mode, name, public_base_url, config_enc FROM exports WHERE podcast_id = ? AND public_base_url IS NOT NULL AND LENGTH(TRIM(public_base_url)) > 0 LIMIT 1`,
          )
          .get(row.id) as Record<string, unknown> | undefined;
        if (exportRow?.public_base_url) {
          const base = String(exportRow.public_base_url)
            .trim()
            .replace(/\/$/, "");
          const prefix = getExportPathPrefix(exportRow) ?? "";
          dto.rss_url = prefix
            ? `${base}/${prefix}/${RSS_FEED_FILENAME}`
            : `${base}/${RSS_FEED_FILENAME}`;
        }
        return dto;
      });

      return reply.send({ podcasts, total, limit, offset });
    },
  );

  // Get podcast by slug (public, no auth required)
  app.get(
    "/public/podcasts/:slug",
    {
      schema: {
        tags: ["Public"],
        summary: "Get podcast by slug",
        description:
          "Returns podcast metadata by URL slug. No authentication required. 404 when public feeds are disabled.",
        security: [],
        params: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: ["slug"],
        },
        response: {
          200: { description: "Podcast metadata" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { slug } = request.params as { slug: string };
      const row = db
        .prepare(
          `SELECT id, title, slug, description, language, author_name, artwork_url, artwork_path, site_url, explicit,
                COALESCE(public_feed_disabled, 0) AS public_feed_disabled,
                COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled,
                link_domain, managed_domain, managed_sub_domain,
                apple_podcasts_url, spotify_url, amazon_music_url, podcast_index_url, listen_notes_url, castbox_url,
                x_url, facebook_url, instagram_url, tiktok_url, youtube_url
         FROM podcasts WHERE slug = ?`,
        )
        .get(slug) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Podcast not found" });
      const publicFeedDisabled = (row.public_feed_disabled as number) === 1;
      const subscriberOnlyFeedEnabled =
        (row.subscriber_only_feed_enabled as number) === 1;
      if (publicFeedDisabled && !subscriberOnlyFeedEnabled)
        return reply.status(404).send({ error: "Podcast not found" });
      const dto = publicPodcastDto(row) as Record<string, unknown>;
      const settings = readSettings();
      const canonicalUrl = getCanonicalFeedUrl(row as { link_domain?: string | null; managed_domain?: string | null; managed_sub_domain?: string | null }, settings);
      if (canonicalUrl) dto.canonical_feed_url = canonicalUrl;
      const exportRow = db
        .prepare(
          `SELECT id, podcast_id, mode, name, public_base_url, config_enc FROM exports WHERE podcast_id = ? AND public_base_url IS NOT NULL AND LENGTH(TRIM(public_base_url)) > 0 LIMIT 1`,
        )
        .get(row.id) as Record<string, unknown> | undefined;
      if (exportRow?.public_base_url) {
        const base = String(exportRow.public_base_url)
          .trim()
          .replace(/\/$/, "");
        const prefix = getExportPathPrefix(exportRow) ?? "";
        dto.rss_url = prefix
          ? `${base}/${prefix}/${RSS_FEED_FILENAME}`
          : `${base}/${RSS_FEED_FILENAME}`;
      }
      return dto;
    },
  );

  // Get public cast (hosts and guests) for a podcast by slug.
  app.get(
    "/public/podcasts/:podcastSlug/cast",
    {
      schema: {
        tags: ["Public"],
        summary: "List podcast cast",
        description:
          "Returns public hosts and guests. Hosts first (all), then guests (paginated with limit/offset).",
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
          },
        },
        response: {
          200: {
            description: "Hosts and guests",
            type: "object",
            properties: {
              hosts: { type: "array" },
              guests: { type: "array" },
              guests_total: { type: "number" },
              guests_has_more: { type: "boolean" },
            },
          },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug } = request.params as { podcastSlug: string };
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit || "10", 10) || 10, 100);
      const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);

      const podcast = db
        .prepare(
          "SELECT id FROM podcasts WHERE slug = ? AND (COALESCE(unlisted, 0) = 0)",
        )
        .get(podcastSlug) as { id: string } | undefined;
      if (!podcast) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      const hosts = db
        .prepare(
          `SELECT id, name, role, description, photo_path, photo_url, social_link_text
           FROM podcast_cast
           WHERE podcast_id = ? AND role = 'host' AND is_public = 1
           ORDER BY created_at DESC`,
        )
        .all(podcast.id) as Record<string, unknown>[];

      const guestsCount = db
        .prepare(
          "SELECT COUNT(*) as count FROM podcast_cast WHERE podcast_id = ? AND role = 'guest' AND is_public = 1",
        )
        .get(podcast.id) as { count: number };
      const guestsTotal = guestsCount?.count ?? 0;

      const guests = db
        .prepare(
          `SELECT id, name, role, description, photo_path, photo_url, social_link_text
           FROM podcast_cast
           WHERE podcast_id = ? AND role = 'guest' AND is_public = 1
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(podcast.id, limit, offset) as Record<string, unknown>[];

      const guestsHasMore = offset + guests.length < guestsTotal;

      return {
        hosts: hosts.map((r) => publicCastDto(r, podcast.id)),
        guests: guests.map((r) => publicCastDto(r, podcast.id)),
        guests_total: guestsTotal,
        guests_has_more: guestsHasMore,
      };
    },
  );

  function publicCastDto(row: Record<string, unknown>, podcastId: string) {
    const path = row.photo_path as string | null | undefined;
    let photo_url = row.photo_url as string | null | undefined;
    if (path && typeof path === "string") {
      try {
        const dir = castPhotoDir(podcastId);
        assertPathUnder(path, dir);
        const fn = basename(path);
        photo_url = `/${API_PREFIX}/public/artwork/${podcastId}/cast/${row.id}/${fn}`;
      } catch {
        photo_url = row.photo_url as string | null;
      }
    }
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      description: row.description ?? null,
      photo_url: photo_url ?? null,
      social_link_text: row.social_link_text ?? null,
    };
  }

  // Get published episodes for a podcast by podcast slug (public, no auth required)
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
      const query = request.query as { limit?: string; offset?: string; sort?: string; q?: string };
      const limit = Math.min(parseInt(query.limit || "50", 10) || 50, 100); // Default 50, max 100
      const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);
      const sort = query.sort === "oldest" ? "oldest" : "newest";
      const orderDir = sort === "oldest" ? "ASC" : "DESC";
      const searchQ = (query.q ?? "").trim();
      const likeEscapeEp = (s: string) =>
        s.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const likePatternEp = searchQ ? `%${likeEscapeEp(searchQ)}%` : null;

      const podcast = db
        .prepare(
          "SELECT id, COALESCE(public_feed_disabled, 0) AS public_feed_disabled, COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled FROM podcasts WHERE slug = ?",
        )
        .get(podcastSlug) as
        | {
            id: string;
            public_feed_disabled: number;
            subscriber_only_feed_enabled: number;
          }
        | undefined;
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.public_feed_disabled === 1 &&
        podcast.subscriber_only_feed_enabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const includeSubscriberOnlyEpisodes =
        podcast.subscriber_only_feed_enabled === 1;
      const episodeFilter = includeSubscriberOnlyEpisodes
        ? ""
        : " AND (COALESCE(subscriber_only, 0) = 0)";
      const subscriberOnlyFeed = podcast.public_feed_disabled === 1;
      const searchFilterEp = likePatternEp
        ? ` AND (title LIKE ? ESCAPE '\\' OR COALESCE(description, '') LIKE ? ESCAPE '\\')`
        : "";
      const searchArgs = likePatternEp ? [likePatternEp, likePatternEp] : [];

      // Get total count
      const totalCount = db
        .prepare(
          `SELECT COUNT(*) as count FROM episodes 
         WHERE podcast_id = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))${episodeFilter}${searchFilterEp}`,
        )
        .get(podcast.id, ...searchArgs) as { count: number };

      // Get paginated episodes (include subscriber_only when feed is subscriber-only so visitors see locked cards)
      const rows = db
        .prepare(
          `SELECT id, podcast_id, title, slug, description, description_copyright_snapshot, guid,
                season_number, episode_number, episode_type, explicit, publish_at,
                artwork_url, artwork_path, audio_mime, audio_bytes, audio_duration_sec, audio_final_path,
                COALESCE(subscriber_only, 0) AS subscriber_only, created_at, updated_at
         FROM episodes 
         WHERE podcast_id = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))${episodeFilter}${searchFilterEp}
         ORDER BY publish_at ${orderDir}, created_at ${orderDir}
         LIMIT ? OFFSET ?`,
        )
        .all(podcast.id, ...searchArgs, limit, offset) as Record<string, unknown>[];

      let episodes = rows.map((r) =>
        publicEpisodeDto(podcast.id, r, { subscriberOnlyFeed, podcastSlug }),
      );

      // Check for authenticated subscriber token and add private URLs
      const cookieValue = request.cookies.subscriber_tokens;
      if (cookieValue) {
        try {
          const tokenMap = JSON.parse(cookieValue);
          if (typeof tokenMap === "object" && !Array.isArray(tokenMap)) {
            const token = tokenMap[podcastSlug];
            if (token) {
              const tokenRow = validateSubscriberTokenByValue(token);
              if (tokenRow && tokenRow.podcast_id === podcast.id) {
                // Add private URLs to each episode
                episodes = episodes.map((ep) => ({
                  ...ep,
                  private_audio_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(ep.id))}`,
                  private_waveform_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(ep.slug))}/waveform`,
                  private_srt_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(ep.slug))}/transcript.srt`,
                }));
              }
            }
          }
        } catch {
          // Invalid cookie, ignore
        }
      }

      return {
        episodes,
        total: totalCount.count,
        limit,
        offset,
        hasMore: offset + rows.length < totalCount.count,
      };
    },
  );

  // Get episode by podcast slug and episode slug (public, no auth required)
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
      const podcast = db
        .prepare(
          "SELECT id, COALESCE(public_feed_disabled, 0) AS public_feed_disabled, COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled FROM podcasts WHERE slug = ?",
        )
        .get(podcastSlug) as
        | {
            id: string;
            public_feed_disabled: number;
            subscriber_only_feed_enabled: number;
          }
        | undefined;
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.public_feed_disabled === 1 &&
        podcast.subscriber_only_feed_enabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const row = db
        .prepare(
          `SELECT id, podcast_id, title, slug, description, description_copyright_snapshot, guid,
                season_number, episode_number, episode_type, explicit, publish_at,
                artwork_url, artwork_path, audio_mime, audio_bytes, audio_duration_sec, audio_final_path,
                COALESCE(subscriber_only, 0) AS subscriber_only, created_at, updated_at
         FROM episodes 
         WHERE podcast_id = ? AND slug = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`,
        )
        .get(podcast.id, episodeSlug) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Episode not found" });

      const episode = publicEpisodeDto(podcast.id, row, {
        subscriberOnlyFeed: podcast.public_feed_disabled === 1,
        podcastSlug,
      }) as Record<string, unknown>;

      // Check for authenticated subscriber token
      const cookieValue = request.cookies.subscriber_tokens;
      if (cookieValue) {
        try {
          const tokenMap = JSON.parse(cookieValue);
          if (typeof tokenMap === "object" && !Array.isArray(tokenMap)) {
            const token = tokenMap[podcastSlug];
            if (token) {
              const tokenRow = validateSubscriberTokenByValue(token);
              if (tokenRow && tokenRow.podcast_id === podcast.id) {
                // Add private URLs
                episode.private_audio_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(String(row.id))}`;
                episode.private_waveform_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(episodeSlug)}/waveform`;
                episode.private_srt_url = `/${API_PREFIX}/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/episodes/${encodeURIComponent(episodeSlug)}/transcript.srt`;
              }
            }
          }
        } catch {
          // Invalid cookie, ignore
        }
      }

      return episode;
    },
  );

  // Get episode cast (assigned hosts/guests) - public, no auth required
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
      const podcast = db
        .prepare(
          "SELECT id FROM podcasts WHERE slug = ? AND (COALESCE(unlisted, 0) = 0)",
        )
        .get(podcastSlug) as { id: string } | undefined;
      if (!podcast) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const episodeRow = db
        .prepare(
          `SELECT id FROM episodes
           WHERE podcast_id = ? AND slug = ? AND status = 'published'
           AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`,
        )
        .get(podcast.id, episodeSlug) as { id: string } | undefined;
      if (!episodeRow) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const rows = db
        .prepare(
          `SELECT c.* FROM podcast_cast c
           JOIN episode_cast ec ON ec.cast_id = c.id
           WHERE ec.episode_id = ? AND c.is_public = 1
           ORDER BY c.role ASC, c.created_at DESC`,
        )
        .all(episodeRow.id) as Record<string, unknown>[];
      return {
        cast: rows.map((r) => publicCastDto(r, podcast.id)),
      };
    },
  );

  // Get episode waveform by podcast slug and episode slug (public, no auth required)
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
      const podcast = db
        .prepare(
          "SELECT id, COALESCE(public_feed_disabled, 0) AS public_feed_disabled, COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled FROM podcasts WHERE slug = ?",
        )
        .get(podcastSlug) as
        | {
            id: string;
            public_feed_disabled: number;
            subscriber_only_feed_enabled: number;
          }
        | undefined;
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.public_feed_disabled === 1 &&
        podcast.subscriber_only_feed_enabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const row = db
        .prepare(
          `SELECT id, audio_final_path, COALESCE(subscriber_only, 0) AS subscriber_only FROM episodes
         WHERE podcast_id = ? AND slug = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`,
        )
        .get(podcast.id, episodeSlug) as
        | {
            id: string;
            audio_final_path: string | null;
            subscriber_only: number;
          }
        | undefined;
      if (
        !row ||
        row.subscriber_only === 1 ||
        !row.audio_final_path ||
        !existsSync(row.audio_final_path)
      ) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      const waveformPath = row.audio_final_path.replace(
        /\.[^.]+$/,
        WAVEFORM_EXTENSION,
      );
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

  // Get episode transcript SRT (public, no auth required). Served when Whisper generated one after render.
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
      const podcast = db
        .prepare(
          "SELECT id, COALESCE(public_feed_disabled, 0) AS public_feed_disabled, COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled FROM podcasts WHERE slug = ?",
        )
        .get(podcastSlug) as
        | {
            id: string;
            public_feed_disabled: number;
            subscriber_only_feed_enabled: number;
          }
        | undefined;
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });
      if (
        podcast.public_feed_disabled === 1 &&
        podcast.subscriber_only_feed_enabled !== 1
      )
        return reply.status(404).send({ error: "Podcast not found" });

      const row = db
        .prepare(
          `SELECT id, COALESCE(subscriber_only, 0) AS subscriber_only FROM episodes
         WHERE podcast_id = ? AND slug = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`,
        )
        .get(podcast.id, episodeSlug) as
        | { id: string; subscriber_only: number }
        | undefined;
      if (!row || row.subscriber_only === 1)
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

  // Get RSS feed by podcast slug (public, no auth required)
  // Serves from data/rss/:podcastId/<RSS_FEED_FILENAME> if present and < RSS_CACHE_MAX_AGE_MS; otherwise generates, saves, and serves.
  // HEAD requests are not counted. 304 Not Modified (if added) should still count as a feed check - record before sending.
  app.get(
    "/public/podcasts/:podcastSlug/rss",
    {
      schema: {
        tags: ["Public"],
        summary: "Get RSS feed",
        description:
          "Returns the RSS feed XML for a podcast by slug. No authentication required.",
        security: [],
        params: {
          type: "object",
          properties: { podcastSlug: { type: "string" } },
          required: ["podcastSlug"],
        },
        response: {
          200: { description: "RSS XML" },
          206: { description: "Partial content (byte range)" },
          404: { description: "Podcast not found" },
          416: { description: "Range not satisfiable" },
          500: { description: "Failed to generate feed" },
        },
      },
    },
    async (request, reply) => {
      // When public_feed_disabled, do not serve public RSS at all (subscriber-only show).
      const { podcastSlug } = request.params as { podcastSlug: string };
      const podcast = db
        .prepare(
          "SELECT id, COALESCE(public_feed_disabled, 0) AS public_feed_disabled FROM podcasts WHERE slug = ?",
        )
        .get(podcastSlug) as
        | { id: string; public_feed_disabled: number }
        | undefined;
      if (!podcast || podcast.public_feed_disabled === 1)
        return reply.status(404).send({ error: "Podcast not found" });

      if (request.method === "GET") {
        const ua = getUserAgent(request);
        const isBot = !isHumanUserAgent(ua);
        recordRssRequest(podcast.id, isBot);
      }

      try {
        if (!getCachedRssIfFresh(podcast.id, RSS_CACHE_MAX_AGE_MS)) {
          const xml = generateRss(podcast.id, null);
          writeRssToFile(podcast.id, xml);
        }
        const root = rssDir(podcast.id);
        const result = await send(request.raw, RSS_FEED_FILENAME, {
          root,
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 3600,
        });
        if (result.type === "error") {
          const err = result.metadata.error as Error & { status?: number };
          const status = (err.status ?? 404) as 404 | 500;
          return reply
            .status(status)
            .send({ error: err.message ?? "Not found" });
        }
        reply.status(result.statusCode as 200 | 206 | 416);
        const headers = result.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) reply.header(key, value);
        }
        reply.header("Content-Type", "application/xml");
        return reply.send(result.stream);
      } catch (_err) {
        return reply.status(500).send({ error: "Failed to generate RSS feed" });
      }
    },
  );

  const AUTH_SUBSCRIBER_TOKEN_CONTEXT = "auth_subscriber_token" as const;

  // ---- Token-gated media (private/:token/...). 404 for invalid/expired token. Only raw token accepted. ----
  function resolvePodcastAndToken(
    request: import("fastify").FastifyRequest,
    podcastSlug: string,
    token: string,
    reply: import("fastify").FastifyReply,
  ): { podcastId: string } | null {
    const podcast = db
      .prepare("SELECT id FROM podcasts WHERE slug = ?")
      .get(podcastSlug) as { id: string } | undefined;
    if (!podcast) {
      reply.status(404).send({ error: "Not found" });
      return null;
    }
    const result = validateSubscriberTokenByValueWithExistence(token);
    if (!result.tokenExists) {
      const ip = getClientIp(request);
      console.log(`[ban] Bad/unknown subscriber token attempt from IP=${ip} (resolvePodcastAndToken)`);
      const userAgent = getUserAgent(request);
      recordFailureAndMaybeBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT, {
        userAgent,
      });
      const ban = getIpBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT);
      if (ban.banned) {
        reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({ error: "Too many failed attempts. Try again later." });
        return null;
      }
      reply.status(404).send({ error: "Not found" });
      return null;
    }
    if (!result.row || result.row.podcast_id !== podcast.id) {
      reply.status(404).send({ error: "Not found" });
      return null;
    }
    touchSubscriberToken(result.row.id);
    return { podcastId: podcast.id };
  }

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/artwork/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get podcast artwork (token)",
        description:
          "Returns podcast cover image when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastSlug", "token", "filename"],
        },
        response: {
          200: { description: "Image" },
          206: { description: "Partial content" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, filename } = request.params as {
        podcastSlug: string;
        token: string;
        filename: string;
      };
      const resolved = resolvePodcastAndToken(
        request,
        podcastSlug,
        token,
        reply,
      );
      if (!resolved) return;
      const { podcastId } = resolved;
      if (!ARTWORK_FILENAME_REGEX.test(filename))
        return reply.status(404).send({ error: "Not found" });
      const row = db
        .prepare("SELECT artwork_path FROM podcasts WHERE id = ?")
        .get(podcastId) as { artwork_path: string | null } | undefined;
      if (!row?.artwork_path || basename(row.artwork_path) !== filename)
        return reply.status(404).send({ error: "Not found" });
      try {
        const safePath = assertPathUnder(
          row.artwork_path,
          artworkDir(podcastId),
        );
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error")
          return reply.status(404).send({ error: "Not found" });
        reply.status(result.statusCode as 200 | 206 | 416);
        (
          Object.entries(result.headers as Record<string, string>) as [
            string,
            string,
          ][]
        ).forEach(([k, v]) => v !== undefined && reply.header(k, v));
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/artwork/episodes/:episodeId/:filename",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode artwork (token)",
        description:
          "Returns episode cover image when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeId", "filename"],
        },
        response: {
          200: { description: "Image" },
          206: { description: "Partial content" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, episodeId, filename } = request.params as {
        podcastSlug: string;
        token: string;
        episodeId: string;
        filename: string;
      };
      const resolved = resolvePodcastAndToken(
        request,
        podcastSlug,
        token,
        reply,
      );
      if (!resolved) return;
      const { podcastId } = resolved;
      if (!ARTWORK_FILENAME_REGEX.test(filename))
        return reply.status(404).send({ error: "Not found" });
      const row = db
        .prepare(
          "SELECT artwork_path FROM episodes WHERE id = ? AND podcast_id = ?",
        )
        .get(episodeId, podcastId) as
        | { artwork_path: string | null }
        | undefined;
      if (!row?.artwork_path || basename(row.artwork_path) !== filename)
        return reply.status(404).send({ error: "Not found" });
      try {
        const safePath = assertPathUnder(
          row.artwork_path,
          artworkDir(podcastId),
        );
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error")
          return reply.status(404).send({ error: "Not found" });
        reply.status(result.statusCode as 200 | 206 | 416);
        (
          Object.entries(result.headers as Record<string, string>) as [
            string,
            string,
          ][]
        ).forEach(([k, v]) => v !== undefined && reply.header(k, v));
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.get(
    "/public/podcasts/:podcastSlug/private/:token/episodes/:episodeIdOrSlug/transcript.srt",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode transcript (token)",
        description:
          "Returns transcript SRT when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeIdOrSlug: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeIdOrSlug"],
        },
        response: {
          200: { description: "SRT" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, episodeIdOrSlug } = request.params as {
        podcastSlug: string;
        token: string;
        episodeIdOrSlug: string;
      };
      const resolved = resolvePodcastAndToken(
        request,
        podcastSlug,
        token,
        reply,
      );
      if (!resolved) return;
      const { podcastId } = resolved;
      const row = db
        .prepare(
          `SELECT id FROM episodes WHERE podcast_id = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))
         AND (id = ? OR slug = ?)`,
        )
        .get(podcastId, episodeIdOrSlug, episodeIdOrSlug) as
        | { id: string }
        | undefined;
      if (!row) return reply.status(404).send({ error: "Not found" });
      const srtPath = transcriptSrtPath(podcastId, row.id);
      if (!existsSync(srtPath))
        return reply.status(404).send({ error: "Not found" });
      try {
        assertPathUnder(srtPath, processedDir(podcastId, row.id));
      } catch {
        return reply.status(404).send({ error: "Not found" });
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
    "/public/podcasts/:podcastSlug/private/:token/episodes/:episodeSlug/waveform",
    {
      schema: {
        tags: ["Public"],
        summary: "Get episode waveform (token)",
        description:
          "Returns waveform JSON when valid subscriber token provided. 404 if invalid.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeSlug: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeSlug"],
        },
        response: {
          200: { description: "Waveform JSON" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token, episodeSlug } = request.params as {
        podcastSlug: string;
        token: string;
        episodeSlug: string;
      };
      const resolved = resolvePodcastAndToken(
        request,
        podcastSlug,
        token,
        reply,
      );
      if (!resolved) return;
      const { podcastId } = resolved;

      const row = db
        .prepare(
          `SELECT id, audio_final_path FROM episodes WHERE podcast_id = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))
         AND slug = ?`,
        )
        .get(podcastId, episodeSlug) as
        | { id: string; audio_final_path: string | null }
        | undefined;

      if (!row || !row.audio_final_path || !existsSync(row.audio_final_path)) {
        return reply.status(404).send({ error: "Waveform not found" });
      }

      const waveformPath = row.audio_final_path.replace(
        /\.[^.]+$/,
        WAVEFORM_EXTENSION,
      );
      if (!existsSync(waveformPath)) {
        return reply.status(404).send({ error: "Waveform not found" });
      }

      try {
        assertPathUnder(waveformPath, processedDir(podcastId, row.id));
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
    "/public/podcasts/:podcastSlug/private/:token/episodes/:episodeId",
    {
      schema: {
        tags: ["Public"],
        summary: "Stream episode audio (token)",
        description:
          "Returns episode audio when valid subscriber token provided. 404 if invalid. Supports Range.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastSlug", "token", "episodeId"],
        },
        response: {
          200: { description: "Audio" },
          206: { description: "Partial" },
          404: { description: "Not found" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const {
        podcastSlug,
        token,
        episodeId: rawEpisodeId,
      } = request.params as {
        podcastSlug: string;
        token: string;
        episodeId: string;
      };
      const episodeId =
        rawEpisodeId.replace(/\.[a-zA-Z0-9]+$/, "") || rawEpisodeId;
      const resolved = resolvePodcastAndToken(
        request,
        podcastSlug,
        token,
        reply,
      );
      if (!resolved) return;
      const { podcastId } = resolved;
      const episode = db
        .prepare(
          `SELECT id, audio_final_path, audio_mime FROM episodes
         WHERE podcast_id = ? AND id = ? AND status = 'published'
         AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`,
        )
        .get(podcastId, episodeId) as
        | {
            id: string;
            audio_final_path: string | null;
            audio_mime: string | null;
          }
        | undefined;
      if (!episode?.audio_final_path || !existsSync(episode.audio_final_path))
        return reply.status(404).send({ error: "Not found" });
      try {
        const safePath = assertPathUnder(
          episode.audio_final_path,
          processedDir(podcastId, episodeId),
        );
        const mime = (episode.audio_mime as string) || "audio/mpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          maxAge: 3600,
          acceptRanges: true,
          cacheControl: true,
        });
        if (result.type === "error")
          return reply.status(404).send({ error: "Not found" });
        reply.status(result.statusCode as 200 | 206 | 404 | 500);
        (
          Object.entries(result.headers as Record<string, string>) as [
            string,
            string,
          ][]
        ).forEach(([k, v]) => v !== undefined && reply.header(k, v));
        reply.header("Content-Type", mime);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  // Tokenized (private) RSS feed: requires valid subscriber token (raw token) in path. 404 for invalid/expired.
  app.get(
    "/public/podcasts/:podcastSlug/private/:token/rss",
    {
      schema: {
        tags: ["Public"],
        summary: "Get private RSS feed",
        description:
          "Returns the RSS feed XML for a podcast when valid subscriber token is provided in the path. 404 if token invalid or expired.",
        security: [],
        params: {
          type: "object",
          properties: {
            podcastSlug: { type: "string" },
            token: { type: "string" },
          },
          required: ["podcastSlug", "token"],
        },
        response: {
          200: { description: "RSS XML" },
          404: { description: "Not found" },
          429: { description: "Too many failed attempts (banned)" },
          500: { description: "Failed to generate feed" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { podcastSlug, token } = request.params as {
        podcastSlug: string;
        token: string;
      };
      const podcast = db
        .prepare("SELECT id FROM podcasts WHERE slug = ?")
        .get(podcastSlug) as { id: string } | undefined;
      if (!podcast) return reply.status(404).send({ error: "Not found" });
      const result = validateSubscriberTokenByValueWithExistence(token);
      if (!result.tokenExists) {
        const ip = getClientIp(request);
        console.log(`[ban] Bad/unknown subscriber token attempt from IP=${ip} (GET private rss)`);
        const userAgent = getUserAgent(request);
        recordFailureAndMaybeBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT, {
          userAgent,
        });
        const ban = getIpBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT);
        if (ban.banned) {
          return reply
            .status(429)
            .header("Retry-After", String(ban.retryAfterSec))
            .send({ error: "Too many failed attempts. Try again later." });
        }
        return reply.status(404).send({ error: "Not found" });
      }
      if (!result.row || result.row.podcast_id !== podcast.id)
        return reply.status(404).send({ error: "Not found" });
      try {
        const template = getOrCreateTokenFeedTemplate(
          podcast.id,
          RSS_CACHE_MAX_AGE_MS,
        );
        const xml = template.replaceAll(
          SUBSCRIBER_TOKEN_ID_PLACEHOLDER,
          token,
        );
        touchSubscriberToken(result.row.id);
        return reply
          .header("Content-Type", "application/xml; charset=utf-8")
          .header("Cache-Control", "public, max-age=3600")
          .send(xml);
      } catch (_err) {
        return reply.status(500).send({ error: "Failed to generate feed" });
      }
    },
  );

  // Subscriber authentication endpoints
  const SUBSCRIBER_TOKENS_COOKIE = "subscriber_tokens";
  const COOKIE_SECURE = getCookieSecureFlag();
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

  // Set subscriber token cookie
  app.post(
    "/public/subscriber-auth",
    {
      schema: {
        tags: ["Public"],
        summary: "Authenticate subscriber",
        description:
          "Validates subscriber token and sets httpOnly cookie. Returns error if invalid.",
        security: [],
        body: {
          type: "object",
          properties: {
            token: { type: "string" },
            podcastSlug: { type: "string" },
          },
          required: ["token", "podcastSlug"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              podcastSlug: { type: "string" },
            },
          },
          400: { description: "Invalid request" },
          404: { description: "Invalid token" },
          429: { description: "Too many failed attempts (banned)" },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;
      const { token, podcastSlug } = request.body as {
        token: string;
        podcastSlug: string;
      };

      if (!token?.trim() || !podcastSlug?.trim()) {
        return reply
          .status(400)
          .send({ error: "Token and podcastSlug are required" });
      }

      // Find podcast
      const podcast = db
        .prepare("SELECT id FROM podcasts WHERE slug = ?")
        .get(podcastSlug.trim()) as { id: string } | undefined;
      if (!podcast) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      // Validate token (record+ban only when token hash does not exist)
      const tokenResult = validateSubscriberTokenByValueWithExistence(
        token.trim(),
      );
      if (!tokenResult.tokenExists) {
        const ip = getClientIp(request);
        console.log(`[ban] Bad/unknown subscriber token attempt from IP=${ip} (POST subscriber-auth)`);
        const userAgent = getUserAgent(request);
        recordFailureAndMaybeBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT, {
          userAgent,
        });
        const ban = getIpBan(ip, AUTH_SUBSCRIBER_TOKEN_CONTEXT);
        if (ban.banned) {
          return reply
            .status(429)
            .header("Retry-After", String(ban.retryAfterSec))
            .send({ error: "Too many failed attempts. Try again later." });
        }
        return reply.status(404).send({ error: "Invalid or expired token" });
      }
      if (!tokenResult.row || tokenResult.row.podcast_id !== podcast.id) {
        return reply.status(404).send({ error: "Invalid or expired token" });
      }
      const tokenRow = tokenResult.row;

      // Read existing cookie
      const existingCookie = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
      let tokenMap: Record<string, string> = {};
      if (existingCookie) {
        try {
          tokenMap = JSON.parse(existingCookie);
          if (typeof tokenMap !== "object" || Array.isArray(tokenMap)) {
            tokenMap = {};
          }
        } catch {
          tokenMap = {};
        }
      }

      // Add/update token for this podcast (store raw token so private URLs use it)
      tokenMap[podcastSlug.trim()] = token.trim();

      // Set cookie
      reply.setCookie(SUBSCRIBER_TOKENS_COOKIE, JSON.stringify(tokenMap), {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });

      touchSubscriberToken(tokenRow.id);
      return { success: true, podcastSlug: podcastSlug.trim() };
    },
  );

  // Check authentication status
  app.get(
    "/public/subscriber-auth/status",
    {
      schema: {
        tags: ["Public"],
        summary: "Get authentication status",
        description:
          "Returns list of authenticated podcast slugs and tokens (for building private URLs). Cleans up invalid tokens.",
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              authenticated: { type: "boolean" },
              podcastSlugs: { type: "array", items: { type: "string" } },
              tokens: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;

      const existingCookie = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
      if (!existingCookie) {
        return { authenticated: false, podcastSlugs: [] };
      }

      let tokenMap: Record<string, string> = {};
      try {
        tokenMap = JSON.parse(existingCookie);
        if (typeof tokenMap !== "object" || Array.isArray(tokenMap)) {
          tokenMap = {};
        }
      } catch {
        tokenMap = {};
      }

      // Validate each token and clean up invalid ones
      const validPodcastSlugs: string[] = [];
      const cleanedTokenMap: Record<string, string> = {};

      for (const [slug, token] of Object.entries(tokenMap)) {
        const podcast = db
          .prepare("SELECT id FROM podcasts WHERE slug = ?")
          .get(slug) as { id: string } | undefined;
        if (podcast) {
          const tokenRow = validateSubscriberTokenByValue(token);
          if (tokenRow && tokenRow.podcast_id === podcast.id) {
            validPodcastSlugs.push(slug);
            cleanedTokenMap[slug] = token;
          }
        }
      }

      // Update cookie with cleaned mapping
      if (Object.keys(cleanedTokenMap).length > 0) {
        reply.setCookie(
          SUBSCRIBER_TOKENS_COOKIE,
          JSON.stringify(cleanedTokenMap),
          {
            httpOnly: true,
            secure: COOKIE_SECURE,
            sameSite: "lax",
            path: "/",
            maxAge: COOKIE_MAX_AGE,
          },
        );
      } else {
        // Clear cookie if no valid tokens remain
        reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
      }

      return {
        authenticated: validPodcastSlugs.length > 0,
        podcastSlugs: validPodcastSlugs,
        tokens: cleanedTokenMap,
      };
    },
  );

  // Clear subscriber token cookie
  app.delete(
    "/public/subscriber-auth",
    {
      schema: {
        tags: ["Public"],
        summary: "Logout subscriber",
        description:
          "Clears subscriber token cookie. Optional podcastSlug query param to remove specific podcast only.",
        security: [],
        querystring: {
          type: "object",
          properties: { podcastSlug: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { success: { type: "boolean" } } },
        },
      },
    },
    async (request, reply) => {
      if (!ensurePublicFeedsEnabled(reply)) return;

      const { podcastSlug } = request.query as { podcastSlug?: string };

      if (podcastSlug?.trim()) {
        // Remove specific podcast from cookie
        const existingCookie = request.cookies[SUBSCRIBER_TOKENS_COOKIE];
        if (existingCookie) {
          try {
            const tokenMap = JSON.parse(existingCookie);
            if (typeof tokenMap === "object" && !Array.isArray(tokenMap)) {
              delete tokenMap[podcastSlug.trim()];

              if (Object.keys(tokenMap).length > 0) {
                reply.setCookie(
                  SUBSCRIBER_TOKENS_COOKIE,
                  JSON.stringify(tokenMap),
                  {
                    httpOnly: true,
                    secure: COOKIE_SECURE,
                    sameSite: "lax",
                    path: "/",
                    maxAge: COOKIE_MAX_AGE,
                  },
                );
              } else {
                reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
              }
            }
          } catch {
            // Invalid cookie, clear it
            reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
          }
        }
      } else {
        // Clear entire cookie
        reply.clearCookie(SUBSCRIBER_TOKENS_COOKIE, { path: "/" });
      }

      return { success: true };
    },
  );
}
