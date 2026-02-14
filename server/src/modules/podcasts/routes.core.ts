import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";
import { existsSync, unlinkSync } from "fs";
import {
  requireAdmin,
  requireAuth,
  requireNotReadOnly,
} from "../../plugins/auth.js";
import { db } from "../../db/index.js";
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
  podcastCreateSchema,
  podcastUpdateSchema,
  podcastsListQuerySchema,
} from "@harborfm/shared";
import { assertPathUnder, artworkDir } from "../../services/paths.js";
import { readSettings } from "../settings/index.js";
import { encryptSecret } from "../../services/secrets.js";
import { getCanonicalFeedUrl } from "../../services/dns/custom-domain-resolver.js";
import { runDnsUpdateTask } from "../../services/dns/update-task.js";
import { podcastRowWithFilename } from "./utils.js";
import * as repo from "./repo.js";
import * as service from "./service.js";

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
          my_role: "owner" as const,
          is_shared: false,
        })),
        ...shared
          .filter((r) => !ownedIds.has(r.id as string))
          .map((r) => {
            const shareRole = repo.getShareRole(r.id as string, userId);
            return {
              ...podcastRowWithFilename(r),
              my_role: shareRole ?? "view",
              is_shared: true,
            };
          }),
      ];
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        combined = combined.filter((p: Record<string, unknown>) => {
          const title = ((p.title as string) || "").toLowerCase();
          const description = ((p.description as string) || "").toLowerCase();
          const author = ((p.author_name as string) || "").toLowerCase();
          return (
            title.includes(lowerQuery) ||
            description.includes(lowerQuery) ||
            author.includes(lowerQuery)
          );
        });
      }
      combined.sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) => {
          const aTime = new Date((a.updated_at as string) ?? 0).getTime();
          const bTime = new Date((b.updated_at as string) ?? 0).getTime();
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
        response: { 200: { description: "List of podcasts and total count" } },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
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
          const author = ((p.author_name as string) || "").toLowerCase();
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
      const userRow = db
        .prepare("SELECT max_podcasts FROM users WHERE id = ?")
        .get(userId) as { max_podcasts: number | null } | undefined;
      const maxPodcasts = userRow?.max_podcasts ?? null;
      if (maxPodcasts != null && maxPodcasts > 0) {
        const count = db
          .prepare(
            "SELECT COUNT(*) as count FROM podcasts WHERE owner_user_id = ?",
          )
          .get(userId) as { count: number };
        if (count.count >= maxPodcasts) {
          return reply.status(403).send({
            error: `You have reached your limit of ${maxPodcasts} show${maxPodcasts === 1 ? "" : "s"}. You cannot create more.`,
          });
        }
      }
      const id = nanoid();
      const data = parsed.data;
      const existingSlug = db
        .prepare("SELECT id FROM podcasts WHERE slug = ?")
        .get(data.slug) as { id: string } | undefined;
      if (existingSlug) {
        return reply
          .status(409)
          .send({
            error: "This slug is already taken. Please choose a different one.",
          });
      }
      const podcastGuid = data.podcast_guid ?? randomUUID();
      try {
        const ext = data as {
          subtitle?: string | null;
          summary?: string | null;
          funding_url?: string | null;
          funding_label?: string | null;
          persons?: string | null;
          update_frequency_rrule?: string | null;
          update_frequency_label?: string | null;
          spotify_recent_count?: number | null;
          spotify_country_of_origin?: string | null;
          apple_podcasts_verify?: string | null;
        };
        db.prepare(
          `INSERT INTO podcasts (
          id, owner_user_id, title, slug, description, subtitle, summary, language, author_name, owner_name,
          email, category_primary, category_secondary, category_primary_two, category_secondary_two,
          category_primary_three, category_secondary_three, explicit, site_url, artwork_url,
          copyright, podcast_guid, locked, license, itunes_type, medium,
          funding_url, funding_label, persons, update_frequency_rrule, update_frequency_label,
          spotify_recent_count, spotify_country_of_origin, apple_podcasts_verify, max_episodes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          request.userId,
          data.title,
          data.slug,
          data.description ?? "",
          ext.subtitle ?? null,
          ext.summary ?? null,
          data.language ?? "en",
          data.author_name ?? "",
          data.owner_name ?? "",
          data.email ?? "",
          data.category_primary ?? "",
          data.category_secondary ?? null,
          (data as { category_primary_two?: string | null })
            .category_primary_two ?? null,
          (data as { category_secondary_two?: string | null })
            .category_secondary_two ?? null,
          (data as { category_primary_three?: string | null })
            .category_primary_three ?? null,
          (data as { category_secondary_three?: string | null })
            .category_secondary_three ?? null,
          data.explicit ?? 0,
          data.site_url ?? null,
          data.artwork_url ?? null,
          data.copyright ?? null,
          podcastGuid,
          data.locked ?? 0,
          data.license ?? null,
          data.itunes_type ?? "episodic",
          data.medium ?? "podcast",
          ext.funding_url ?? null,
          ext.funding_label ?? null,
          ext.persons ?? null,
          ext.update_frequency_rrule ?? null,
          ext.update_frequency_label ?? null,
          ext.spotify_recent_count ?? null,
          ext.spotify_country_of_origin ?? null,
          ext.apple_podcasts_verify ?? null,
          null,
        );
      } catch (e) {
        const err = e as { message?: string };
        if (err.message?.includes("UNIQUE")) {
          return reply
            .status(409)
            .send({ error: "Slug already used for your account" });
        }
        throw e;
      }
      service.afterCreatePodcast(id, data, userId, request.log);
      const row = db
        .prepare("SELECT * FROM podcasts WHERE id = ?")
        .get(id) as Record<string, unknown>;
      return reply.status(201).send(podcastRowWithFilename(row));
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
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { userId } = request;
      if (getPodcastRole(userId, id) === null) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Podcast not found" });
      const role = getPodcastRole(userId, id);
      const isShared = role !== "owner";
      const ownerId = row.owner_user_id as string;
      const can_record_new_section = ownerId
        ? !wouldExceedStorageLimit(db, ownerId, RECORD_MIN_FREE_BYTES)
        : true;
      const podcastMaxCollab = row.max_collaborators as number | null | undefined;
      const ownerMaxCollab = ownerId
        ? ((
            db
              .prepare("SELECT max_collaborators FROM users WHERE id = ?")
              .get(ownerId) as { max_collaborators: number | null } | undefined
          )?.max_collaborators ?? null)
        : null;
      const effective_max_collaborators =
        podcastMaxCollab ?? ownerMaxCollab ?? null;
      const podcastMaxSubscriberTokens = row.max_subscriber_tokens as
        | number
        | null
        | undefined;
      const ownerMaxSubscriberTokens = ownerId
        ? ((
            db
              .prepare("SELECT max_subscriber_tokens FROM users WHERE id = ?")
              .get(ownerId) as
              | { max_subscriber_tokens: number | null }
              | undefined
          )?.max_subscriber_tokens ?? null)
        : null;
      const settings = readSettings();
      const effective_max_subscriber_tokens =
        podcastMaxSubscriberTokens ??
        ownerMaxSubscriberTokens ??
        settings.default_max_subscriber_tokens ??
        null;
      const owner_can_transcribe = ownerId
        ? ((
            db
              .prepare(
                "SELECT COALESCE(can_transcribe, 0) AS can_transcribe FROM users WHERE id = ?",
              )
              .get(ownerId) as { can_transcribe: number }
          )?.can_transcribe ?? 0)
        : 0;
      const out = { ...podcastRowWithFilename(row) };
      delete (out as Record<string, unknown>).cloudflare_api_key_enc;
      (out as Record<string, unknown>).cloudflare_api_key_set = Boolean(
        row.cloudflare_api_key_enc &&
          String(row.cloudflare_api_key_enc).trim().length > 0,
      );
      let allow_domains: string[] = [];
      try {
        const raw = settings.dns_default_allow_domains ?? "[]";
        const parsed = JSON.parse(raw) as unknown;
        allow_domains = Array.isArray(parsed)
          ? parsed.filter((s): s is string => typeof s === "string")
          : [];
      } catch {
        // ignore
      }
      (out as Record<string, unknown>).dns_config = {
        allow_linking_domain: settings.dns_allow_linking_domain ?? false,
        allow_domain: settings.dns_default_allow_domain ?? false,
        allow_domains,
        default_domain: settings.dns_default_domain ?? "",
        allow_sub_domain: settings.dns_default_allow_sub_domain ?? false,
        allow_custom_key: settings.dns_default_allow_custom_key ?? false,
      };
      const canonicalUrl = getCanonicalFeedUrl(
        row as { link_domain?: string | null; managed_domain?: string | null; managed_sub_domain?: string | null },
        settings,
      );
      if (canonicalUrl) (out as Record<string, unknown>).canonical_feed_url = canonicalUrl;
      return {
        ...out,
        my_role: role ?? "view",
        is_shared: isShared,
        can_record_new_section,
        effective_max_collaborators: effective_max_collaborators,
        effective_max_subscriber_tokens: effective_max_subscriber_tokens,
        owner_can_transcribe,
      };
    },
  );

  // GET /podcasts/:id/analytics
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  app.get(
    "/podcasts/:id/analytics",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Podcasts"],
        summary: "Get podcast analytics",
        description:
          "Returns listen and episode analytics for a show. Optional start_date, end_date (YYYY-MM-DD), limit, and offset filter and paginate daily stats.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: {
            start_date: { type: "string", description: "YYYY-MM-DD" },
            end_date: { type: "string", description: "YYYY-MM-DD" },
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
      const query = request.query as {
        start_date?: string;
        end_date?: string;
        limit?: number;
        offset?: number;
      };
      const start_date = query.start_date;
      const end_date = query.end_date;
      const limit = query.limit;
      const offset = query.offset ?? 0;

      if (start_date !== undefined && !DATE_RE.test(start_date)) {
        return reply.status(400).send({ error: "Invalid start_date" });
      }
      if (end_date !== undefined && !DATE_RE.test(end_date)) {
        return reply.status(400).send({ error: "Invalid end_date" });
      }
      if (start_date !== undefined && end_date !== undefined && start_date > end_date) {
        return reply.status(400).send({ error: "start_date must be <= end_date" });
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
      const podcast = db
        .prepare(
          `SELECT p.id, COALESCE(u.read_only, 0) AS owner_read_only
         FROM podcasts p
         INNER JOIN users u ON p.owner_user_id = u.id
         WHERE p.id = ?`,
        )
        .get(podcastId) as { id: string; owner_read_only: number } | undefined;
      if (!podcast)
        return reply.status(404).send({ error: "Podcast not found" });

      const dateWhere =
        start_date !== undefined && end_date !== undefined
          ? " AND stat_date >= ? AND stat_date <= ?"
          : "";
      const limitClause =
        limit !== undefined ? " LIMIT ? OFFSET ?" : "";
      const rssParams: unknown[] = [podcastId];
      if (start_date !== undefined && end_date !== undefined) {
        rssParams.push(start_date, end_date);
      }
      if (limit !== undefined) {
        rssParams.push(limit, offset);
      }
      const rss_daily = db
        .prepare(
          `SELECT stat_date, bot_count, human_count FROM podcast_stats_rss_daily WHERE podcast_id = ?${dateWhere} ORDER BY stat_date DESC${limitClause}`,
        )
        .all(...rssParams) as Array<{
        stat_date: string;
        bot_count: number;
        human_count: number;
      }>;

      const episodes = db
        .prepare(
          `SELECT id, title, slug FROM episodes WHERE podcast_id = ? ORDER BY COALESCE(publish_at, updated_at) DESC`,
        )
        .all(podcastId) as Array<{
        id: string;
        title: string;
        slug: string | null;
      }>;
      const episodeIds = episodes.map((e) => e.id);
      const episode_daily: Array<{
        episode_id: string;
        stat_date: string;
        bot_count: number;
        human_count: number;
      }> = [];
      const episode_location_daily: Array<{
        episode_id: string;
        stat_date: string;
        location: string;
        bot_count: number;
        human_count: number;
      }> = [];
      const episode_listens_daily: Array<{
        episode_id: string;
        stat_date: string;
        bot_count: number;
        human_count: number;
      }> = [];
      if (episodeIds.length > 0) {
        const placeholders = episodeIds.map(() => "?").join(",");
        const epParams: unknown[] = [...episodeIds];
        if (start_date !== undefined && end_date !== undefined) {
          epParams.push(start_date, end_date);
        }
        if (limit !== undefined) {
          epParams.push(limit, offset);
        }
        episode_daily.push(
          ...(db
            .prepare(
              `SELECT episode_id, stat_date, bot_count, human_count FROM podcast_stats_episode_daily WHERE episode_id IN (${placeholders})${dateWhere} ORDER BY stat_date DESC, episode_id${limitClause}`,
            )
            .all(...epParams) as Array<{
            episode_id: string;
            stat_date: string;
            bot_count: number;
            human_count: number;
          }>),
        );
        episode_location_daily.push(
          ...(db
            .prepare(
              `SELECT episode_id, stat_date, location, bot_count, human_count FROM podcast_stats_episode_location_daily WHERE episode_id IN (${placeholders})${dateWhere} ORDER BY stat_date DESC, episode_id, location${limitClause}`,
            )
            .all(...epParams) as Array<{
            episode_id: string;
            stat_date: string;
            location: string;
            bot_count: number;
            human_count: number;
          }>),
        );
        episode_listens_daily.push(
          ...(db
            .prepare(
              `SELECT episode_id, stat_date, bot_count, human_count FROM podcast_stats_episode_listens_daily WHERE episode_id IN (${placeholders})${dateWhere} ORDER BY stat_date DESC, episode_id${limitClause}`,
            )
            .all(...epParams) as Array<{
            episode_id: string;
            stat_date: string;
            bot_count: number;
            human_count: number;
          }>),
        );
      }
      if (podcast.owner_read_only === 1 && episode_location_daily.length > 0) {
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
        episodes,
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
        data.link_domain !== undefined ||
        data.managed_domain !== undefined ||
        data.managed_sub_domain !== undefined ||
        (data as { cloudflare_api_key?: string }).cloudflare_api_key !==
          undefined;
      if (hasDnsFields && !canEditDnsSettings(request.userId, id)) {
        return reply.status(403).send({
          error: "Only the show owner or an administrator can edit DNS settings.",
        });
      }
      const currentPodcast = repo.getSlug(id);
      if (currentPodcast === undefined)
        return reply.status(404).send({ error: "Podcast not found" });
      const fields: string[] = [];
      const values: unknown[] = [];
      let oldArtworkPath: string | null = null;
      if (data.title !== undefined) {
        fields.push("title = ?");
        values.push(data.title);
      }
      if (data.slug !== undefined) {
        if (data.slug !== currentPodcast) {
          const currentRow = db
            .prepare("SELECT unlisted FROM podcasts WHERE id = ?")
            .get(id) as { unlisted: number | null } | undefined;
          const isUnlisted = (currentRow?.unlisted ?? 0) === 1;
          const role = getPodcastRole(request.userId, id);
          const canEditSlug =
            isAdmin(request.userId) ||
            (isUnlisted && canManageCollaborators(role));
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
          const existingSlug = db
            .prepare("SELECT id FROM podcasts WHERE slug = ? AND id != ?")
            .get(data.slug, id) as { id: string } | undefined;
          if (existingSlug) {
            return reply
              .status(409)
              .send({
                error:
                  "This slug is already taken. Please choose a different one.",
              });
          }
          fields.push("slug = ?");
          values.push(data.slug);
        }
      }
      if (data.description !== undefined) {
        fields.push("description = ?");
        values.push(data.description);
      }
      if ((data as { subtitle?: string | null }).subtitle !== undefined) {
        fields.push("subtitle = ?");
        values.push((data as { subtitle?: string | null }).subtitle);
      }
      if ((data as { summary?: string | null }).summary !== undefined) {
        fields.push("summary = ?");
        values.push((data as { summary?: string | null }).summary);
      }
      if (data.language !== undefined) {
        fields.push("language = ?");
        values.push(data.language);
      }
      if (data.author_name !== undefined) {
        fields.push("author_name = ?");
        values.push(data.author_name);
      }
      if (data.owner_name !== undefined) {
        fields.push("owner_name = ?");
        values.push(data.owner_name);
      }
      if (data.email !== undefined) {
        fields.push("email = ?");
        values.push(data.email);
      }
      if (data.category_primary !== undefined) {
        fields.push("category_primary = ?");
        values.push(data.category_primary);
      }
      if (data.category_secondary !== undefined) {
        fields.push("category_secondary = ?");
        const primary =
          data.category_primary ??
          (
            db
              .prepare("SELECT category_primary FROM podcasts WHERE id = ?")
              .get(id) as { category_primary: string | null }
          )?.category_primary;
        values.push(
          primary && String(primary).trim() ? data.category_secondary : null,
        );
      }
      if (data.explicit !== undefined) {
        fields.push("explicit = ?");
        values.push(data.explicit);
      }
      if (data.site_url !== undefined) {
        fields.push("site_url = ?");
        values.push(data.site_url);
      }
      if (data.artwork_url !== undefined) {
        fields.push("artwork_url = ?");
        values.push(data.artwork_url);
        if (data.artwork_url && String(data.artwork_url).trim()) {
          fields.push("artwork_path = NULL");
          const row = db
            .prepare("SELECT artwork_path FROM podcasts WHERE id = ?")
            .get(id) as { artwork_path: string | null } | undefined;
          if (row?.artwork_path) oldArtworkPath = row.artwork_path;
        }
      }
      if (data.copyright !== undefined) {
        fields.push("copyright = ?");
        values.push(data.copyright);
      }
      if (data.podcast_guid !== undefined) {
        fields.push("podcast_guid = ?");
        values.push(data.podcast_guid);
      }
      if (data.locked !== undefined) {
        fields.push("locked = ?");
        values.push(data.locked);
      }
      if (data.license !== undefined) {
        fields.push("license = ?");
        values.push(data.license);
      }
      if (data.itunes_type !== undefined) {
        fields.push("itunes_type = ?");
        values.push(data.itunes_type);
      }
      if (data.medium !== undefined) {
        fields.push("medium = ?");
        values.push(data.medium);
      }
      if (data.max_collaborators !== undefined) {
        fields.push("max_collaborators = ?");
        values.push(data.max_collaborators);
      }
      if (data.unlisted !== undefined) {
        fields.push("unlisted = ?");
        values.push(data.unlisted);
      }
      if (data.subscriber_only_feed_enabled !== undefined) {
        fields.push("subscriber_only_feed_enabled = ?");
        values.push(data.subscriber_only_feed_enabled);
        if (data.subscriber_only_feed_enabled === 0) {
          fields.push("public_feed_disabled = ?");
          values.push(0);
        }
      }
      if (data.public_feed_disabled !== undefined) {
        fields.push("public_feed_disabled = ?");
        values.push(data.public_feed_disabled);
      }
      const ext = data as {
        funding_url?: string | null;
        funding_label?: string | null;
        persons?: string | null;
        update_frequency_rrule?: string | null;
        update_frequency_label?: string | null;
        spotify_recent_count?: number | null;
        spotify_country_of_origin?: string | null;
        apple_podcasts_verify?: string | null;
      };
      if (ext.funding_url !== undefined) {
        fields.push("funding_url = ?");
        values.push(ext.funding_url);
      }
      if (ext.funding_label !== undefined) {
        fields.push("funding_label = ?");
        values.push(ext.funding_label);
      }
      if (ext.persons !== undefined) {
        fields.push("persons = ?");
        values.push(ext.persons);
      }
      if (ext.update_frequency_rrule !== undefined) {
        fields.push("update_frequency_rrule = ?");
        values.push(ext.update_frequency_rrule);
      }
      if (ext.update_frequency_label !== undefined) {
        fields.push("update_frequency_label = ?");
        values.push(ext.update_frequency_label);
      }
      if (ext.spotify_recent_count !== undefined) {
        fields.push("spotify_recent_count = ?");
        values.push(ext.spotify_recent_count);
      }
      if (ext.spotify_country_of_origin !== undefined) {
        fields.push("spotify_country_of_origin = ?");
        values.push(ext.spotify_country_of_origin);
      }
      if (ext.apple_podcasts_verify !== undefined) {
        fields.push("apple_podcasts_verify = ?");
        values.push(ext.apple_podcasts_verify);
      }
      const links = data as {
        apple_podcasts_url?: string | null;
        spotify_url?: string | null;
        amazon_music_url?: string | null;
        podcast_index_url?: string | null;
        listen_notes_url?: string | null;
        castbox_url?: string | null;
        x_url?: string | null;
        facebook_url?: string | null;
        instagram_url?: string | null;
        tiktok_url?: string | null;
        youtube_url?: string | null;
      };
      if (links.apple_podcasts_url !== undefined) {
        fields.push("apple_podcasts_url = ?");
        values.push(links.apple_podcasts_url);
      }
      if (links.spotify_url !== undefined) {
        fields.push("spotify_url = ?");
        values.push(links.spotify_url);
      }
      if (links.amazon_music_url !== undefined) {
        fields.push("amazon_music_url = ?");
        values.push(links.amazon_music_url);
      }
      if (links.podcast_index_url !== undefined) {
        fields.push("podcast_index_url = ?");
        values.push(links.podcast_index_url);
      }
      if (links.listen_notes_url !== undefined) {
        fields.push("listen_notes_url = ?");
        values.push(links.listen_notes_url);
      }
      if (links.castbox_url !== undefined) {
        fields.push("castbox_url = ?");
        values.push(links.castbox_url);
      }
      if (links.x_url !== undefined) {
        fields.push("x_url = ?");
        values.push(links.x_url);
      }
      if (links.facebook_url !== undefined) {
        fields.push("facebook_url = ?");
        values.push(links.facebook_url);
      }
      if (links.instagram_url !== undefined) {
        fields.push("instagram_url = ?");
        values.push(links.instagram_url);
      }
      if (links.tiktok_url !== undefined) {
        fields.push("tiktok_url = ?");
        values.push(links.tiktok_url);
      }
      if (links.youtube_url !== undefined) {
        fields.push("youtube_url = ?");
        values.push(links.youtube_url);
      }
      const d = data as {
        category_primary_two?: string | null;
        category_secondary_two?: string | null;
        category_primary_three?: string | null;
        category_secondary_three?: string | null;
      };
      if (d.category_primary_two !== undefined) {
        fields.push("category_primary_two = ?");
        values.push(d.category_primary_two);
      }
      if (d.category_secondary_two !== undefined) {
        fields.push("category_secondary_two = ?");
        const primaryTwo =
          d.category_primary_two ??
          (
            db
              .prepare("SELECT category_primary_two FROM podcasts WHERE id = ?")
              .get(id) as { category_primary_two: string | null }
          )?.category_primary_two;
        values.push(
          primaryTwo && String(primaryTwo).trim()
            ? d.category_secondary_two
            : null,
        );
      }
      if (d.category_primary_three !== undefined) {
        fields.push("category_primary_three = ?");
        values.push(d.category_primary_three);
      }
      if (d.category_secondary_three !== undefined) {
        fields.push("category_secondary_three = ?");
        const primaryThree =
          d.category_primary_three ??
          (
            db
              .prepare(
                "SELECT category_primary_three FROM podcasts WHERE id = ?",
              )
              .get(id) as { category_primary_three: string | null }
          )?.category_primary_three;
        values.push(
          primaryThree && String(primaryThree).trim()
            ? d.category_secondary_three
            : null,
        );
      }
      const dnsExt = data as {
        link_domain?: string | null;
        managed_domain?: string | null;
        managed_sub_domain?: string | null;
        cloudflare_api_key?: string;
      };
      let dnsFieldsChanged = false;
      if (dnsExt.link_domain !== undefined) {
        const linkVal = dnsExt.link_domain?.trim() || null;
        if (linkVal) {
          const settings = readSettings();
          if (!settings.dns_allow_linking_domain) {
            return reply.status(400).send({
              error:
                "Linking domain is disabled in server settings. Enable it in Settings → DNS & custom domain to set a link domain.",
            });
          }
        }
        fields.push("link_domain = ?");
        values.push(linkVal);
        dnsFieldsChanged = true;
      }
      if (dnsExt.managed_domain !== undefined) {
        const settingsForDomain = readSettings();
        const allowDomain = settingsForDomain.dns_default_allow_domain ?? false;
        const managedDomainValue = allowDomain ? (dnsExt.managed_domain?.trim() || null) : null;
        fields.push("managed_domain = ?");
        values.push(managedDomainValue);
        dnsFieldsChanged = true;
      }
      if (dnsExt.managed_sub_domain !== undefined) {
        const settingsForSub = readSettings();
        const defaultDomain = (settingsForSub.dns_default_domain ?? "").trim();
        const allowSubDomain = (settingsForSub.dns_default_allow_sub_domain ?? false) && !!defaultDomain;
        const v = allowSubDomain ? (dnsExt.managed_sub_domain?.trim() || null) : null;
        if (v) {
          if (!/^[a-zA-Z0-9-]+$/.test(v)) {
            return reply.status(400).send({
              error:
                "Sub-domain must contain only letters, numbers, and hyphens (no dots or special characters).",
            });
          }
        }
        fields.push("managed_sub_domain = ?");
        values.push(v);
        dnsFieldsChanged = true;
      }
      if (dnsExt.cloudflare_api_key !== undefined) {
        const settingsForKey = readSettings();
        const allowCustomKey = settingsForKey.dns_default_allow_custom_key ?? false;
        const raw = allowCustomKey ? String(dnsExt.cloudflare_api_key ?? "").trim() : "";
        const enc = raw ? encryptSecret(raw, DNS_SECRETS_AAD) : "";
        fields.push("cloudflare_api_key_enc = ?");
        values.push(enc || null);
        dnsFieldsChanged = true;
      }
      if (fields.length === 0) {
        const row = repo.getById(id);
        if (!row) return reply.status(404).send({ error: "Podcast not found" });
        const noopOut = { ...podcastRowWithFilename(row) };
        delete (noopOut as Record<string, unknown>).cloudflare_api_key_enc;
        (noopOut as Record<string, unknown>).cloudflare_api_key_set = Boolean(
          row.cloudflare_api_key_enc &&
            String(row.cloudflare_api_key_enc).trim().length > 0,
        );
        const settingsNoop = readSettings();
        let allow_domains_noop: string[] = [];
        try {
          const raw = settingsNoop.dns_default_allow_domains ?? "[]";
          const parsed = JSON.parse(raw) as unknown;
          allow_domains_noop = Array.isArray(parsed)
            ? parsed.filter((s): s is string => typeof s === "string")
            : [];
        } catch {
          // ignore
        }
        (noopOut as Record<string, unknown>).dns_config = {
          allow_linking_domain: settingsNoop.dns_allow_linking_domain ?? false,
          allow_domain: settingsNoop.dns_default_allow_domain ?? false,
          allow_domains: allow_domains_noop,
          default_domain: settingsNoop.dns_default_domain ?? "",
          allow_sub_domain: settingsNoop.dns_default_allow_sub_domain ?? false,
          allow_custom_key: settingsNoop.dns_default_allow_custom_key ?? false,
        };
        return noopOut;
      }
      fields.push("updated_at = datetime('now')");
      values.push(id);
      try {
        db.prepare(`UPDATE podcasts SET ${fields.join(", ")} WHERE id = ?`).run(
          ...values,
        );
      } catch (e) {
        const err = e as { message?: string };
        if (err.message?.includes("UNIQUE")) {
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
          const safeOld = assertPathUnder(oldArtworkPath, artworkDir(id));
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Podcast not found" });
      const out = { ...podcastRowWithFilename(row) };
      delete (out as Record<string, unknown>).cloudflare_api_key_enc;
      (out as Record<string, unknown>).cloudflare_api_key_set = Boolean(
        row.cloudflare_api_key_enc &&
          String(row.cloudflare_api_key_enc).trim().length > 0,
      );
      const settings = readSettings();
      let allow_domains: string[] = [];
      try {
        const raw = settings.dns_default_allow_domains ?? "[]";
        const parsed = JSON.parse(raw) as unknown;
        allow_domains = Array.isArray(parsed)
          ? parsed.filter((s): s is string => typeof s === "string")
          : [];
      } catch {
        // ignore
      }
      (out as Record<string, unknown>).dns_config = {
        allow_linking_domain: settings.dns_allow_linking_domain ?? false,
        allow_domain: settings.dns_default_allow_domain ?? false,
        allow_domains,
        default_domain: settings.dns_default_domain ?? "",
        allow_sub_domain: settings.dns_default_allow_sub_domain ?? false,
        allow_custom_key: settings.dns_default_allow_custom_key ?? false,
      };
      return out;
    },
  );
}
