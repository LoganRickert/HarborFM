import type { FastifyInstance } from "fastify";
import { existsSync, statSync, unlinkSync } from "fs";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  canAccessEpisode,
  canEditSegments,
  canUseAssetInSegment,
  getPodcastOwnerId,
} from "../../services/access.js";
import {
  assertPathUnder,
  resolveDataPath,
  pathRelativeToData,
  segmentPath,
  uploadsDir,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import {
  FileTooLargeError,
  streamToFileWithLimit,
  extensionFromAudioMimetype,
} from "../../services/uploads.js";
import { drizzleDb } from "../../db/index.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { SEGMENT_UPLOAD_MAX_BYTES } from "../../config.js";
import {
  segmentEpisodeIdParamSchema,
  segmentEpisodeSegmentIdParamSchema,
  segmentCreateReusableBodySchema,
  segmentReorderBodySchema,
  segmentUpdateBodySchema,
} from "@harborfm/shared";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { recoverRecordedSegment } from "../../services/segmentFromRecording.js";
import { redactSegmentForClient } from "../../utils/segment.js";
import * as repo from "./repo.js";
import { ALLOWED_MIME, transcriptPath, waveformPath } from "./utils.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:id/segments",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "List segments",
        description: "List segments for an episode (recorded and reusable).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "List of segments" },
          400: { description: "Validation failed" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const rows = repo.listSegmentsForEpisode(episodeId);
      const segments = rows.map((row) => {
        const audio = repo.getSegmentAudioPath(row, access.podcastId, episodeId);
        const waveformExists =
          audio && existsSync(audio.path)
            ? existsSync(waveformPath(audio.path))
            : false;
        return redactSegmentForClient({
          ...row,
          waveformExists,
        });
      });
      return { segments };
    },
  );

  app.post(
    "/episodes/:id/segments",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Add segment",
        description:
          "Add segment: JSON type=reusable + reusableAssetId, or multipart audio for recorded.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          201: { description: "Created segment" },
          400: { description: "Validation failed" },
          403: { description: "Storage limit" },
          404: { description: "Episode or asset not found" },
          500: { description: "Upload or process failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const { podcastId } = access;

      const contentType = (request.headers["content-type"] || "").toLowerCase();
      if (contentType.includes("application/json")) {
        const bodyParsed = segmentCreateReusableBodySchema.safeParse(request.body);
        if (!bodyParsed.success) {
          return reply
            .status(400)
            .send({
              error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
              details: bodyParsed.error.flatten(),
            });
        }
        const body = bodyParsed.data;
        if (body.type === "reusable" && body.reusableAssetId) {
          if (
            !canUseAssetInSegment(
              request.userId,
              body.reusableAssetId,
              podcastId,
            )
          ) {
            return reply.status(404).send({ error: "Library asset not found" });
          }
          const asset = repo.getReusableAssetName(body.reusableAssetId);
          if (!asset)
            return reply.status(404).send({ error: "Library asset not found" });
          const pos = repo.getMaxPosition(episodeId);
          const id = nanoid();
          const assetRow = repo.getReusableAssetDuration(body.reusableAssetId);
          const segmentName =
            (body.name && String(body.name).trim()) || asset.name;
          repo.insertSegmentReusable({
            id,
            episodeId,
            position: pos,
            name: segmentName,
            reusableAssetId: body.reusableAssetId,
            durationSec: assetRow?.durationSec ?? 0,
          });
          const row = repo.getSegmentById(id, episodeId);
          if (!row)
            return reply.status(500).send({ error: "Failed to fetch created segment" });
          broadcastToEpisode(episodeId, {
            type: "segmentAdded",
            segment: redactSegmentForClient(row),
          });
          return reply.status(201).send(redactSegmentForClient(row));
        }
      }

      const data = await request.file();
      if (!data) {
        return reply
          .status(400)
          .send({
            error:
              "Send multipart file for recorded segment or JSON body type=reusable with reusableAssetId",
          });
      }

      const mimetype = data.mimetype || "";
      if (!ALLOWED_MIME.includes(mimetype) && !mimetype.startsWith("audio/")) {
        return reply
          .status(400)
          .send({ error: "Invalid file type. Use WAV, MP3, or WebM." });
      }
      const segmentName =
        (data.fields?.name as { value?: string })?.value?.trim() || null;
      const ext = extensionFromAudioMimetype(mimetype);
      const segmentId = nanoid();
      const destPath = segmentPath(podcastId, episodeId, segmentId, ext);
      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(
          data.file,
          destPath,
          SEGMENT_UPLOAD_MAX_BYTES,
        );
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: "File too large" });
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Upload failed" });
      }

      const storageUserId = getPodcastOwnerId(podcastId) ?? request.userId;
      if (wouldExceedStorageLimit(drizzleDb, storageUserId, bytesWritten)) {
        try {
          unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        return reply.status(403).send({
          error:
            "You have reached your storage limit. Delete some content to free space.",
        });
      }

      const segmentBase = uploadsDir(podcastId, episodeId);
      let finalPath = destPath;
      try {
        const normalized = await audioService.normalizeUploadToMp3OrWav(
          destPath,
          ext,
          segmentBase,
        );
        finalPath = normalized.path;
        bytesWritten = statSync(finalPath).size;
      } catch (err) {
        request.log.error(err);
        return reply
          .status(500)
          .send({ error: "Failed to process audio file" });
      }

      try {
        await audioService.generateWaveformFile(finalPath, segmentBase);
      } catch (err) {
        request.log.warn(
          { err, finalPath },
          "Waveform generation failed (upload succeeded)",
        );
      }

      let durationSec = 0;
      try {
        const probe = await audioService.probeAudio(finalPath, segmentBase);
        durationSec = Math.max(0, probe.durationSec);
      } catch {
        // keep 0 if probe fails
      }

      const pos = repo.getMaxPosition(episodeId);
      repo.insertSegmentRecorded({
        id: segmentId,
        episodeId,
        position: pos,
        name: segmentName ?? "",
        audioPath: pathRelativeToData(finalPath),
        durationSec,
      });

      repo.addUserDiskBytes(storageUserId, bytesWritten);

      const row = repo.getSegmentById(segmentId, episodeId);
      broadcastToEpisode(episodeId, {
        type: "segmentAdded",
        segment: redactSegmentForClient(row as Record<string, unknown>),
      });
      return reply.status(201).send(redactSegmentForClient(row as Record<string, unknown>));
    },
  );

  app.put(
    "/episodes/:id/segments/reorder",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Reorder segments",
        description: "Set segment order by array of segment_ids.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            segmentIds: { type: "array", items: { type: "string" } },
          },
          required: ["segmentIds"],
        },
        response: {
          200: { description: "Updated segments list" },
          400: { description: "segment_ids required" },
          403: { description: "Permission denied" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const bodyParsed = segmentReorderBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const ids = bodyParsed.data.segmentIds;
      repo.reorderSegments(episodeId, ids);
      const rows = repo.listSegmentsForEpisode(episodeId);
      const segments = rows.map((row) => {
        const audio = repo.getSegmentAudioPath(row, access.podcastId, episodeId);
        const waveformExists =
          audio && existsSync(audio.path)
            ? existsSync(waveformPath(audio.path))
            : false;
        return redactSegmentForClient({
          ...row,
          waveformExists,
        });
      });
      broadcastToEpisode(episodeId, { type: "segmentReordered" });
      return { segments };
    },
  );

  app.patch(
    "/episodes/:episodeId/segments/:segmentId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Update segment",
        description: "Update segment name, trimRanges, markers, and/or audioEq. Partial update supported.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: ["string", "null"] },
            trimRanges: { type: "array", items: { type: "array", items: { type: "number" } } },
            markers: { type: "array", items: { type: "object", properties: { time: { type: "number" }, title: { type: "string" } } } },
            audioEq: {
              type: ["object", "null"],
              properties: { lowDb: { type: "number" }, midDb: { type: "number" }, highDb: { type: "number" } },
            },
          },
        },
        response: {
          200: { description: "Updated segment" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const bodyParsed = segmentUpdateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const body = bodyParsed.data;
      const hasUpdates =
        body.name !== undefined ||
        body.trimRanges !== undefined ||
        body.markers !== undefined ||
        body.audioEq !== undefined;
      if (!hasUpdates) {
        return reply.status(400).send({ error: "At least one of name, trimRanges, markers, or audioEq must be provided" });
      }
      const row = repo.getSegmentDuration(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      const durationSec = row.durationSec;

      let trimRangesJson: string | null = null;
      if (body.trimRanges !== undefined) {
        const ranges = Array.isArray(body.trimRanges) ? body.trimRanges : [];
        if (ranges.length > 0) {
          for (const [start, end] of ranges) {
            if (start < 0 || end > durationSec || start >= end) {
              return reply.status(400).send({ error: "Invalid trimRanges: each [start, end] must satisfy 0 <= start < end <= durationSec" });
            }
          }
          trimRangesJson = JSON.stringify(ranges);
        }
      }

      let markersJson: string | null = null;
      if (body.markers !== undefined) {
        const markers = Array.isArray(body.markers) ? body.markers : [];
        if (markers) {
          for (const m of markers) {
            if (m.time < 0 || m.time > durationSec) {
              return reply.status(400).send({ error: "Invalid markers: each time must satisfy 0 <= time <= duration_sec" });
            }
          }
          markersJson = JSON.stringify(markers);
        }
      }

      let audioEqJson: string | null = null;
      if (body.audioEq !== undefined) {
        if (body.audioEq === null) {
          audioEqJson = null;
        } else {
          const eq = body.audioEq as { lowDb?: number; midDb?: number; highDb?: number };
          for (const key of ["lowDb", "midDb", "highDb"] as const) {
            const v = eq[key];
            if (v !== undefined && (typeof v !== "number" || v < -20 || v > 20)) {
              return reply.status(400).send({ error: `Invalid audioEq.${key}: must be a number between -20 and 20` });
            }
          }
          const hasAny = eq.lowDb !== undefined || eq.midDb !== undefined || eq.highDb !== undefined;
          audioEqJson = hasAny ? JSON.stringify(eq) : null;
        }
      }

      const name =
        body.name === undefined
          ? undefined
          : body.name === null || body.name === ""
            ? null
            : String(body.name).trim();

      if (name !== undefined) {
        repo.updateSegmentName(segmentId, episodeId, name);
      }
      if (trimRangesJson !== null) {
        repo.updateSegmentTrimRanges(segmentId, episodeId, trimRangesJson);
      }
      if (markersJson !== null) {
        repo.updateSegmentMarkers(segmentId, episodeId, markersJson);
      }
      if (body.audioEq !== undefined) {
        repo.updateSegmentAudioEq(segmentId, episodeId, audioEqJson);
      }

      broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
      const updated = repo.getSegmentById(segmentId, episodeId);
      return redactSegmentForClient(updated as Record<string, unknown>);
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/recover",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Recover failed recording",
        description: "Try to recover a record_failed segment from the WebRTC recordings directory.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Segment recovered successfully" },
          400: { description: "Recovery failed" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply.status(403).send({ error: "You do not have permission to edit segments." });
      const row = repo.getSegmentById(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      try {
        const updated = await recoverRecordedSegment(segmentId);
        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        return reply.send(redactSegmentForClient(updated));
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Recovery failed" });
      }
    },
  );

  app.delete(
    "/episodes/:episodeId/segments/:segmentId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Delete segment",
        description: "Permanently delete a segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          204: { description: "Deleted" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const row = repo.getSegmentById(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      const pathRaw = row.audioPath as string | null;
      const path = pathRaw ? resolveDataPath(pathRaw) : "";
      let bytesFreed = 0;
      if (path && existsSync(path)) {
        const base = uploadsDir(access.podcastId, episodeId);
        assertPathUnder(path, base);
        try {
          bytesFreed = statSync(path).size;
        } catch {
          bytesFreed = 0;
        }
        unlinkSync(path);
        const txtPath = transcriptPath(path);
        if (existsSync(txtPath)) {
          try {
            assertPathUnder(txtPath, base);
            unlinkSync(txtPath);
          } catch {
            // ignore if transcript path escapes base
          }
        }
      }
      repo.deleteSegment(segmentId, episodeId);

      const storageUserId =
        getPodcastOwnerId(access.podcastId) ?? request.userId;
      if (bytesFreed > 0) {
        repo.subtractUserDiskBytes(storageUserId, bytesFreed);
      }

      broadcastToEpisode(episodeId, { type: "segmentDeleted", segmentId });
      return reply.status(204).send();
    },
  );
}
