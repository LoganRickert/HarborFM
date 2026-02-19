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
import { assertPathUnder } from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { FFMPEG_PATH } from "../../config.js";
import {
  segmentEpisodeSegmentIdParamSchema,
  segmentTrimBodySchema,
  segmentRemoveSilenceBodySchema,
  segmentNoiseSuppressionBodySchema,
} from "@harborfm/shared";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import * as repo from "./repo.js";
import {
  transcriptPath,
  parseSrt,
  parseSrtTime,
  formatSrtTime,
  type SrtEntry,
} from "./utils.js";

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
}
