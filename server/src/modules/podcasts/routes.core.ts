import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";
import { existsSync, unlinkSync } from "fs";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  requireAdmin,
  requireAuth,
  requireNotReadOnly,
} from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import {
  episodes,
  podcastStatsEpisodeDaily,
  podcastStatsEpisodeListensDaily,
  podcastStatsEpisodeLocationDaily,
  podcastStatsRssDaily,
  podcasts,
  users,
} from "../../db/schema.js";
import { isUniqueViolation, sqlNow } from "../../db/utils.js";
import {
  isAdmin,
  getPodcastRole,
  canAccessPodcast,
  canEditEpisodeOrPodcastMetadata,
  canManageCollaborators,
  canEditDnsSettings,
} from "../../services/access.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { RECORD_MIN_FREE_BYTES, DNS_SECRETS_AAD } from "../../config.js";
import {
  podcastAnalyticsQuerySchema,
  podcastCreateSchema,
  podcastUpdateSchema,
  podcastsListQuerySchema,
} from "@harborfm/shared";
import { assertPathUnder, assertSafeId, artworkDir, resolveDataPath } from "../../services/paths.js";
import { readSettings } from "../settings/index.js";
import { encryptSecret } from "../../services/secrets.js";
import { getCanonicalFeedUrl } from "../../services/dns/custom-domain-resolver.js";
import { runDnsUpdateTask } from "../../services/dns/update-task.js";
import { podcastRowWithFilename } from "./utils.js";
import * as repo from "./repo.js";
import * as service from "./service.js";
import { lastNLocalDateRange } from "../../utils/datetime.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  // GET /podcasts - list
  app.get(
    "/podcasts",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "List podcasts",
        description:
          "List shows owned by or shared with the current user. Optional limit/offset for pagination, search query, and sort order.",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
            q: { type: "string" },
            sort: { type: "string", enum: ["newest", "oldest"] },
          },
        },
        response: { 200: { description: "List of podcasts and total count" } },
      },
    },
    async (request) => {
      const userId = request.userId as string;
      const query = podcastsListQuerySchema.parse(request.query);
      const limit = query.limit;
      const offset = Math.max(0, query.offset ?? 0);
      const searchQuery = query.q?.trim() || "";
      const sortOrder = query.sort === "oldest" ? "oldest" : "newest";
      const owned = repo.listOwned(userId);
      const shared = repo.listShared(userId);
      const ownedIds = new Set(owned.map((r) => r.id as string));
      let combined = [
        ...owned.map((r) => ({
          ...podcastRowWithFilename(r),
          myRole: "owner" as const,
          isShared: false,
        })),
        ...shared
          .filter((r) => !ownedIds.has(r.id as string))
          .map((r) => {
            const shareRole = repo.getShareRole(r.id as string, userId);
            return {
              ...podcastRowWithFilename(r),
              myRole: shareRole ?? "view",
              isShared: true,
            };
          }),
      ];
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        combined = combined.filter((p) => {
          const title = ((p.title as string) || "").toLowerCase();
          const description = ((p.description as string) || "").toLowerCase();
          const author = ((p.authorName as string) || "").toLowerCase();
          return (
            title.includes(lowerQuery) ||
            description.includes(lowerQuery) ||
            author.includes(lowerQuery)
          );
        });
      }
      combined.sort((a, b) => {
          const aTime = new Date((a.createdAt as string) ?? 0).getTime();
          const bTime = new Date((b.createdAt as string) ?? 0).getTime();
          return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
        },
      );
      const total = combined.length;
      const podcasts =
        limit != null ? combined.slice(offset, offset + limit) : combined;
      return { podcasts, total };
    },
  );

  // GET /podcasts/user/:userId - list by user (admin)
  app.get(
    "/podcasts/user/:userId",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Podcasts"],
        summary: "List podcasts by user (admin)",
        description:
          "List shows for a given user. Admin only. Optional limit/offset for pagination, search query, and sort order.",
        params: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
            q: { type: "string" },
            sort: { type: "string", enum: ["newest", "oldest"] },
          },
        },
        response: {
          200: { description: "List of podcasts and total count" },
          400: { description: "Invalid userId" },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      try {
        assertSafeId(userId, "userId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid userId" });
      }
      const query = request.query as
        | { limit?: number; offset?: number; q?: string; sort?: string }
        | undefined;
      const limit = query?.limit;
      const offset = Math.max(0, query?.offset ?? 0);
      const searchQuery = query?.q?.trim() || "";
      const sortOrder = query?.sort === "oldest" ? "oldest" : "newest";
      const sortDir = sortOrder === "newest" ? "DESC" : "ASC";
      let rows = repo.listByOwnerUserId(userId, sortDir);
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        rows = rows.filter((p) => {
          const title = ((p.title as string) || "").toLowerCase();
          const description = ((p.description as string) || "").toLowerCase();
          const author = ((p.authorName as string) || "").toLowerCase();
          return (
            title.includes(lowerQuery) ||
            description.includes(lowerQuery) ||
            author.includes(lowerQuery)
          );
        });
      }
      const total = rows.length;
      const limitVal = limit ?? Math.max(1, total - offset);
      const paginated = rows.slice(offset, offset + limitVal);
      const podcasts = paginated.map(podcastRowWithFilename);
      return { podcasts, total };
    },
  );

  // POST /podcasts - create
  app.post(
    "/podcasts",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Create podcast",
        description: "Create a new show. Requires read-write access.",
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            slug: { type: "string" },
            description: { type: "string" },
          },
          required: ["title", "slug"],
        },
        response: {
          201: { description: "Created podcast" },
          400: { description: "Validation failed" },
          403: { description: "At limit or read-only" },
          409: { description: "Slug taken" },
          500: { description: "Internal error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = podcastCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const userId = request.userId as string;
      const userRow = drizzleDb
        .select({ maxPodcasts: users.maxPodcasts })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .get();
      const maxPodcasts = userRow?.maxPodcasts ?? null;
      if (maxPodcasts != null && maxPodcasts > 0) {
        const countRow = drizzleDb
          .select({ count: sql<number>`COUNT(*)`.as("count") })
          .from(podcasts)
          .where(eq(podcasts.ownerUserId, userId))
          .get();
        const count = countRow?.count ?? 0;
        if (count >= maxPodcasts) {
          return reply.status(403).send({
            error: `You have reached your limit of ${maxPodcasts} show${maxPodcasts === 1 ? "" : "s"}. You cannot create more.`,
          });
        }
      }
      const id = nanoid();
      request.log.info({ id, userId }, "Podcast create: id and userId");
      const data = parsed.data;
      const existingSlug = drizzleDb
        .select({ id: podcasts.id })
        .from(podcasts)
        .where(eq(podcasts.slug, data.slug))
        .limit(1)
        .get();
      if (existingSlug) {
        return reply
          .status(409)
          .send({
            error: "This slug is already taken. Please choose a different one.",
          });
      }
      const podcastGuid = data.podcastGuid ?? randomUUID();
      try {
        drizzleDb
          .insert(podcasts)
          .values({
            id,
            ownerUserId: request.userId,
            title: data.title,
            slug: data.slug,
            description: data.description ?? "",
            subtitle: data.subtitle ?? null,
            summary: data.summary ?? null,
            language: data.language ?? "en",
            authorName: data.authorName ?? "",
            ownerName: data.ownerName ?? "",
            email: data.email ?? "",
            categoryPrimary: data.categoryPrimary ?? "",
            categorySecondary: data.categorySecondary ?? null,
            categoryPrimaryTwo: data.categoryPrimaryTwo ?? null,
            categorySecondaryTwo: data.categorySecondaryTwo ?? null,
            categoryPrimaryThree: data.categoryPrimaryThree ?? null,
            categorySecondaryThree: data.categorySecondaryThree ?? null,
            explicit: (data.explicit ?? 0) !== 0,
            siteUrl: data.siteUrl ?? null,
            artworkUrl: data.artworkUrl ?? null,
            copyright: data.copyright ?? null,
            podcastGuid,
            locked: (data.locked ?? 0) !== 0,
            license: data.license ?? null,
            itunesType: data.itunesType ?? "episodic",
            medium: data.medium ?? "podcast",
            fundingUrl: data.fundingUrl ?? null,
            fundingLabel: data.fundingLabel ?? null,
            persons: data.persons ?? null,
            updateFrequencyRrule: data.updateFrequencyRrule ?? null,
            updateFrequencyLabel: data.updateFrequencyLabel ?? null,
            spotifyRecentCount: data.spotifyRecentCount ?? null,
            spotifyCountryOfOrigin: data.spotifyCountryOfOrigin ?? null,
            applePodcastsVerify: data.applePodcastsVerify ?? null,
            maxEpisodes: null,
          })
          .run();
      } catch (e) {
        if (isUniqueViolation(e)) {
          return reply
            .status(409)
            .send({ error: "Slug already used for your account" });
        }
        throw e;
      }
      request.log.info({ id }, "Podcast insert done");
      service.afterCreatePodcast(id, data, userId, request.log);
      request.log.info({ id }, "Podcast create: fetching created");
      const created = repo.getByIdWithFilename(id) ?? repo.getByIdWithFilenameForCreate(id);
      if (!created) {
        request.log.error(
          { id, userId },
          "Failed to fetch created podcast: getByIdWithFilename and getByIdWithFilenameForCreate both returned undefined",
        );
        return reply.status(500).send({ error: "Failed to fetch created podcast" });
      }
      const out = { ...created };
      delete (out as Record<string, unknown>).cloudflareApiKeyEnc;
      (out as Record<string, unknown>).cloudflareApiKeySet = Boolean(
        created.cloudflareApiKeyEnc && String(created.cloudflareApiKeyEnc).trim().length > 0,
      );
      return reply.status(201).send(out);
    },
  );

  // GET /podcasts/:id
  app.get(
    "/podcasts/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get podcast",
        description: "Get a show by ID. Must have access (owner or shared).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Podcast" },
          400: { description: "Invalid id" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const { userId } = request;
      if (getPodcastRole(userId, id) === null) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Podcast not found" });
      const role = getPodcastRole(userId, id);
      const isShared = role !== "owner";
      const ownerId = row.ownerUserId as string;
      const canRecordNewSection = ownerId
        ? !wouldExceedStorageLimit(drizzleDb, ownerId, RECORD_MIN_FREE_BYTES)
        : true;
      const podcastMaxCollab = row.maxCollaborators as number | null | undefined;
      const ownerRow = ownerId
        ? drizzleDb
            .select({
              maxCollaborators: users.maxCollaborators,
              maxSubscriberTokens: users.maxSubscriberTokens,
              canTranscribe: sql<number>`COALESCE(${users.canTranscribe}, 0)`.as("canTranscribe"),
            })
            .from(users)
            .where(eq(users.id, ownerId))
            .limit(1)
            .get()
        : null;
      const ownerMaxCollab = ownerRow?.maxCollaborators ?? null;
      const effectiveMaxCollaborators =
        podcastMaxCollab ?? ownerMaxCollab ?? null;
      const podcastMaxSubscriberTokens = row.maxSubscriberTokens as
        | number
        | null
        | undefined;
      const ownerMaxSubscriberTokens = ownerRow?.maxSubscriberTokens ?? null;
      const settings = readSettings();
      const effectiveMaxSubscriberTokens =
        podcastMaxSubscriberTokens ??
        ownerMaxSubscriberTokens ??
        settings.default_max_subscriber_tokens ??
        null;
      const ownerCanTranscribe = ownerRow?.canTranscribe ?? 0;
      const out = { ...podcastRowWithFilename(row) };
      delete (out as Record<string, unknown>).cloudflareApiKeyEnc;
      (out as Record<string, unknown>).cloudflareApiKeySet = Boolean(
        row.cloudflareApiKeyEnc &&
          String(row.cloudflareApiKeyEnc).trim().length > 0,
      );
      let allowDomains: string[] = [];
      try {
        const raw = settings.dns_default_allow_domains ?? "[]";
        const parsed = JSON.parse(raw) as unknown;
        allowDomains = Array.isArray(parsed)
          ? parsed.filter((s): s is string => typeof s === "string")
          : [];
      } catch {
        // ignore
      }
      (out as Record<string, unknown>).dnsConfig = {
        allowLinkingDomain: settings.dns_allow_linking_domain ?? false,
        allowDomain: settings.dns_default_allow_domain ?? false,
        allowDomains,
        defaultDomain: settings.dns_default_domain ?? "",
        allowSubDomain: settings.dns_default_allow_sub_domain ?? false,
        allowCustomKey: settings.dns_default_allow_custom_key ?? false,
      };
      const canonicalUrl = getCanonicalFeedUrl(row, settings);
      if (canonicalUrl) (out as Record<string, unknown>).canonicalFeedUrl = canonicalUrl;
      return {
        ...out,
        myRole: role ?? "view",
        isShared,
        canRecordNewSection,
        effectiveMaxCollaborators,
        effectiveMaxSubscriberTokens,
        ownerCanTranscribe,
      };
    },
  );

  // GET /podcasts/:id/analytics
  app.get(
    "/podcasts/:id/analytics",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get podcast analytics",
        description:
          "Returns listen and episode analytics for a show. Optional startDate, endDate (YYYY-MM-DD in the server local timezone), limit, and offset filter and paginate daily stats. When both dates are omitted, defaults to the last 14 local calendar days including today.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: {
            startDate: { type: "string", description: "YYYY-MM-DD" },
            endDate: { type: "string", description: "YYYY-MM-DD" },
            limit: { type: "integer", minimum: 1 },
            offset: { type: "integer", minimum: 0 },
          },
        },
        response: {
          200: { description: "Analytics data" },
          400: { description: "Invalid query params" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      try {
        assertSafeId(podcastId, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const queryParsed = podcastAnalyticsQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply
          .status(400)
          .send({
            error: "Invalid query params",
            details: queryParsed.error.flatten(),
          });
      }
      const query = queryParsed.data;
      let startDate = query.startDate;
      let endDate = query.endDate;
      const limit = query.limit;
      const offset = query.offset ?? 0;

      if (startDate === undefined && endDate === undefined) {
        const range = lastNLocalDateRange(14);
        startDate = range.startDate;
        endDate = range.endDate;
      }

      if (startDate !== undefined && endDate !== undefined && startDate > endDate) {
        return reply.status(400).send({ error: "startDate must be <= endDate" });
      }
      if (limit !== undefined && (limit < 1 || !Number.isInteger(limit))) {
        return reply.status(400).send({ error: "Invalid limit" });
      }
      if (offset !== undefined && (offset < 0 || !Number.isInteger(offset))) {
        return reply.status(400).send({ error: "Invalid offset" });
      }

      const { userId } = request;
      if (!canAccessPodcast(userId, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const podcast = drizzleDb
        .select({
          id: podcasts.id,
          ownerReadOnly: sql<number>`COALESCE(${users.readOnly}, 0)`.as("ownerReadOnly"),
        })
        .from(podcasts)
        .innerJoin(users, eq(users.id, podcasts.ownerUserId))
        .where(eq(podcasts.id, podcastId))
        .limit(1)
        .get();
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });

      const rssConditions = [eq(podcastStatsRssDaily.podcastId, podcastId)];
      if (startDate !== undefined && endDate !== undefined) {
        rssConditions.push(
          gte(podcastStatsRssDaily.statDate, startDate),
          lte(podcastStatsRssDaily.statDate, endDate),
        );
      }
      let rssQuery = drizzleDb
        .select({
          stat_date: podcastStatsRssDaily.statDate,
          source: podcastStatsRssDaily.source,
          bot_count: podcastStatsRssDaily.botCount,
          human_count: podcastStatsRssDaily.humanCount,
        })
        .from(podcastStatsRssDaily)
        .where(and(...rssConditions))
        .orderBy(desc(podcastStatsRssDaily.statDate));
      if (limit !== undefined) {
        rssQuery = rssQuery.limit(limit).offset(offset) as typeof rssQuery;
      }
      const rss_daily = rssQuery.all();

      const episodeList = drizzleDb
        .select({
          id: episodes.id,
          title: episodes.title,
          slug: episodes.slug,
        })
        .from(episodes)
        .where(eq(episodes.podcastId, podcastId))
        .orderBy(desc(sql`COALESCE(${episodes.publishAt}, ${episodes.updatedAt})`))
        .all();
      const episodeIds = episodeList.map((e: { id: string }) => e.id);

      const epConditions =
        episodeIds.length > 0
          ? [
              inArray(podcastStatsEpisodeDaily.episodeId, episodeIds),
              ...(startDate !== undefined && endDate !== undefined
                ? [
                    gte(podcastStatsEpisodeDaily.statDate, startDate),
                    lte(podcastStatsEpisodeDaily.statDate, endDate),
                  ]
                : []),
            ]
          : [];
      const episode_daily: Array<{
        episode_id: string;
        stat_date: string;
        source: string;
        bot_count: number;
        human_count: number;
      }> = [];
      const episode_location_daily: Array<{
        episode_id: string;
        stat_date: string;
        location: string;
        source: string;
        bot_count: number;
        human_count: number;
      }> = [];
      const episode_listens_daily: Array<{
        episode_id: string;
        stat_date: string;
        source: string;
        bot_count: number;
        human_count: number;
      }> = [];
      if (episodeIds.length > 0) {
        const epWhere = and(...epConditions);
        const epOrder = desc(podcastStatsEpisodeDaily.statDate);
        let episodeDailyQuery = drizzleDb
          .select({
            episode_id: podcastStatsEpisodeDaily.episodeId,
            stat_date: podcastStatsEpisodeDaily.statDate,
            source: podcastStatsEpisodeDaily.source,
            bot_count: podcastStatsEpisodeDaily.botCount,
            human_count: podcastStatsEpisodeDaily.humanCount,
          })
          .from(podcastStatsEpisodeDaily)
          .where(epWhere)
          .orderBy(epOrder, podcastStatsEpisodeDaily.episodeId);
        if (limit !== undefined) {
          episodeDailyQuery = episodeDailyQuery.limit(limit).offset(offset) as typeof episodeDailyQuery;
        }
        episode_daily.push(...episodeDailyQuery.all());

        const locConditions = [
          inArray(podcastStatsEpisodeLocationDaily.episodeId, episodeIds),
          ...(startDate !== undefined && endDate !== undefined
            ? [
                gte(podcastStatsEpisodeLocationDaily.statDate, startDate),
                lte(podcastStatsEpisodeLocationDaily.statDate, endDate),
              ]
            : []),
        ];
        let locQuery = drizzleDb
          .select({
            episode_id: podcastStatsEpisodeLocationDaily.episodeId,
            stat_date: podcastStatsEpisodeLocationDaily.statDate,
            location: podcastStatsEpisodeLocationDaily.location,
            source: podcastStatsEpisodeLocationDaily.source,
            bot_count: podcastStatsEpisodeLocationDaily.botCount,
            human_count: podcastStatsEpisodeLocationDaily.humanCount,
          })
          .from(podcastStatsEpisodeLocationDaily)
          .where(and(...locConditions))
          .orderBy(
            desc(podcastStatsEpisodeLocationDaily.statDate),
            podcastStatsEpisodeLocationDaily.episodeId,
            podcastStatsEpisodeLocationDaily.location,
          );
        if (limit !== undefined) {
          locQuery = locQuery.limit(limit).offset(offset) as typeof locQuery;
        }
        episode_location_daily.push(...locQuery.all());

        const listensConditions = [
          inArray(podcastStatsEpisodeListensDaily.episodeId, episodeIds),
          ...(startDate !== undefined && endDate !== undefined
            ? [
                gte(podcastStatsEpisodeListensDaily.statDate, startDate),
                lte(podcastStatsEpisodeListensDaily.statDate, endDate),
              ]
            : []),
        ];
        let listensQuery = drizzleDb
          .select({
            episode_id: podcastStatsEpisodeListensDaily.episodeId,
            stat_date: podcastStatsEpisodeListensDaily.statDate,
            source: podcastStatsEpisodeListensDaily.source,
            bot_count: podcastStatsEpisodeListensDaily.botCount,
            human_count: podcastStatsEpisodeListensDaily.humanCount,
          })
          .from(podcastStatsEpisodeListensDaily)
          .where(and(...listensConditions))
          .orderBy(
            desc(podcastStatsEpisodeListensDaily.statDate),
            podcastStatsEpisodeListensDaily.episodeId,
            podcastStatsEpisodeListensDaily.source,
          );
        if (limit !== undefined) {
          listensQuery = listensQuery.limit(limit).offset(offset) as typeof listensQuery;
        }
        episode_listens_daily.push(...listensQuery.all());
      }
      if (podcast.ownerReadOnly === 1 && episode_location_daily.length > 0) {
        const distinctLocations = [
          ...new Set(episode_location_daily.map((r) => r.location)),
        ].sort();
        const locationToRedacted = new Map<string, string>();
        distinctLocations.forEach((loc, i) =>
          locationToRedacted.set(loc, `Location ${i + 1}`),
        );
        for (const row of episode_location_daily) {
          row.location = locationToRedacted.get(row.location) ?? row.location;
        }
      }
      return {
        rss_daily,
        episodes: episodeList,
        episode_daily,
        episode_location_daily,
        episode_listens_daily,
      };
    },
  );

  // PATCH /podcasts/:id
  app.patch(
    "/podcasts/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Podcasts"],
        summary: "Update podcast",
        description: "Update show metadata. Requires manager or owner.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            slug: { type: "string" },
            description: { type: "string" },
          },
        },
        response: {
          200: { description: "Updated podcast" },
          400: { description: "Validation failed" },
          403: { description: "Only admins can edit slugs" },
          404: { description: "Not found" },
          409: { description: "Slug taken" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const parsed = podcastUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const role = getPodcastRole(request.userId, id);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const data = parsed.data;
      const hasDnsFields =
        data.linkDomain !== undefined ||
        data.managedDomain !== undefined ||
        data.managedSubDomain !== undefined ||
        data.cloudflareApiKey !== undefined;
      if (hasDnsFields && !canEditDnsSettings(request.userId, id)) {
        return reply.status(403).send({
          error: "Only the show owner or an administrator can edit DNS settings.",
        });
      }
      const currentPodcast = repo.getSlug(id);
      if (currentPodcast === undefined)
        return reply.status(404).send({ error: "Podcast not found" });
      const currentRow = drizzleDb
        .select({
          unlisted: podcasts.unlisted,
          categoryPrimary: podcasts.categoryPrimary,
          categoryPrimaryTwo: podcasts.categoryPrimaryTwo,
          categoryPrimaryThree: podcasts.categoryPrimaryThree,
          artworkPath: podcasts.artworkPath,
        })
        .from(podcasts)
        .where(eq(podcasts.id, id))
        .limit(1)
        .get();
      let oldArtworkPath: string | null = null;
      const set: Record<string, unknown> = {};

      if (data.title !== undefined) set.title = data.title;
      if (data.slug !== undefined) {
        if (data.slug !== currentPodcast) {
          const isUnlisted = Boolean(currentRow?.unlisted);
          const slugRole = getPodcastRole(request.userId, id);
          const canEditSlug =
            isAdmin(request.userId) ||
            (isUnlisted && canManageCollaborators(slugRole));
          if (!canEditSlug) {
            return reply
              .status(403)
              .send({
                error:
                  "Only administrators can edit slugs, or owner/manager when the show is unlisted.",
              });
          }
        }
        if (data.slug !== currentPodcast) {
          const existingSlug = drizzleDb
            .select({ id: podcasts.id })
            .from(podcasts)
            .where(eq(podcasts.slug, data.slug))
            .limit(1)
            .get();
          const conflict = existingSlug && existingSlug.id !== id;
          if (conflict) {
            return reply
              .status(409)
              .send({
                error:
                  "This slug is already taken. Please choose a different one.",
              });
          }
          set.slug = data.slug;
        }
      }
      if (data.description !== undefined) set.description = data.description;
      if (data.subtitle !== undefined) set.subtitle = data.subtitle;
      if (data.summary !== undefined) set.summary = data.summary;
      if (data.language !== undefined) set.language = data.language;
      if (data.authorName !== undefined) set.authorName = data.authorName;
      if (data.ownerName !== undefined) set.ownerName = data.ownerName;
      if (data.email !== undefined) set.email = data.email;
      if (data.categoryPrimary !== undefined) set.categoryPrimary = data.categoryPrimary;
      if (data.categorySecondary !== undefined) {
        const primary =
          data.categoryPrimary ?? currentRow?.categoryPrimary ?? null;
        set.categorySecondary =
          primary && String(primary).trim() ? data.categorySecondary : null;
      }
      if (data.explicit !== undefined) set.explicit = data.explicit !== 0;
      if (data.siteUrl !== undefined) set.siteUrl = data.siteUrl;
      if (data.artworkUrl !== undefined) {
        set.artworkUrl = data.artworkUrl;
        if (data.artworkUrl && String(data.artworkUrl).trim()) {
          set.artworkPath = null;
          if (currentRow?.artworkPath) oldArtworkPath = currentRow.artworkPath;
        }
      }
      if (data.copyright !== undefined) set.copyright = data.copyright;
      if (data.podcastGuid !== undefined) set.podcastGuid = data.podcastGuid;
      if (data.locked !== undefined) set.locked = data.locked !== 0;
      if (data.license !== undefined) set.license = data.license;
      if (data.itunesType !== undefined) set.itunesType = data.itunesType;
      if (data.medium !== undefined) set.medium = data.medium;
      if (data.maxCollaborators !== undefined) set.maxCollaborators = data.maxCollaborators;
      if (data.unlisted !== undefined) set.unlisted = data.unlisted !== 0;
      if (data.subscriberOnlyFeedEnabled !== undefined) {
        const sofe = data.subscriberOnlyFeedEnabled;
        set.subscriberOnlyFeedEnabled = Boolean(sofe);
        if (!sofe) {
          set.publicFeedDisabled = false;
        }
      }
      if (data.publicFeedDisabled !== undefined) {
        set.publicFeedDisabled = Boolean(data.publicFeedDisabled);
      }
      if (data.allowUnapprovedReviews !== undefined) {
        set.allowUnapprovedReviews = Boolean(data.allowUnapprovedReviews);
      }
      if (data.subscriberOnlyReviews !== undefined) {
        set.subscriberOnlyReviews = Boolean(data.subscriberOnlyReviews);
      }
      if (data.subscriberOnlyMessages !== undefined) {
        set.subscriberOnlyMessages = Boolean(data.subscriberOnlyMessages);
      }
      if (data.showScheduledEpisodes !== undefined) {
        set.showScheduledEpisodes = Boolean(data.showScheduledEpisodes);
      }
      if (data.fundingUrl !== undefined) set.fundingUrl = data.fundingUrl;
      if (data.fundingLabel !== undefined) set.fundingLabel = data.fundingLabel;
      if (data.persons !== undefined) set.persons = data.persons;
      if (data.updateFrequencyRrule !== undefined) set.updateFrequencyRrule = data.updateFrequencyRrule;
      if (data.updateFrequencyLabel !== undefined) set.updateFrequencyLabel = data.updateFrequencyLabel;
      if (data.spotifyRecentCount !== undefined) set.spotifyRecentCount = data.spotifyRecentCount;
      if (data.spotifyCountryOfOrigin !== undefined) set.spotifyCountryOfOrigin = data.spotifyCountryOfOrigin;
      if (data.applePodcastsVerify !== undefined) set.applePodcastsVerify = data.applePodcastsVerify;
      if (data.applePodcastsUrl !== undefined) set.applePodcastsUrl = data.applePodcastsUrl;
      if (data.spotifyUrl !== undefined) set.spotifyUrl = data.spotifyUrl;
      if (data.amazonMusicUrl !== undefined) set.amazonMusicUrl = data.amazonMusicUrl;
      if (data.podcastIndexUrl !== undefined) set.podcastIndexUrl = data.podcastIndexUrl;
      if (data.listenNotesUrl !== undefined) set.listenNotesUrl = data.listenNotesUrl;
      if (data.castboxUrl !== undefined) set.castboxUrl = data.castboxUrl;
      if (data.xUrl !== undefined) set.xUrl = data.xUrl;
      if (data.facebookUrl !== undefined) set.facebookUrl = data.facebookUrl;
      if (data.instagramUrl !== undefined) set.instagramUrl = data.instagramUrl;
      if (data.tiktokUrl !== undefined) set.tiktokUrl = data.tiktokUrl;
      if (data.youtubeUrl !== undefined) set.youtubeUrl = data.youtubeUrl;
      if (data.discordUrl !== undefined) set.discordUrl = data.discordUrl;
      if (data.categoryPrimaryTwo !== undefined) set.categoryPrimaryTwo = data.categoryPrimaryTwo;
      if (data.categorySecondaryTwo !== undefined) {
        const primaryTwo =
          data.categoryPrimaryTwo ?? currentRow?.categoryPrimaryTwo ?? null;
        set.categorySecondaryTwo =
          primaryTwo && String(primaryTwo).trim() ? data.categorySecondaryTwo : null;
      }
      if (data.categoryPrimaryThree !== undefined) set.categoryPrimaryThree = data.categoryPrimaryThree;
      if (data.categorySecondaryThree !== undefined) {
        const primaryThree =
          data.categoryPrimaryThree ?? currentRow?.categoryPrimaryThree ?? null;
        set.categorySecondaryThree =
          primaryThree && String(primaryThree).trim() ? data.categorySecondaryThree : null;
      }
      let dnsFieldsChanged = false;
      if (data.linkDomain !== undefined) {
        const linkVal = data.linkDomain?.trim() || null;
        if (linkVal) {
          const settings = readSettings();
          if (!settings.dns_allow_linking_domain) {
            return reply.status(400).send({
              error:
                "Linking domain is disabled in server settings. Enable it in Settings to DNS & custom domain to set a link domain.",
            });
          }
        }
        set.linkDomain = linkVal;
        dnsFieldsChanged = true;
      }
      if (data.managedDomain !== undefined) {
        const settingsForDomain = readSettings();
        const allowDomain = settingsForDomain.dns_default_allow_domain ?? false;
        const managedDomainValue = allowDomain ? (data.managedDomain?.trim() || null) : null;
        set.managedDomain = managedDomainValue;
        dnsFieldsChanged = true;
      }
      if (data.managedSubDomain !== undefined) {
        const settingsForSub = readSettings();
        const defaultDomain = (settingsForSub.dns_default_domain ?? "").trim();
        const allowSubDomain = (settingsForSub.dns_default_allow_sub_domain ?? false) && !!defaultDomain;
        const v = allowSubDomain ? (data.managedSubDomain?.trim() || null) : null;
        if (v) {
          if (!/^[a-zA-Z0-9-]+$/.test(v)) {
            return reply.status(400).send({
              error:
                "Sub-domain must contain only letters, numbers, and hyphens (no dots or special characters).",
            });
          }
        }
        set.managedSubDomain = v;
        dnsFieldsChanged = true;
      }
      if (data.cloudflareApiKey !== undefined) {
        const settingsForKey = readSettings();
        const allowCustomKey = settingsForKey.dns_default_allow_custom_key ?? false;
        const raw = allowCustomKey ? String(data.cloudflareApiKey ?? "").trim() : "";
        const enc = raw ? encryptSecret(raw, DNS_SECRETS_AAD) : "";
        set.cloudflareApiKeyEnc = enc || null;
        dnsFieldsChanged = true;
      }
      if (Object.keys(set).length === 0) {
        const row = repo.getById(id);
        if (!row) return reply.status(404).send({ error: "Podcast not found" });
        const noopOut = { ...podcastRowWithFilename(row) };
        delete (noopOut as Record<string, unknown>).cloudflareApiKeyEnc;
        (noopOut as Record<string, unknown>).cloudflareApiKeySet = Boolean(
          row.cloudflareApiKeyEnc &&
            String(row.cloudflareApiKeyEnc).trim().length > 0,
        );
        const settingsNoop = readSettings();
        let allowDomainsNoop: string[] = [];
        try {
          const raw = settingsNoop.dns_default_allow_domains ?? "[]";
          const parsed = JSON.parse(raw) as unknown;
          allowDomainsNoop = Array.isArray(parsed)
            ? parsed.filter((s): s is string => typeof s === "string")
            : [];
        } catch {
          // ignore
        }
        (noopOut as Record<string, unknown>).dnsConfig = {
          allowLinkingDomain: settingsNoop.dns_allow_linking_domain ?? false,
          allowDomain: settingsNoop.dns_default_allow_domain ?? false,
          allowDomains: allowDomainsNoop,
          defaultDomain: settingsNoop.dns_default_domain ?? "",
          allowSubDomain: settingsNoop.dns_default_allow_sub_domain ?? false,
          allowCustomKey: settingsNoop.dns_default_allow_custom_key ?? false,
        };
        return noopOut;
      }
      set.updatedAt = sqlNow();
      try {
        drizzleDb
          .update(podcasts)
          .set(set as Record<string, unknown>)
          .where(eq(podcasts.id, id))
          .run();
      } catch (e) {
        if (isUniqueViolation(e)) {
          return reply
            .status(409)
            .send({ error: "Slug already used for your account" });
        }
        throw e;
      }
      service.afterUpdatePodcast(id);
      if (dnsFieldsChanged) {
        setImmediate(() => {
          runDnsUpdateTask(id, request.log).catch(() => {
            // errors already logged in task
          });
        });
      }
      if (oldArtworkPath) {
        try {
          const resolvedOld = resolveDataPath(oldArtworkPath);
          const safeOld = assertPathUnder(resolvedOld, artworkDir(id));
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Podcast not found" });
      const out = { ...podcastRowWithFilename(row) };
      delete (out as Record<string, unknown>).cloudflareApiKeyEnc;
      (out as Record<string, unknown>).cloudflareApiKeySet = Boolean(
        row.cloudflareApiKeyEnc &&
          String(row.cloudflareApiKeyEnc).trim().length > 0,
      );
      const settings = readSettings();
      let allowDomains: string[] = [];
      try {
        const raw = settings.dns_default_allow_domains ?? "[]";
        const parsed = JSON.parse(raw) as unknown;
        allowDomains = Array.isArray(parsed)
          ? parsed.filter((s): s is string => typeof s === "string")
          : [];
      } catch {
        // ignore
      }
      (out as Record<string, unknown>).dnsConfig = {
        allowLinkingDomain: settings.dns_allow_linking_domain ?? false,
        allowDomain: settings.dns_default_allow_domain ?? false,
        allowDomains,
        defaultDomain: settings.dns_default_domain ?? "",
        allowSubDomain: settings.dns_default_allow_sub_domain ?? false,
        allowCustomKey: settings.dns_default_allow_custom_key ?? false,
      };
      return out;
    },
  );
}
