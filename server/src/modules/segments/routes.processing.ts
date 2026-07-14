import type { FastifyInstance } from "fastify";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, extname, basename } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import { assertPathUnder, assertResolvedPathUnder, pathRelativeToData, segmentPath } from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { FFMPEG_PATH } from "../../config.js";
import {
  segmentEpisodeSegmentIdParamSchema,
  segmentTrimBodySchema,
  segmentRemoveSilenceBodySchema,
  segmentNoiseSuppressionBodySchema,
  segmentSplitBodySchema,
} from "@harborfm/shared";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import * as repo from "./repo.js";
import {
  transcriptPath,
  parseSrt,
  parseSrtTime,
  formatSrtTime,
  adjustSrtEntriesForWindow,
  formatSrtEntries,
  partitionMarkersAtSplit,
  partitionTrimRangesAtSplit,
  type SrtEntry,
} from "./utils.js";
import { redactSegmentForClient } from "../../utils/segment.js";

const exec = promisify(execFile);

export async function registerProcessingRoutes(app: FastifyInstance) {
  app.post(
    "/episodes/:episodeId/segments/:segmentId/trim",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Trim segment",
        description:
          "Trim segment to start/end seconds. Body: startSec, endSec.",
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
            startSec: { type: "number" },
            endSec: { type: "number" },
          },
        },
        response: {
          200: { description: "Updated segment" },
          204: { description: "Trimmed" },
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
      const bodyParsed = segmentTrimBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const startSec = bodyParsed.data.startSec;
      const endSec = bodyParsed.data.endSec;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      let segment: Record<string, unknown> | undefined = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });

      if (segment.type === "reusable") {
        try {
          segment = await repo.promoteReusableSegmentToRecorded(
            segment,
            episodeId,
            access.podcastId,
          );
        } catch (err) {
          request.log.error(err);
          return reply
            .status(500)
            .send({
              error:
                err instanceof Error ? err.message : "Failed to prepare segment for editing",
            });
        }
      } else if (segment.type !== "recorded") {
        return reply
          .status(400)
          .send({ error: "Only recorded or library segments can be trimmed" });
      }

      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);

      const probe = await audioService.probeAudio(audio.path, audio.base);
      const currentDurationSec = probe.durationSec;
      const newStartSec = startSec ?? 0;
      const newEndSec = endSec ?? currentDurationSec;

      if (
        newStartSec < 0 ||
        newEndSec <= newStartSec ||
        newEndSec > currentDurationSec
      ) {
        return reply.status(400).send({ error: "Invalid trim range" });
      }

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const tempPath = join(tmpdir(), `${nanoid()}.wav`);
      const outputExt = ".wav";
      const finalPath = join(
        dir,
        basename(audio.path, extname(audio.path)) + outputExt,
      );

      try {
        await audioService.trimAudioToWav(
          audio.path,
          audio.base,
          newStartSec,
          newEndSec,
          tempPath,
        );

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error("Trimmed audio file was not created or is empty");
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPath },
            "Waveform generation failed after trim",
          );
        }

        const txtPath = transcriptPath(audio.path);
        if (existsSync(txtPath)) {
          assertPathUnder(txtPath, audio.base);
          const srtText = readFileSync(txtPath, "utf-8");
          const entries = parseSrt(srtText);

          const adjustedEntries = entries
            .map((entry) => {
              const entryStartSec = parseSrtTime(entry.start);
              const entryEndSec = parseSrtTime(entry.end);
              if (entryEndSec <= newStartSec || entryStartSec >= newEndSec)
                return null;
              const adjustedStart = Math.max(0, entryStartSec - newStartSec);
              const adjustedEnd = Math.min(
                newEndSec - newStartSec,
                entryEndSec - newStartSec,
              );
              return {
                ...entry,
                start: formatSrtTime(adjustedStart),
                end: formatSrtTime(adjustedEnd),
              };
            })
            .filter((e): e is SrtEntry => e !== null);

          const newTxtPath = transcriptPath(finalPath);
          const updatedSrt = adjustedEntries
            .map(
              (entry, i) =>
                `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`,
            )
            .join("\n");
          writeFileSync(newTxtPath, updatedSrt, "utf-8");
        }

        const newDurationSec = newEndSec - newStartSec;
        repo.updateSegmentAudio(segmentId, episodeId, finalPath, newDurationSec);

        if (audio.path !== finalPath) unlinkSync(audio.path);
        const txtPathToRemove = transcriptPath(audio.path);
        if (
          existsSync(txtPathToRemove) &&
          txtPathToRemove !== transcriptPath(finalPath)
        ) {
          unlinkSync(txtPathToRemove);
        }

        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Failed to trim audio" });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/remove-silence",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Remove silence",
        description:
          "Remove silence from segment. Body: threshold_db, min_silence_duration_sec.",
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
            threshold_db: { type: "number" },
            min_silence_duration_sec: { type: "number" },
          },
        },
        response: {
          200: { description: "Updated segment" },
          204: { description: "Done" },
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
      const bodyParsed = segmentRemoveSilenceBodySchema.safeParse(request.body);
      const thresholdSeconds =
        bodyParsed.success &&
        bodyParsed.data.thresholdSeconds !== undefined &&
        Number.isFinite(bodyParsed.data.thresholdSeconds)
          ? bodyParsed.data.thresholdSeconds
          : 0.5;
      const silenceThresholdDb =
        bodyParsed.success &&
        bodyParsed.data.silenceThreshold !== undefined &&
        Number.isFinite(bodyParsed.data.silenceThreshold)
          ? bodyParsed.data.silenceThreshold
          : -40;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      let segment: Record<string, unknown> | undefined = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });

      if (segment.type === "reusable") {
        try {
          segment = await repo.promoteReusableSegmentToRecorded(
            segment,
            episodeId,
            access.podcastId,
          );
        } catch (err) {
          request.log.error(err);
          return reply
            .status(500)
            .send({
              error:
                err instanceof Error ? err.message : "Failed to prepare segment for editing",
            });
        }
      } else if (segment.type !== "recorded") {
        return reply
          .status(400)
          .send({ error: "Only recorded or library segments can have silence removed" });
      }

      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const tempPath = join(tmpdir(), `${nanoid()}.wav`);
      const finalPath = join(
        dir,
        basename(audio.path, extname(audio.path)) + ".wav",
      );

      try {
        await audioService.removeSilenceFromWav(
          audio.path,
          audio.base,
          thresholdSeconds,
          silenceThresholdDb,
          tempPath,
        );

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error(
            "Audio file with silence removed was not created or is empty",
          );
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPath },
            "Waveform generation failed after remove-silence",
          );
        }

        const probe = await audioService.probeAudio(finalPath, audio.base);
        const newDurationSec = probe.durationSec;

        const txtPath = transcriptPath(audio.path);
        if (existsSync(txtPath)) {
          assertPathUnder(txtPath, audio.base);
          const srtText = readFileSync(txtPath, "utf-8");
          const entries = parseSrt(srtText);

          const { stderr } = await exec(
            FFMPEG_PATH,
            [
              "-i",
              audio.path,
              "-af",
              `silencedetect=noise=${silenceThresholdDb}dB:d=${thresholdSeconds}`,
              "-f",
              "null",
              "-",
            ],
            { maxBuffer: 10 * 1024 * 1024 },
          );

          const silencePeriods: Array<{ start: number; end: number }> = [];
          const lines = stderr.split("\n");
          let currentStart: number | null = null;

          for (const line of lines) {
            const startMatch = line.match(/silence_start:\s*([\d.]+)/);
            const endMatch = line.match(/silence_end:\s*([\d.]+)/);

            if (startMatch) {
              currentStart = parseFloat(startMatch[1]);
            }
            if (endMatch && currentStart !== null) {
              const end = parseFloat(endMatch[1]);
              const duration = end - currentStart;
              if (duration >= thresholdSeconds) {
                silencePeriods.push({ start: currentStart, end });
              }
              currentStart = null;
            }
          }

          const adjustedEntries = entries
            .map((entry) => {
              const entryStartSec = parseSrtTime(entry.start);
              const entryEndSec = parseSrtTime(entry.end);

              let removedBefore = 0;
              for (const silence of silencePeriods) {
                if (silence.end <= entryStartSec) {
                  removedBefore += silence.end - silence.start;
                } else if (
                  silence.start < entryStartSec &&
                  silence.end > entryStartSec
                ) {
                  removedBefore += entryStartSec - silence.start;
                }
              }

              let removedBeforeEnd = 0;
              for (const silence of silencePeriods) {
                if (silence.end <= entryEndSec) {
                  removedBeforeEnd += silence.end - silence.start;
                } else if (
                  silence.start < entryEndSec &&
                  silence.end > entryEndSec
                ) {
                  removedBeforeEnd += entryEndSec - silence.start;
                }
              }

              const adjustedStart = Math.max(0, entryStartSec - removedBefore);
              const adjustedEnd = Math.max(
                adjustedStart,
                entryEndSec - removedBeforeEnd,
              );

              return {
                ...entry,
                start: formatSrtTime(adjustedStart),
                end: formatSrtTime(adjustedEnd),
              };
            })
            .filter((e) => {
              const startSec = parseSrtTime(e.start);
              const endSec = parseSrtTime(e.end);
              return endSec > startSec && startSec >= 0;
            });

          const newTxtPath = transcriptPath(finalPath);
          const updatedSrt = adjustedEntries
            .map(
              (entry, i) =>
                `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`,
            )
            .join("\n");
          writeFileSync(newTxtPath, updatedSrt, "utf-8");
        }

        repo.updateSegmentAudio(segmentId, episodeId, finalPath, newDurationSec, {
          trimRanges: "[]",
          markers: "[]",
        });

        if (audio.path !== finalPath) unlinkSync(audio.path);
        const txtPathToRemove = transcriptPath(audio.path);
        if (
          existsSync(txtPathToRemove) &&
          txtPathToRemove !== transcriptPath(finalPath)
        ) {
          unlinkSync(txtPathToRemove);
        }

        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Failed to remove silence" });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/noise-suppression",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Noise suppression",
        description: "Apply noise suppression to segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Updated segment" },
          204: { description: "Done" },
          400: { description: "Only recorded segments" },
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
      const bodyParsed = segmentNoiseSuppressionBodySchema.safeParse(request.body);
      const nf = bodyParsed.success && bodyParsed.data.nf !== undefined && Number.isFinite(bodyParsed.data.nf)
        ? bodyParsed.data.nf
        : -25;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      let segment: Record<string, unknown> | undefined = repo.getSegmentById(segmentId, episodeId);
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });

      if (segment.type === "reusable") {
        try {
          segment = await repo.promoteReusableSegmentToRecorded(
            segment,
            episodeId,
            access.podcastId,
          );
        } catch (err) {
          request.log.error(err);
          return reply
            .status(500)
            .send({
              error:
                err instanceof Error ? err.message : "Failed to prepare segment for editing",
            });
        }
      } else if (segment.type !== "recorded") {
        return reply
          .status(400)
          .send({
            error: "Only recorded or library segments can have noise suppression applied",
          });
      }

      const audio = repo.getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const ext = extname(audio.path) || ".wav";
      const tempPath = join(tmpdir(), `${nanoid()}${ext}`);
      const finalPath = join(dir, basename(audio.path));

      try {
        await audioService.applyNoiseSuppressionToWav(
          audio.path,
          audio.base,
          nf,
          tempPath,
        );

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error(
            "Noise-suppressed audio file was not created or is empty",
          );
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPath },
            "Waveform generation failed after noise-suppression",
          );
        }

        const probe = await audioService.probeAudio(finalPath, audio.base);
        const newDurationSec = probe.durationSec;

        const oldTxtPath = transcriptPath(audio.path);
        const newTxtPath = transcriptPath(finalPath);
        if (existsSync(oldTxtPath)) {
          assertPathUnder(oldTxtPath, audio.base);
          copyFileSync(oldTxtPath, newTxtPath);
        }

        repo.updateSegmentAudio(segmentId, episodeId, finalPath, newDurationSec);

        if (audio.path !== finalPath) unlinkSync(audio.path);
        if (existsSync(oldTxtPath) && oldTxtPath !== newTxtPath)
          unlinkSync(oldTxtPath);

        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply
          .status(500)
          .send({ error: "Failed to apply noise suppression" });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/split",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Split segment",
        description:
          "Split segment audio at minutes+seconds into two segments. Body: minutes, seconds.",
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
            minutes: { type: "number" },
            seconds: { type: "number" },
          },
          required: ["minutes", "seconds"],
        },
        response: {
          204: { description: "Split complete" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(
        request.params,
      );
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error:
            paramsParsed.error.issues[0]?.message ?? "Validation failed",
          details: paramsParsed.error.flatten(),
        });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const bodyParsed = segmentSplitBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
          details: bodyParsed.error.flatten(),
        });
      }
      const splitSec =
        bodyParsed.data.minutes * 60 + bodyParsed.data.seconds;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });

      let segment: Record<string, unknown> | undefined = repo.getSegmentById(
        segmentId,
        episodeId,
      );
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      if (segment.inProgress)
        return reply
          .status(400)
          .send({ error: "Cannot split a segment while recording is in progress" });

      if (segment.type === "reusable") {
        try {
          segment = await repo.promoteReusableSegmentToRecorded(
            segment,
            episodeId,
            access.podcastId,
          );
        } catch (err) {
          request.log.error(err);
          return reply.status(500).send({
            error:
              err instanceof Error
                ? err.message
                : "Failed to prepare segment for editing",
          });
        }
      } else if (segment.type !== "recorded") {
        return reply
          .status(400)
          .send({ error: "Only recorded or library segments can be split" });
      }

      const audio = repo.getSegmentAudioPath(
        segment,
        access.podcastId,
        episodeId,
      );
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);

      const probe = await audioService.probeAudio(audio.path, audio.base);
      const currentDurationSec = probe.durationSec;
      if (
        !(splitSec > 0) ||
        !(splitSec < currentDurationSec) ||
        !Number.isFinite(splitSec)
      ) {
        return reply.status(400).send({
          error:
            "Split time must be greater than 0 and less than the segment duration",
        });
      }

      const durationA = splitSec;
      const durationB = currentDurationSec - splitSec;
      const newSegmentId = nanoid();
      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const finalPathA = join(
        dir,
        basename(audio.path, extname(audio.path)) + ".wav",
      );
      const finalPathB = segmentPath(
        access.podcastId,
        episodeId,
        newSegmentId,
        "wav",
      );
      // Output paths may not exist yet; use resolve-only check.
      assertResolvedPathUnder(finalPathA, audio.base);
      assertResolvedPathUnder(finalPathB, audio.base);

      const tempPathA = join(tmpdir(), `${nanoid()}.wav`);
      const tempPathB = join(tmpdir(), `${nanoid()}.wav`);

      try {
        await audioService.trimAudioToWav(
          audio.path,
          audio.base,
          0,
          splitSec,
          tempPathA,
        );
        await audioService.trimAudioToWav(
          audio.path,
          audio.base,
          splitSec,
          currentDurationSec,
          tempPathB,
        );

        if (!existsSync(tempPathA) || statSync(tempPathA).size === 0) {
          throw new Error("First half audio was not created or is empty");
        }
        if (!existsSync(tempPathB) || statSync(tempPathB).size === 0) {
          throw new Error("Second half audio was not created or is empty");
        }

        // Write B first so we can safely overwrite A's path if it equals the source.
        copyFileSync(tempPathB, finalPathB);
        unlinkSync(tempPathB);
        copyFileSync(tempPathA, finalPathA);
        unlinkSync(tempPathA);

        try {
          await audioService.generateWaveformFile(finalPathA, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPathA },
            "Waveform generation failed after split (A)",
          );
        }
        try {
          await audioService.generateWaveformFile(finalPathB, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPathB },
            "Waveform generation failed after split (B)",
          );
        }

        const txtPath = transcriptPath(audio.path);
        if (existsSync(txtPath)) {
          assertPathUnder(txtPath, audio.base);
          const srtText = readFileSync(txtPath, "utf-8");
          const entries = parseSrt(srtText);
          const entriesA = adjustSrtEntriesForWindow(entries, 0, splitSec);
          const entriesB = adjustSrtEntriesForWindow(
            entries,
            splitSec,
            currentDurationSec,
          );
          writeFileSync(
            transcriptPath(finalPathA),
            formatSrtEntries(entriesA),
            "utf-8",
          );
          writeFileSync(
            transcriptPath(finalPathB),
            formatSrtEntries(entriesB),
            "utf-8",
          );
          if (txtPath !== transcriptPath(finalPathA)) {
            try {
              unlinkSync(txtPath);
            } catch {
              /* ignore */
            }
          }
        }

        let markersRaw: unknown[] = [];
        if (typeof segment.markers === "string" && segment.markers) {
          try {
            const parsed = JSON.parse(segment.markers);
            if (Array.isArray(parsed)) markersRaw = parsed;
          } catch {
            /* ignore */
          }
        }
        let trimRaw: Array<[number, number]> = [];
        if (typeof segment.trimRanges === "string" && segment.trimRanges) {
          try {
            const parsed = JSON.parse(segment.trimRanges);
            if (Array.isArray(parsed)) {
              trimRaw = parsed as Array<[number, number]>;
            }
          } catch {
            /* ignore */
          }
        }

        const { before: markersA, after: markersB } = partitionMarkersAtSplit(
          markersRaw as Array<{
            time: number;
            title?: string;
            color?: string;
            markerType?: "" | "chapter" | "soundbite";
            duration?: number;
          }>,
          splitSec,
          durationA,
          durationB,
        );
        const { before: trimsA, after: trimsB } = partitionTrimRangesAtSplit(
          trimRaw,
          splitSec,
        );

        const audioEqRaw =
          typeof segment.audioEq === "string" && segment.audioEq
            ? segment.audioEq
            : null;
        const name =
          typeof segment.name === "string" ? segment.name : "";
        const disabled = Boolean(segment.disabled);
        const currentPos = Number(segment.position);

        repo.updateSegmentAudio(
          segmentId,
          episodeId,
          finalPathA,
          durationA,
          {
            trimRanges: JSON.stringify(trimsA),
            markers: JSON.stringify(markersA),
          },
        );

        repo.shiftSegmentPositionsAfter(episodeId, currentPos);
        repo.insertSegmentRecorded({
          id: newSegmentId,
          episodeId,
          position: currentPos + 1,
          name,
          audioPath: pathRelativeToData(finalPathB),
          durationSec: durationB,
          trimRanges: JSON.stringify(trimsB),
          markers: JSON.stringify(markersB),
          audioEq: audioEqRaw,
          disabled,
        });

        if (audio.path !== finalPathA && audio.path !== finalPathB) {
          try {
            unlinkSync(audio.path);
          } catch {
            /* ignore */
          }
        }

        const rowB = repo.getSegmentById(newSegmentId, episodeId);
        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        if (rowB) {
          broadcastToEpisode(episodeId, {
            type: "segmentAdded",
            segment: redactSegmentForClient(rowB as Record<string, unknown>),
          });
        }
        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPathA)) unlinkSync(tempPathA);
        } catch {
          /* ignore */
        }
        try {
          if (existsSync(tempPathB)) unlinkSync(tempPathB);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Failed to split segment" });
      }
    },
  );
}
