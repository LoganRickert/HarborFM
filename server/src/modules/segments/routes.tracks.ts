import type { FastifyInstance } from "fastify";
import { dirname, basename } from "path";
import send from "@fastify/send";
import {
  segmentEpisodeSegmentIdParamSchema,
  segmentTracksPutBodySchema,
} from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import { assertPathUnder } from "../../services/paths.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import { findMultitrackDir } from "../episodes/projectSegmentPack.js";
import * as repo from "./repo.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { addSegmentTrackMedia } from "../../services/addSegmentTrackMedia.js";
import {
  getApplySegmentClipsJobStatus,
  readSegmentTracks,
  readTakeWaveformJson,
  ensureTakeWaveformJson,
  resolveTakeAudioAbsPath,
  saveSegmentTracksClips,
  startRemakeSegmentTracksJob,
} from "../../services/applySegmentClipsRemake.js";
import {
  BootstrapMultitrackError,
  bootstrapSegmentMultitrackFromMix,
} from "../../services/bootstrapSegmentMultitrackFromMix.js";

export async function registerTracksRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:episodeId/segments/:segmentId/tracks",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "List multitrack clips for advanced editor",
        description:
          "Returns tracks_manifest clips and take summaries for the segment recordings folder.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      const row = repo.getSegmentById(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      const tracks = readSegmentTracks({
        podcastId: access.podcastId,
        episodeId,
        segmentId,
      });
      if (!tracks) {
        return reply.status(404).send({
          error: "No multitrack recordings for this segment",
        });
      }
      return reply.send({
        clips: tracks.clips,
        takes: tracks.takes,
        timelineDurationMs: tracks.timelineDurationMs,
      });
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/tracks/waveform",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get take waveform JSON",
        description:
          "Returns audiowaveform JSON for a take file in the segment recordings folder. Query file=host.mp3",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        querystring: {
          type: "object",
          properties: { file: { type: "string" } },
          required: ["file"],
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      const file =
        typeof (request.query as { file?: string }).file === "string"
          ? (request.query as { file: string }).file
          : "";
      if (!file.trim()) {
        return reply.status(400).send({ error: "file query is required" });
      }
      // Prefer existing sidecar; only generate when missing.
      const existing = readTakeWaveformJson({
        podcastId: access.podcastId,
        episodeId,
        segmentId,
        filePath: file,
      });
      if (existing) {
        return reply.type("application/json").send(existing);
      }
      const json = await ensureTakeWaveformJson({
        podcastId: access.podcastId,
        episodeId,
        segmentId,
        filePath: file,
      });
      if (!json) {
        return reply.status(404).send({ error: "Waveform not found" });
      }
      return reply.type("application/json").send(json);
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/tracks/stream",
    {
      // Scrubbing issues many Range GETs; do not share the global API budget.
      config: {
        rateLimit: false,
      },
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Stream take audio",
        description:
          "Stream a take file from the segment recordings folder. Query file=host.mp3. Supports Range requests. Not subject to the global API rate limit (authenticated editor scrubbing).",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        querystring: {
          type: "object",
          properties: { file: { type: "string" } },
          required: ["file"],
        },
        response: {
          200: { description: "Audio stream" },
          206: { description: "Partial content" },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
          500: { description: "Send error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      const file =
        typeof (request.query as { file?: string }).file === "string"
          ? (request.query as { file: string }).file
          : "";
      if (!file.trim()) {
        return reply.status(400).send({ error: "file query is required" });
      }
      const abs = resolveTakeAudioAbsPath({
        podcastId: access.podcastId,
        episodeId,
        segmentId,
        filePath: file,
      });
      if (!abs) {
        return reply.status(404).send({ error: "Take audio not found" });
      }
      const mtDir = findMultitrackDir(access.podcastId, episodeId, segmentId);
      if (!mtDir) {
        return reply.status(404).send({ error: "Take audio not found" });
      }
      const safePath = assertPathUnder(abs, mtDir);
      const contentType = contentTypeFromAudioPath(safePath);

      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        acceptRanges: true,
        cacheControl: false,
      });

      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        return reply
          .status((err.status ?? 500) as 404 | 500)
          .send({ error: err.message ?? "Internal Server Error" });
      }

      reply.status(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply
        .header("Content-Type", contentType)
        .header("Cache-Control", "private, no-transform");
      return reply.send(result.stream);
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/tracks/apply-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Apply clips remake job status",
        description: "Poll after POST tracks/remake (202) until done or failed.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      return reply.send(getApplySegmentClipsJobStatus(segmentId));
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/tracks/bootstrap-from-mix",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Bootstrap advanced editor from mix audio",
        description:
          "Copies the segment mix audio and waveform into a single-track recordings folder so the advanced editor can open. Charges the podcast owner for the copied take and waveform. Idempotent when multitrack already exists.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      }
      try {
        const result = await bootstrapSegmentMultitrackFromMix({
          podcastId: access.podcastId,
          episodeId,
          segmentId,
        });
        if (!result.alreadyExisted) {
          broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        }
        return reply.send({
          hasRecordings: true,
          alreadyExisted: result.alreadyExisted,
          bytesAdded: result.bytesAdded,
          takeFile: result.takeFile || undefined,
        });
      } catch (err: unknown) {
        if (err instanceof BootstrapMultitrackError) {
          return reply.status(err.statusCode as 400 | 403 | 404 | 500).send({
            error: err.message,
          });
        }
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Failed to bootstrap advanced editor from mix audio";
        return reply.status(500).send({ error: message });
      }
    },
  );

  app.put(
    "/episodes/:episodeId/segments/:segmentId/tracks",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Save advanced editor clips",
        description:
          "Writes tracks_manifest.json from the clip list without remaking the mix. Backs up tracks_manifest.json.original once when missing (same as OTIO/Reaper import).",
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
            clips: { type: "array", items: { type: "object" } },
          },
          required: ["clips"],
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      }
      const bodyParsed = segmentTracksPutBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
          details: bodyParsed.error.flatten(),
        });
      }
      const row = repo.getSegmentById(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      const mtDir = findMultitrackDir(access.podcastId, episodeId, segmentId);
      if (!mtDir) {
        return reply.status(400).send({
          error: "Advanced clip editing requires multitrack recordings",
        });
      }
      try {
        const saved = saveSegmentTracksClips({
          podcastId: access.podcastId,
          episodeId,
          segmentId,
          clips: bodyParsed.data.clips,
        });
        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        return reply.send({
          clips: saved.clips,
          timelineDurationMs: saved.timelineDurationMs,
          originalBackedUp: saved.originalBackedUp,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message ? err.message : "Failed to save clips";
        const safe =
          message.startsWith("No multitrack") ||
          message.startsWith("Clip media") ||
          message.startsWith("Invalid clip") ||
          message.startsWith("At least one")
            ? message
            : "Failed to save clips";
        return reply.status(400).send({ error: safe });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/tracks/media",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Add take media for advanced editor",
        description:
          "Upload audio (multipart file + optional trackName) or copy a library asset (JSON { libraryAssetId, trackName }). Returns filePath + durationMs for inserting a clip.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          201: { description: "Media added" },
          400: { description: "Validation failed" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          500: { description: "Server error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      }
      const row = repo.getSegmentById(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      const mtDir = findMultitrackDir(access.podcastId, episodeId, segmentId);
      if (!mtDir) {
        return reply.status(400).send({
          error: "Advanced clip editing requires multitrack recordings",
        });
      }

      const ct = String(request.headers["content-type"] ?? "");
      let libraryAssetId: string | null = null;
      let trackName: string | null = null;
      let upload: {
        file: NodeJS.ReadableStream;
        mimetype: string;
        filename?: string;
      } | null = null;

      if (ct.includes("application/json")) {
        const body = (request.body ?? {}) as {
          libraryAssetId?: unknown;
          trackName?: unknown;
        };
        libraryAssetId =
          typeof body.libraryAssetId === "string"
            ? body.libraryAssetId.trim() || null
            : null;
        trackName =
          typeof body.trackName === "string"
            ? body.trackName.trim() || null
            : null;
      } else {
        const data = await request.file();
        if (data) {
          const fields = data.fields ?? {};
          const fieldStr = (key: string): string => {
            const f = fields[key] as { value?: string } | undefined;
            return typeof f?.value === "string" ? f.value : "";
          };
          libraryAssetId = fieldStr("libraryAssetId").trim() || null;
          trackName = fieldStr("trackName").trim() || null;
          upload = {
            file: data.file,
            mimetype: data.mimetype || "",
            filename: data.filename,
          };
        }
      }

      try {
        const result = await addSegmentTrackMedia({
          podcastId: access.podcastId,
          episodeId,
          segmentId,
          userId: request.userId as string,
          trackName,
          libraryAssetId,
          upload,
        });
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Failed to add track media";
        const status =
          message.includes("not found")
            ? 404
            : message.startsWith("Invalid") ||
                message.startsWith("Upload") ||
                message.startsWith("File too") ||
                message.startsWith("No multitrack")
              ? 400
              : 500;
        return reply.status(status as 400 | 404 | 500).send({ error: message });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/tracks/remake",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Remake mix from saved advanced editor clips",
        description:
          "Remakes the segment mix from the current tracks_manifest.json. Returns 202; poll GET tracks/apply-status. Save clip edits with PUT tracks first.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      }
      const row = repo.getSegmentById(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      const mtDir = findMultitrackDir(access.podcastId, episodeId, segmentId);
      if (!mtDir) {
        return reply.status(400).send({
          error: "Advanced clip editing requires multitrack recordings",
        });
      }
      const started = startRemakeSegmentTracksJob({
        podcastId: access.podcastId,
        episodeId,
        segmentId,
        onSuccess: () => {
          broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        },
      });
      if (!started) {
        return reply.status(409).send({
          status: "remaking",
          message: "Clip remake already in progress",
        });
      }
      return reply.status(202).send({ status: "remaking" });
    },
  );
}
