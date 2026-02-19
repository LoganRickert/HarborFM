import type { FastifyInstance } from "fastify";
import { publicPodcastsListQuerySchema } from "@harborfm/shared";
import { getExportPathPrefix } from "../../services/export-config.js";
import { getCanonicalFeedUrl } from "../../services/dns/custom-domain-resolver.js";
import { readSettings } from "../settings/index.js";
import { RSS_FEED_FILENAME } from "../../config.js";
import { ensurePublicFeedsEnabled, likeEscape, publicCastDto, publicPodcastDto } from "./utils.js";
import * as repo from "./repo.js";

export async function registerPodcastsRoutes(app: FastifyInstance) {
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
      const searchPattern = searchQ ? `%${likeEscape(searchQ)}%` : null;

      const { rows, total } = repo.listPublicPodcasts({
        limit,
        offset,
        searchPattern,
        sortNewestFirst,
      });

      readSettings(); // ensure settings loaded if needed by getExportWithPublicBaseUrl
      const podcastsList = rows.map((row) => {
        const dto = publicPodcastDto(row) as Record<string, unknown>;
        dto.created_at = row.createdAt;
        const exportRow = repo.getExportWithPublicBaseUrl(row.id);
        if (exportRow?.publicBaseUrl) {
          const base = String(exportRow.publicBaseUrl)
            .trim()
            .replace(/\/$/, "");
          const prefix = getExportPathPrefix(exportRow) ?? "";
          dto.rss_url = prefix
            ? `${base}/${prefix}/${RSS_FEED_FILENAME}`
            : `${base}/${RSS_FEED_FILENAME}`;
        }
        return dto;
      });

      return reply.send({ podcasts: podcastsList, total, limit, offset });
    },
  );

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
      const row = repo.getPodcastBySlug(slug);
      if (!row) return reply.status(404).send({ error: "Podcast not found" });
      const publicFeedDisabled = row.publicFeedDisabled === 1;
      const subscriberOnlyFeedEnabled = row.subscriberOnlyFeedEnabled === 1;
      if (publicFeedDisabled && !subscriberOnlyFeedEnabled)
        return reply.status(404).send({ error: "Podcast not found" });
      const dto = publicPodcastDto(row) as Record<string, unknown>;
      const settings = readSettings();
      const canonicalUrl = getCanonicalFeedUrl(
        {
          linkDomain: row.linkDomain != null ? String(row.linkDomain) : null,
          managedDomain: row.managedDomain != null ? String(row.managedDomain) : null,
          managedSubDomain: row.managedSubDomain != null ? String(row.managedSubDomain) : null,
        },
        settings,
      );
      if (canonicalUrl) dto.canonical_feed_url = canonicalUrl;
      const exportRow = repo.getExportWithPublicBaseUrl(row.id);
      if (exportRow?.publicBaseUrl) {
        const base = String(exportRow.publicBaseUrl)
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

      const podcastId = repo.getPodcastIdBySlugUnlistedFalse(podcastSlug);
      if (!podcastId) {
        return reply.status(404).send({ error: "Podcast not found" });
      }

      const hosts = repo.getPodcastCastHosts(podcastId);
      const { rows: guests, total: guestsTotal } = repo.getPodcastCastGuests(
        podcastId,
        limit,
        offset,
      );
      const guestsHasMore = offset + guests.length < guestsTotal;

      return {
        hosts: hosts.map((r) => publicCastDto(r, podcastId)),
        guests: guests.map((r) => publicCastDto(r, podcastId)),
        guests_total: guestsTotal,
        guests_has_more: guestsHasMore,
      };
    },
  );
}
