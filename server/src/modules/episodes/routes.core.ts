import type { FastifyInstance } from "fastify";
import { existsSync, unlinkSync, rmSync, statSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { isUniqueViolation } from "../../db/utils.js";
import {
  canAccessPodcast,
  getPodcastRole,
  canAccessEpisode,
  canEditEpisodeOrPodcastMetadata,
  getPodcastOwnerId,
  isAdmin,
} from "../../services/access.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { episodeCreateSchema, episodeUpdateSchema } from "@harborfm/shared";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { writeEpisodeChaptersJson } from "../../services/episodeChapters.js";
import { notifyWebSubHub } from "../../services/websub.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  assertSafeId,
  artworkDir,
  getDataDir,
  processedDir,
  transcriptSrtPath,
  uploadsDir,
  resolveDataPath,
} from "../../services/paths.js";
import { APP_NAME } from "../../config.js";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { sqlNow } from "../../db/utils.js";
import { episodeRowWithFilename, slugify } from "./utils.js";
import * as repo from "./repo.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/episodes",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "List episodes",
        description:
          "List episodes for a podcast. Must have access to the podcast.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        response: {
          200: { description: "List of episodes" },
          400: { description: "Invalid podcastId" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid podcastId" });
      }
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const rows = repo.listByPodcastId(podcastId);
      return { episodes: rows.map((r) => episodeRowWithFilename(r)) };
    },
  );

  app.post(
    "/podcasts/:podcastId/episodes",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Create episode",
        description:
          "Create an episode for a podcast. Requires read-write access.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
          },
          required: ["title"],
        },
        response: {
          201: { description: "Created episode" },
          400: { description: "Validation failed" },
          403: { description: "At limit or read-only" },
          404: { description: "Podcast not found" },
          409: { description: "Slug or GUID conflict" },
          500: { description: "Failed to fetch created episode" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid podcastId" });
      }
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const { maxEpisodes } = repo.getCreateLimit(podcastId);
      if (maxEpisodes != null && maxEpisodes > 0) {
        const count = repo.countByPodcastId(podcastId);
        if (count >= maxEpisodes) {
          return reply.status(403).send({
            error: `This show has reached its limit of ${maxEpisodes} episode${maxEpisodes === 1 ? "" : "s"}. You cannot create more.`,
          });
        }
      }
      const parsed = episodeCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const id = nanoid();
      const urnNamespace = APP_NAME.toLowerCase().replace(/\s+/g, "-");
      const guid = `urn:${urnNamespace}:episode:${id}`;
      const data = parsed.data;
      const slug = (data as { slug?: string }).slug || slugify(data.title);
      let finalSlug = slug;
      let counter = 1;
      while (repo.slugExists(podcastId, finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }
      const insertRow: repo.EpisodeInsert = {
        id,
        podcastId,
        title: data.title,
        description: data.description ?? "",
        guid,
        subtitle: data.subtitle ?? null,
        summary: data.summary ?? null,
        contentEncoded: data.contentEncoded ?? null,
        slug: finalSlug,
        seasonNumber: data.seasonNumber ?? null,
        episodeNumber: data.episodeNumber ?? null,
        episodeType: data.episodeType ?? null,
        explicit: data.explicit == null ? null : Boolean(data.explicit),
        publishAt: data.publishAt ?? null,
        status: data.status ?? "draft",
        artworkUrl: data.artworkUrl ?? null,
        episodeLink: data.episodeLink ?? null,
        guidIsPermalink: Boolean(data.guidIsPermalink),
      };
      try {
        repo.insertEpisode(insertRow);
      } catch (e) {
        if (isUniqueViolation(e)) {
          return reply.status(409).send({
            error: "Slug or GUID conflict. Try a different slug or refresh.",
          });
        }
        throw e;
      }
      try {
        writeRssFile(podcastId, null);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      const row = repo.getById(id);
      if (!row) return reply.status(500).send({ error: "Failed to fetch created episode" });
      return reply.status(201).send(episodeRowWithFilename(row));
    },
  );

  app.get(
    "/episodes/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "Get episode",
        description: "Get an episode by ID. Must have access to the podcast.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Episode" },
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
      const access = canAccessEpisode(request.userId, id);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Episode not found" });
      const out = episodeRowWithFilename(row) as Record<string, unknown>;
      const podcastId = row.podcastId ?? "";
      if (podcastId && row.audioFinalPath) {
        const srtPath = transcriptSrtPath(podcastId, id);
        if (existsSync(srtPath)) {
          assertPathUnder(srtPath, processedDir(podcastId, id));
          out.hasTranscript = true;
        }
      }
      return out;
    },
  );

  app.patch(
    "/episodes/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Update episode",
        description: "Update episode metadata. Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
          },
        },
        response: {
          200: { description: "Updated episode" },
          400: { description: "Validation failed" },
          403: { description: "Only admins can edit slugs" },
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
      const access = canAccessEpisode(request.userId, id);
      if (!access || !canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const parsed = episodeUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const data = parsed.data;
      const updateData = data as { slug?: string; title?: string };

      const currentEpisode = repo.getEpisodeMeta(id);
      if (!currentEpisode)
        return reply.status(404).send({ error: "Episode not found" });

      let publishAtValue = data.publishAt;
      const isTransitioningToPublished =
        data.status === "published" &&
        (currentEpisode.status === "draft" ||
          currentEpisode.status === "scheduled");
      const publishAtEmpty =
        data.publishAt == null ||
        (typeof data.publishAt === "string" && data.publishAt.trim() === "");
      const currentPublishAtEmpty =
        currentEpisode.publishAt == null ||
        String(currentEpisode.publishAt).trim() === "";
      if (
        isTransitioningToPublished &&
        publishAtEmpty &&
        currentPublishAtEmpty
      ) {
        publishAtValue = new Date().toISOString();
      }

      if (
        updateData.slug !== undefined &&
        updateData.slug !== currentEpisode.slug &&
        !isAdmin(request.userId)
      ) {
        return reply
          .status(403)
          .send({ error: "Only administrators can edit slugs" });
      }

      const newTitle = data.title ?? currentEpisode.title;
      let finalSlug = updateData.slug ?? currentEpisode.slug ?? "";
      if (!finalSlug && updateData.slug === undefined) {
        finalSlug = slugify(newTitle);
      }

      if (finalSlug !== (currentEpisode.slug ?? "")) {
        let uniqueSlug = finalSlug;
        let counter = 1;
        while (repo.slugExists(currentEpisode.podcastId, uniqueSlug, id)) {
          uniqueSlug = `${finalSlug}-${counter}`;
          counter++;
        }
        finalSlug = uniqueSlug;
      }

      let oldArtworkPath: string | null = null;
      if (data.artworkUrl !== undefined) {
        const pathRaw = repo.getArtworkPath(id);
        if (pathRaw) oldArtworkPath = resolveDataPath(pathRaw);
      }

      const finalMarkersPayload = data.finalMarkers;
      const finalSoundbitesPayload = data.finalSoundbites;
      const contentLinksPayload = data.contentLinks;
      const podcastTxtsPayload = data.podcastTxts;
      const socialInteractsPayload = data.socialInteracts;
      const locationsPayload = data.locations;
      const licensePayload = data.license;
      const podcastImagesPayload = data.podcastImages;
      const fundingLinksPayload = data.fundingLinks;
      const chatPayload = data.chat;
      const valueBlocksPayload = data.valueBlocks;
      const set: Record<string, unknown> = {
        title: data.title,
        description: data.description,
        subtitle: data.subtitle,
        summary: data.summary,
        contentEncoded: data.contentEncoded,
        slug: finalSlug,
        seasonNumber: data.seasonNumber,
        episodeNumber: data.episodeNumber,
        episodeType: data.episodeType,
        explicit: data.explicit,
        publishAt: publishAtValue,
        status: data.status,
        artworkUrl:
          data.artworkUrl !== undefined
            ? data.artworkUrl && String(data.artworkUrl).trim()
              ? data.artworkUrl
              : null
            : undefined,
        artworkPath: data.artworkUrl !== undefined ? null : undefined,
        episodeLink:
          data.episodeLink === ""
            ? null
            : data.episodeLink,
        guidIsPermalink: data.guidIsPermalink,
        subscriberOnly: data.subscriberOnly,
        updatedAt: sqlNow(),
      };
      const guidPayload = data.guid;
      if (guidPayload !== undefined && String(guidPayload).trim()) {
        set.guid = String(guidPayload).trim();
      }
      const jsonArrayOrNull = (payload: unknown[] | null | undefined) => {
        if (payload === undefined) return undefined;
        if (payload == null || payload.length === 0) return null;
        return JSON.stringify(payload);
      };
      if (finalMarkersPayload !== undefined) {
        set.finalMarkers = jsonArrayOrNull(finalMarkersPayload);
      }
      if (finalSoundbitesPayload !== undefined) {
        set.finalSoundbites = jsonArrayOrNull(finalSoundbitesPayload);
      }
      if (contentLinksPayload !== undefined) {
        set.contentLinks = jsonArrayOrNull(contentLinksPayload);
      }
      if (podcastTxtsPayload !== undefined) {
        set.podcastTxts = jsonArrayOrNull(podcastTxtsPayload);
      }
      if (socialInteractsPayload !== undefined) {
        set.socialInteracts = jsonArrayOrNull(socialInteractsPayload);
      }
      if (locationsPayload !== undefined) {
        set.locations = jsonArrayOrNull(locationsPayload);
      }
      if (licensePayload !== undefined) {
        set.license =
          licensePayload == null ||
          !String((licensePayload as { identifier?: string }).identifier ?? "").trim()
            ? null
            : JSON.stringify(licensePayload);
      }
      if (podcastImagesPayload !== undefined) {
        set.podcastImages = jsonArrayOrNull(podcastImagesPayload);
      }
      if (fundingLinksPayload !== undefined) {
        set.fundingLinks = jsonArrayOrNull(fundingLinksPayload);
      }
      if (chatPayload !== undefined) {
        set.chat =
          chatPayload == null ||
          !String((chatPayload as { server?: string }).server ?? "").trim() ||
          !String((chatPayload as { protocol?: string }).protocol ?? "").trim()
            ? null
            : JSON.stringify(chatPayload);
      }
      if (valueBlocksPayload !== undefined) {
        set.valueBlocks = jsonArrayOrNull(valueBlocksPayload);
      }
      const cleanSet: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(set)) {
        if (v !== undefined || v === null) cleanSet[k] = v;
      }
      if (Object.keys(cleanSet).length > 0) {
        repo.updateEpisode(id, cleanSet);
      }
      if (oldArtworkPath) {
        try {
          const dir = artworkDir(currentEpisode.podcastId);
          const safeOld = assertPathUnder(oldArtworkPath, dir);
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Episode not found" });
      const podcastId = row.podcastId;
      try {
        writeRssFile(podcastId, null);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      if (finalMarkersPayload !== undefined) {
        try {
          writeEpisodeChaptersJson(
            currentEpisode.podcastId,
            id,
            finalMarkersPayload as { time: number; title?: string; color?: string }[] | null,
          );
        } catch (_) {
          // non-fatal
        }
      }
      broadcastToEpisode(id, { type: "episodeUpdated" });
      return episodeRowWithFilename(row);
    },
  );

  app.delete(
    "/episodes/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Delete episode",
        description:
          "Permanently delete an episode and all associated data. Only podcast owners and administrators can delete. Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          204: { description: "Deleted" },
          400: { description: "Invalid id" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      try {
        assertSafeId(episodeId, "id");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (access.role !== "owner") {
        return reply
          .status(403)
          .send({
            error: "Only podcast owners and administrators can delete episodes.",
          });
      }
      const episodeRow = repo.getEpisodeForDelete(episodeId);
      if (!episodeRow)
        return reply.status(404).send({ error: "Episode not found" });
      const podcastId = episodeRow.podcastId;
      assertSafeId(podcastId, "podcastId");
      assertSafeId(episodeId, "episodeId");
      const segmentBase = uploadsDir(podcastId, episodeId);

      let bytesFreed = 0;
      const segments = repo.getSegmentAudioPaths(episodeId);
      for (const seg of segments) {
        const path = seg.audioPath ? resolveDataPath(seg.audioPath) : "";
        if (!path) continue;
        try {
          assertPathUnder(path, segmentBase);
          bytesFreed += statSync(path).size;
        } catch {
          /* best-effort */
        }
      }
      const audioSourcePath = episodeRow.audioSourcePath
        ? resolveDataPath(episodeRow.audioSourcePath)
        : "";
      if (audioSourcePath && existsSync(audioSourcePath)) {
        try {
          assertPathUnder(audioSourcePath, segmentBase);
          bytesFreed += statSync(audioSourcePath).size;
        } catch {
          /* best-effort */
        }
      }

      const procDir = join(getDataDir(), "processed", podcastId, episodeId);
      assertResolvedPathUnder(procDir, getDataDir());
      if (existsSync(procDir)) {
        try {
          rmSync(procDir, { recursive: true });
        } catch {
          /* best-effort */
        }
      }
      const uploadsEpisodeDir = join(getDataDir(), "uploads", podcastId, episodeId);
      assertResolvedPathUnder(uploadsEpisodeDir, getDataDir());
      if (existsSync(uploadsEpisodeDir)) {
        try {
          rmSync(uploadsEpisodeDir, { recursive: true });
        } catch {
          /* best-effort */
        }
      }
      const episodeArtPath = episodeRow.artworkPath
        ? resolveDataPath(episodeRow.artworkPath)
        : "";
      if (episodeArtPath && existsSync(episodeArtPath)) {
        try {
          const artDir = artworkDir(podcastId);
          assertPathUnder(episodeArtPath, artDir);
          unlinkSync(episodeArtPath);
        } catch {
          /* best-effort */
        }
      }

      const storageUserId = getPodcastOwnerId(podcastId) ?? request.userId;
      if (bytesFreed > 0 && storageUserId) {
        drizzleDb
          .update(users)
          .set({
            diskBytesUsed: sql`CASE WHEN COALESCE(${users.diskBytesUsed}, 0) - ${bytesFreed} < 0 THEN 0 ELSE COALESCE(${users.diskBytesUsed}, 0) - ${bytesFreed} END`,
          })
          .where(eq(users.id, storageUserId))
          .run();
      }

      repo.deleteEpisodeCast(episodeId);
      repo.deleteEpisode(episodeId);

      try {
        writeRssFile(podcastId, null);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, null);
      } catch (_) {
        /* non-fatal */
      }

      return reply.status(204).send();
    },
  );
}
