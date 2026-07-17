import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from "fs";
import { dirname, join, extname } from "path";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  getDataDir,
  processedDir,
  resolveDataPath,
  segmentPath,
  transcriptSrtPath,
  uploadsDir,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { readSettings, isTranscriptionProviderConfigured } from "../settings/index.js";
import {
  segmentEpisodeSegmentIdParamSchema,
  segmentEpisodeIdOnlyParamSchema,
  segmentTranscriptBodySchema,
  segmentEpisodeTranscriptBodySchema,
  segmentTranscriptGenerateQuerySchema,
  segmentTranscriptDeleteQuerySchema,
} from "@harborfm/shared";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import * as repo from "./repo.js";
import {
  transcriptPath,
  sanitizeTranscriptText,
  validateTranscriptContent,
  runTranscription,
  transcriptStatusByEpisode,
  transcriptErrorByEpisode,
  transcriptStatusBySegment,
  transcriptErrorBySegment,
  parseSrt,
  parseSrtTime,
  removeSrtEntryAndAdjustTimings,
} from "./utils.js";

export async function registerTranscriptRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get segment transcript",
        description: "Returns transcript text for a segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "text" },
          400: { description: "Validation failed" },
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
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      if (!existsSync(txtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      assertPathUnder(txtPath, audio.base);
      const text = readFileSync(txtPath, "utf-8");
      return reply.send({ text });
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "whisper", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Generate segment transcript",
        description:
          "Start transcription on segment audio. Returns 202; poll GET .../transcript-status until done or failed. Query regenerate=true to force regenerate. If transcript exists and regenerate is not set, returns 200 with existing text.",
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
          properties: { regenerate: { type: "string" } },
        },
        response: {
          200: { description: "Existing transcript text (when regenerate not set)" },
          202: {
            description: "Transcription started",
            type: "object",
            properties: { status: { type: "string", enum: ["transcribing"] } },
            required: ["status"],
          },
          409: {
            description: "Transcription already in progress",
            type: "object",
            properties: { status: { type: "string" }, message: { type: "string" } },
          },
          400: { description: "ASR not configured" },
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
      const queryParsed = segmentTranscriptGenerateQuerySchema.safeParse(request.query);
      const regenerate = queryParsed.success ? queryParsed.data.regenerate === true : false;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      if (existsSync(txtPath) && !regenerate) {
        assertPathUnder(txtPath, audio.base);
        const text = readFileSync(txtPath, "utf-8");
        return reply.send({ text });
      }
      const settings = readSettings();
      if (!isTranscriptionProviderConfigured(settings)) {
        return reply
          .status(400)
          .send({
            error:
              "Set a transcription provider in Settings to generate transcripts.",
          });
      }
      if (!repo.getUserCanTranscribe(request.userId)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to use transcription." });
      }

      if (transcriptStatusBySegment.get(segmentId) === "transcribing") {
        return reply.status(409).send({
          status: "transcribing",
          message: "Transcript generation is already in progress.",
        });
      }
      transcriptStatusBySegment.set(segmentId, "transcribing");
      transcriptErrorBySegment.delete(segmentId);
      const audioPath = audio.path;
      const audioBase = audio.base;
      const log = request.log;
      setImmediate(() => {
        (async () => {
          try {
            const text = await runTranscription(audioPath, audioBase, settings);
            assertPathUnder(dirname(txtPath), audioBase);
            writeFileSync(txtPath, text, "utf-8");
            transcriptStatusBySegment.set(segmentId, "done");
            broadcastToEpisode(episodeId, {
              type: "segmentTranscriptGenerated",
              segmentId,
              status: "done",
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "CHUNK_TOO_LARGE") {
              transcriptErrorBySegment.set(
                segmentId,
                "Audio file is too large for the transcription service. Try a shorter section or increase the server upload limit.",
              );
            } else {
              log.error(err instanceof Error ? err : new Error(String(err)));
              transcriptErrorBySegment.set(
                segmentId,
                err instanceof Error
                  ? err.message
                  : "Transcription service failed. Check Settings and try again.",
              );
            }
            transcriptStatusBySegment.set(segmentId, "failed");
            broadcastToEpisode(episodeId, {
              type: "segmentTranscriptGenerated",
              segmentId,
              status: "failed",
              error: transcriptErrorBySegment.get(segmentId),
            });
          }
        })();
      });
      return reply.status(202).send({ status: "transcribing" });
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/transcript-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get segment transcript generation status",
        description:
          "Returns whether segment transcript generation is in progress, done, or failed. Poll after POST generate (202).",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: {
            description: "Transcript status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "transcribing", "done", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Validation failed" },
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
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const status = transcriptStatusBySegment.get(segmentId) ?? "idle";
      const error =
        status === "failed"
          ? (transcriptErrorBySegment.get(segmentId) ?? "Transcript generation failed")
          : undefined;
      if (status === "done" || status === "failed") {
        transcriptStatusBySegment.delete(segmentId);
        transcriptErrorBySegment.delete(segmentId);
      }
      return reply.send({ status, error });
    },
  );

  app.patch(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Update segment transcript",
        description: "Replace transcript text. Body: text.",
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
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        response: {
          200: { description: "Updated" },
          400: { description: "text required" },
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
      const bodyParsed = segmentTranscriptBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const transcriptText = bodyParsed.data.text;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      assertPathUnder(dirname(txtPath), audio.base);
      writeFileSync(txtPath, transcriptText, "utf-8");
      broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
      return reply.send({ text: transcriptText });
    },
  );

  app.delete(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Delete segment transcript",
        description: "Remove transcript file for segment.",
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
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const queryParsed = segmentTranscriptDeleteQuerySchema.safeParse(request.query);
      const entryIndex = queryParsed.success ? queryParsed.data.entryIndex : undefined;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      if (!existsSync(txtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      assertPathUnder(txtPath, audio.base);

      if (typeof entryIndex === "number") {
        const srtText = readFileSync(txtPath, "utf-8");
        const entries = parseSrt(srtText);

        if (entryIndex < 0 || entryIndex >= entries.length) {
          return reply
            .status(404)
            .send({ error: "Transcript entry not found" });
        }

        const entryToRemove = entries[entryIndex];
        const startSec = parseSrtTime(entryToRemove.start);
        const endSec = parseSrtTime(entryToRemove.end);
        const removedDurationSec = endSec - startSec;

        const isReusable = segment.type === "reusable";
        let workingSourcePath = audio.path;
        let workingBase = audio.base;
        let tempSourcePath: string | null = null;
        if (isReusable) {
          const ext = (
            extname(audio.path).replace(/^\./, "") || "mp3"
          ).toLowerCase();
          tempSourcePath = segmentPath(
            access.podcastId,
            episodeId,
            nanoid(),
            ext,
          );
          copyFileSync(audio.path, tempSourcePath);
          workingSourcePath = tempSourcePath;
          workingBase = uploadsDir(access.podcastId, episodeId);
        }
        const newAudioPath = isReusable
          ? segmentPath(access.podcastId, episodeId, nanoid(), "wav")
          : join(dirname(audio.path), `${nanoid()}.wav`);

        try {
          await audioService.removeSegmentAndExportToWav(
            workingSourcePath,
            workingBase,
            startSec,
            endSec,
            newAudioPath,
          );
          if (tempSourcePath && existsSync(tempSourcePath)) {
            unlinkSync(tempSourcePath);
          }

          const updatedSrt = removeSrtEntryAndAdjustTimings(
            entries,
            entryIndex,
            removedDurationSec,
          );
          const newTxtPath = transcriptPath(newAudioPath);
          writeFileSync(newTxtPath, updatedSrt, "utf-8");

          if (!isReusable && audio.path !== newAudioPath) {
            unlinkSync(audio.path);
            if (txtPath !== newTxtPath && existsSync(txtPath)) {
              unlinkSync(txtPath);
            }
          }
          let newDurationSec = removedDurationSec;
          try {
            const probe = await audioService.probeAudio(
              newAudioPath,
              uploadsDir(access.podcastId, episodeId),
            );
            newDurationSec = probe.durationSec;
          } catch {
            newDurationSec = Math.max(
              0,
              ((segment.durationSec as number | undefined) ?? 0) -
                removedDurationSec,
            );
          }
          if (isReusable) {
            repo.updateSegmentToRecorded(segmentId, episodeId, newAudioPath, newDurationSec);
          } else {
            repo.updateSegmentAudio(segmentId, episodeId, newAudioPath, newDurationSec);
          }

          broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
          return reply.send({ text: updatedSrt });
        } catch (err) {
          try {
            if (existsSync(newAudioPath)) unlinkSync(newAudioPath);
          } catch {
            // ignore
          }
          request.log.error(err);
          return reply
            .status(500)
            .send({ error: "Failed to remove segment from audio" });
        }
      } else {
        assertPathUnder(txtPath, audio.base);
        unlinkSync(txtPath);
        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        return reply.status(204).send();
      }
    },
  );

  app.get(
    "/episodes/:episodeId/transcript",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get episode transcript",
        description:
          "Returns the final episode transcript (SRT text) if it exists.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Transcript text",
            body: { type: "object", properties: { text: { type: "string" } } },
          },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const row = repo.getEpisodeForTranscript(episodeId);
      if (!row || !row.audioFinalPath)
        return reply.status(404).send({ error: "Episode has no final audio" });
      const srtPath = transcriptSrtPath(row.podcastId, episodeId);
      if (!existsSync(srtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      assertPathUnder(srtPath, processedDir(row.podcastId, episodeId));
      const text = readFileSync(srtPath, "utf-8");
      return reply.send({ text });
    },
  );

  app.patch(
    "/episodes/:episodeId/transcript",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Update episode transcript",
        description:
          "Replace the final episode transcript text. Requires owner or editor and account not read-only or disabled.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        body: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        response: {
          200: { description: "Updated" },
          400: { description: "text required" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId } = paramsParsed.data;
      const bodyParsed = segmentEpisodeTranscriptBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const transcriptText = sanitizeTranscriptText(bodyParsed.data.text);
      const validationError = validateTranscriptContent(transcriptText);
      if (validationError) {
        return reply.status(400).send({ error: validationError });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({
            error: "You do not have permission to edit the transcript.",
          });
      const row = repo.getEpisodeForTranscript(episodeId);
      if (!row || !row.audioFinalPath)
        return reply.status(404).send({ error: "Episode has no final audio" });
      const procDir = processedDir(row.podcastId, episodeId);
      const srtPath = transcriptSrtPath(row.podcastId, episodeId);
      assertResolvedPathUnder(srtPath, procDir);
      writeFileSync(srtPath, transcriptText, "utf-8");
      return reply.send({ text: transcriptText });
    },
  );

  app.get(
    "/episodes/:episodeId/transcript-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get transcript generation status",
        description:
          "Returns whether transcript generation is in progress, done, or failed. Poll after POST generate-transcript (202).",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Transcript status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "transcribing", "done", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Validation failed" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const status = transcriptStatusByEpisode.get(episodeId) ?? "idle";
      const error =
        status === "failed"
          ? (transcriptErrorByEpisode.get(episodeId) ?? "Transcript generation failed")
          : undefined;
      if (status === "done" || status === "failed") {
        transcriptStatusByEpisode.delete(episodeId);
        transcriptErrorByEpisode.delete(episodeId);
      }
      return reply.send({ status, error });
    },
  );

  app.post(
    "/episodes/:episodeId/generate-transcript",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Generate episode transcript",
        description:
          "Start transcription (Whisper or OpenAI) on the final episode audio. Returns 202; poll GET /episodes/:episodeId/transcript-status until done or failed.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          202: {
            description: "Transcription started",
            type: "object",
            properties: { status: { type: "string", enum: ["transcribing"] } },
            required: ["status"],
          },
          409: {
            description: "Transcription already in progress",
            type: "object",
            properties: { status: { type: "string" }, message: { type: "string" } },
          },
          400: { description: "Transcription not configured" },
          403: { description: "Permission denied" },
          404: { description: "Episode or final audio not found" },
          413: { description: "Audio too large for transcription" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit this episode." });
      const row = repo.getEpisodeForTranscript(episodeId);
      if (!row || !row.audioFinalPath)
        return reply.status(404).send({ error: "Episode has no final audio" });
      const audioPath = resolveDataPath(row.audioFinalPath);
      if (!existsSync(audioPath))
        return reply.status(404).send({ error: "Final audio file not found" });
      const { podcastId } = access;
      const procDir = processedDir(podcastId, episodeId);
      assertPathUnder(audioPath, getDataDir());
      const settings = readSettings();
      if (!isTranscriptionProviderConfigured(settings)) {
        return reply
          .status(400)
          .send({
            error:
              "Set a transcription provider in Settings to generate transcripts.",
          });
      }
      if (!repo.getUserCanTranscribe(request.userId)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to use transcription." });
      }

      if (transcriptStatusByEpisode.get(episodeId) === "transcribing") {
        return reply.status(409).send({
          status: "transcribing",
          message: "Transcript generation is already in progress.",
        });
      }
      transcriptStatusByEpisode.set(episodeId, "transcribing");
      transcriptErrorByEpisode.delete(episodeId);
      const log = request.log;
      setImmediate(() => {
        (async () => {
          try {
            const text = await runTranscription(audioPath, procDir, settings);
            const srtPath = transcriptSrtPath(podcastId, episodeId);
            assertResolvedPathUnder(srtPath, getDataDir());
            writeFileSync(srtPath, text, "utf-8");
            transcriptStatusByEpisode.set(episodeId, "done");
            broadcastToEpisode(episodeId, { type: "transcriptGenerated", status: "done" });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "CHUNK_TOO_LARGE") {
              transcriptErrorByEpisode.set(
                episodeId,
                "Audio file is too large for the transcription service. Try a shorter episode or increase the server upload limit.",
              );
            } else {
              log.error(err);
              transcriptErrorByEpisode.set(
                episodeId,
                err instanceof Error ? err.message : "Transcript generation failed",
              );
            }
            transcriptStatusByEpisode.set(episodeId, "failed");
            broadcastToEpisode(episodeId, {
              type: "transcriptGenerated",
              status: "failed",
              error: transcriptErrorByEpisode.get(episodeId),
            });
          }
        })();
      });
      return reply.status(202).send({ status: "transcribing" });
    },
  );
}
