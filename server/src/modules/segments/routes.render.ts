import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, rmSync, statSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { nanoid } from "nanoid";
import { runEpisodeRenderJob } from "@harborfm/episode-render";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments, getPodcastOwnerId } from "../../services/access.js";
import {
  getDataDir,
  processedDir,
  assertPathUnder,
  transcriptSrtPath,
  episodeVideoPath,
  resolveDataPath,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { FFMPEG_PATH, FFPROBE_PATH, RENDER_RATE_LIMIT_WINDOW_MS } from "../../config.js";
import { segmentEpisodeIdParamSchema } from "@harborfm/shared";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { writeEpisodeChaptersJson } from "../../services/episodeChapters.js";
import { readSettings } from "../settings/index.js";
import {
  dispatchComputeJob,
  resolveWorkerJobSubject,
  workerApiBaseFromRequest,
} from "../workers/index.js";
import * as repo from "./repo.js";
import {
  renderStatusByEpisode,
  renderErrorByEpisode,
  mergeTrimRanges,
  toEffectiveTime,
} from "./utils.js";

export async function registerRenderRoutes(app: FastifyInstance) {
  app.get(
    "/episodes/:id/render-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get render status",
        description:
          "Returns whether a final episode build is in progress, done, or failed. Poll every 1–2s after starting a build.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: {
            description: "Render status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "building", "done", "failed"],
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
      const status = renderStatusByEpisode.get(episodeId) ?? "idle";
      const error =
        status === "failed"
          ? (renderErrorByEpisode.get(episodeId) ?? "Render failed")
          : undefined;
      if (status === "done" || status === "failed") {
        renderStatusByEpisode.delete(episodeId);
        renderErrorByEpisode.delete(episodeId);
      }
      return reply.send({ status, error });
    },
  );

  app.post(
    "/episodes/:id/render",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "render", windowMs: RENDER_RATE_LIMIT_WINDOW_MS }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Start render",
        description:
          "Start building the final episode audio. Returns immediately; poll GET /episodes/:id/render-status until status is done or failed.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          202: {
            description: "Build started",
            type: "object",
            properties: { status: { type: "string", enum: ["building"] } },
            required: ["status"],
          },
          409: {
            description: "Build already in progress",
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { description: "No segments or validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Episode not found" },
          429: { description: "Rate limited; try again after Retry-After seconds" },
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
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to build the episode." });

      if (renderStatusByEpisode.get(episodeId) === "building") {
        return reply
          .status(409)
          .send({
            status: "building",
            message: "A build is already in progress for this episode.",
          });
      }

      const { podcastId } = access;
      const segments = repo.listSegmentsForRender(episodeId);
      const enabledCount = segments.filter(
        (s) => !(s.disabled || s.inProgress || s.recordFailed),
      ).length;
      if (enabledCount === 0) {
        return reply
          .status(400)
          .send({ error: "Add or enable at least one section before rendering." });
      }
      const DATA_DIR = getDataDir();
      const copyrightLines: string[] = [];
      for (const s of segments) {
        if (s.disabled || s.inProgress || s.recordFailed) continue;
        if (s.type === "reusable" && s.reusableAssetId) {
          const asset = repo.getReusableAssetNameAndCopyright(s.reusableAssetId as string);
          if (asset) {
            const copyright =
              asset.copyright != null ? String(asset.copyright).trim() : "";
            if (copyright) {
              const name =
                s.name != null && String(s.name).trim() !== ""
                  ? String(s.name).trim()
                  : (asset.name ?? "");
              copyrightLines.push(`${name || "Segment"} by ${copyright}`);
            }
          }
        }
      }
      const descriptionCopyrightSnapshot =
        copyrightLines.length > 0 ? copyrightLines.join("\n") : null;
      const settings = readSettings();
      const outPath = audioService.getFinalOutputPath(
        podcastId,
        episodeId,
        settings.final_format,
      );

      renderStatusByEpisode.set(episodeId, "building");
      renderErrorByEpisode.delete(episodeId);
      broadcastToEpisode(episodeId, { type: "renderStarted" });

      const srtPath = transcriptSrtPath(podcastId, episodeId);
      if (existsSync(srtPath)) {
        try {
          assertPathUnder(srtPath, DATA_DIR);
          unlinkSync(srtPath);
        } catch (err) {
          request.log.warn({ err, episodeId }, "Failed to delete episode transcript before build");
        }
      }

      const videoPath = episodeVideoPath(podcastId, episodeId);
      if (existsSync(videoPath)) {
        try {
          const videoSize = statSync(videoPath).size;
          const videoOwnerId = getPodcastOwnerId(podcastId);
          if (videoOwnerId && videoSize > 0) {
            repo.subtractUserDiskBytes(videoOwnerId, videoSize);
          }
          assertPathUnder(videoPath, DATA_DIR);
          unlinkSync(videoPath);
        } catch (err) {
          request.log.warn({ err, episodeId }, "Failed to delete episode video before build");
        }
      }
      repo.clearEpisodeVideoPath(episodeId);

      const log = request.log;
      const apiBase = workerApiBaseFromRequest(request);
      const requestedByUserId = request.userId;
      setImmediate(() => {
        (async () => {
          try {
            type JobSegParam = {
              input: string;
              trimRanges: Array<[number, number]> | null;
              audioEq: {
                lowDb?: number;
                midDb?: number;
                highDb?: number;
              } | null;
            };
            const jobInputs: Array<{ name: string; absolutePath: string }> = [];
            const jobSegParams: JobSegParam[] = [];
            const finalMarkers: Array<{ time: number; title?: string; color?: string }> = [];
            const finalSoundbites: Array<{
              time: number;
              duration: number;
              title?: string;
              color?: string;
            }> = [];
            let offsetSec = 0;
            let segIndex = 0;
            for (const s of segments) {
              if (s.disabled || s.inProgress || s.recordFailed) continue;
              let sourcePath: string | null = null;
              if (s.type === "recorded" && s.audioPath) {
                const segPath = resolveDataPath(s.audioPath as string);
                if (existsSync(segPath)) {
                  assertPathUnder(segPath, DATA_DIR);
                  sourcePath = segPath;
                }
              } else if (s.type === "reusable" && s.reusableAssetId) {
                const asset = repo.getReusableAssetAudio(s.reusableAssetId as string);
                if (asset?.audioPath) {
                  const assetPath = resolveDataPath(asset.audioPath);
                  if (existsSync(assetPath)) {
                    assertPathUnder(assetPath, DATA_DIR);
                    sourcePath = assetPath;
                  }
                }
              }
              if (!sourcePath) continue;

              const trimRangesRaw = s.trimRanges;
              let trimRanges: Array<[number, number]> | null = null;
              if (typeof trimRangesRaw === "string" && trimRangesRaw) {
                try {
                  const parsed = JSON.parse(trimRangesRaw) as unknown;
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    const raw = parsed.filter(
                      (r): r is [number, number] =>
                        Array.isArray(r) &&
                        r.length === 2 &&
                        typeof r[0] === "number" &&
                        typeof r[1] === "number",
                    );
                    trimRanges = raw.length > 0 ? raw : null;
                  }
                } catch {
                  /* ignore invalid JSON */
                }
              }

              const durationSec = Number(s.durationSec) || 0;
              const rawRanges = trimRanges ?? [];
              const ranges =
                rawRanges.length > 0
                  ? mergeTrimRanges(rawRanges, durationSec)
                  : [];
              const effectiveDuration =
                ranges.length > 0
                  ? durationSec -
                    ranges.reduce((sum, [a, b]) => sum + (b - a), 0)
                  : durationSec;

              const markersRaw = s.markers;
              let markers: Array<{
                time: number;
                title?: string;
                color?: string;
                duration?: number;
                marker_type?: string;
                markerType?: string;
              }> = [];
              if (typeof markersRaw === "string" && markersRaw) {
                try {
                  const parsed = JSON.parse(markersRaw) as unknown;
                  if (Array.isArray(parsed)) {
                    markers = parsed.filter(
                      (
                        m,
                      ): m is {
                        time: number;
                        title?: string;
                        color?: string;
                        duration?: number;
                        marker_type?: string;
                        markerType?: string;
                      } =>
                        typeof m === "object" &&
                        m != null &&
                        typeof (m as { time?: number }).time === "number",
                    );
                  }
                } catch {
                  /* ignore invalid JSON */
                }
              }
              for (const m of markers) {
                const markerType = m.marker_type ?? m.markerType;
                if (markerType === "chapter") {
                  const effTime =
                    ranges.length > 0 ? toEffectiveTime(m.time, ranges) : m.time;
                  finalMarkers.push({
                    time: offsetSec + effTime,
                    title: m.title,
                    color: m.color,
                  });
                } else if (markerType === "soundbite") {
                  const effTime =
                    ranges.length > 0 ? toEffectiveTime(m.time, ranges) : m.time;
                  let duration =
                    typeof m.duration === "number" && Number.isFinite(m.duration)
                      ? m.duration
                      : 30;
                  if (duration < 15) duration = 15;
                  if (duration > 120) duration = 120;
                  finalSoundbites.push({
                    time: offsetSec + effTime,
                    duration,
                    title: m.title,
                    color: m.color,
                  });
                }
              }
              offsetSec += effectiveDuration;

              const audioEqRaw = s.audioEq;
              let audioEq: {
                lowDb?: number;
                midDb?: number;
                highDb?: number;
              } | null = null;
              if (typeof audioEqRaw === "string" && audioEqRaw) {
                try {
                  const parsed = JSON.parse(audioEqRaw) as unknown;
                  if (typeof parsed === "object" && parsed != null) {
                    const o = parsed as Record<string, unknown>;
                    const low = typeof o.lowDb === "number" ? o.lowDb : 0;
                    const mid = typeof o.midDb === "number" ? o.midDb : 0;
                    const high = typeof o.highDb === "number" ? o.highDb : 0;
                    if (low !== 0 || mid !== 0 || high !== 0) {
                      audioEq = { lowDb: low, midDb: mid, highDb: high };
                    }
                  }
                } catch {
                  /* ignore invalid JSON */
                }
              }

              const inputName = `seg_${segIndex}`;
              segIndex += 1;
              jobInputs.push({ name: inputName, absolutePath: sourcePath });
              jobSegParams.push({
                input: inputName,
                trimRanges: ranges.length > 0 ? ranges : null,
                audioEq,
              });
            }
            if (jobInputs.length === 0) {
              renderStatusByEpisode.set(episodeId, "failed");
              renderErrorByEpisode.set(episodeId, "No valid segment audio found.");
              broadcastToEpisode(episodeId, { type: "renderFailed" });
              return;
            }

            const finalName =
              settings.final_format === "m4a" ? "final.m4a" : "final.mp3";
            const encodeParams = {
              format: settings.final_format,
              bitrateKbps: settings.final_bitrate_kbps,
              channels: settings.final_channels,
              loudnessTargetLufs: settings.loudness_target_lufs,
              segments: jobSegParams,
            };

            const runLocal = async () => {
              const workDir = join(tmpdir(), `episode_render_${nanoid()}`);
              mkdirSync(workDir, { recursive: true });
              try {
                mkdirSync(dirname(outPath), { recursive: true });
                await runEpisodeRenderJob({
                  workDir,
                  segments: jobInputs.map((inp, i) => ({
                    inputPath: inp.absolutePath,
                    trimRanges: jobSegParams[i]!.trimRanges,
                    audioEq: jobSegParams[i]!.audioEq,
                  })),
                  outPath,
                  format: settings.final_format,
                  bitrateKbps: settings.final_bitrate_kbps,
                  channels: settings.final_channels,
                  loudnessTargetLufs: settings.loudness_target_lufs,
                  tools: {
                    ffmpegPath: FFMPEG_PATH,
                    ffprobePath: FFPROBE_PATH,
                  },
                });
              } finally {
                try {
                  rmSync(workDir, { recursive: true, force: true });
                } catch {
                  /* ignore */
                }
              }
            };

            if (
              settings.workers_enabled &&
              settings.workers_use_for_final_episodes !== false
            ) {
              mkdirSync(dirname(outPath), { recursive: true });
              await dispatchComputeJob({
                kind: "episode_render",
                apiBase,
                inputs: jobInputs,
                outputs: [{ name: finalName, absolutePath: outPath }],
                params: encodeParams,
                subject: resolveWorkerJobSubject({
                  podcastId,
                  episodeId,
                  userId: requestedByUserId,
                }),
                runLocal,
              });
            } else {
              await runLocal();
            }

            const meta = await audioService.getAudioMetaAfterProcess(
              podcastId,
              episodeId,
              settings.final_format,
            );
            const finalMarkersJson = JSON.stringify(finalMarkers);
            const finalSoundbitesJson = JSON.stringify(finalSoundbites);
            repo.updateEpisodeAfterRender(episodeId, {
              audioFinalPath: outPath,
              audioSourcePath: outPath,
              audioMime: meta.mime,
              audioBytes: meta.sizeBytes,
              audioDurationSec: meta.durationSec,
              descriptionCopyrightSnapshot,
              finalMarkers: finalMarkersJson,
              finalSoundbites: finalSoundbitesJson,
            });
            const epRow = repo.getEpisodeStatusPublishAt(episodeId);
            const isPublic =
              epRow?.status === "published" &&
              (epRow.publishAt == null ||
                new Date(epRow.publishAt) <= new Date());
            if (isPublic) {
              try {
                writeRssFile(podcastId, null);
                deleteTokenFeedTemplateFile(podcastId);
                notifyWebSubHub(podcastId, null);
              } catch (err) {
                log.warn(
                  { err, podcastId },
                  "Failed to regenerate RSS feed after episode render",
                );
              }
            }
            try {
              await audioService.generateWaveformFile(
                outPath,
                processedDir(podcastId, episodeId),
              );
            } catch (err) {
              log.warn(
                { err, episodeId },
                "Waveform generation failed after render",
              );
            }
            try {
              writeEpisodeChaptersJson(podcastId, episodeId, finalMarkers);
            } catch (err) {
              log.warn(
                { err, episodeId },
                "Chapters JSON generation failed after render",
              );
            }
            renderStatusByEpisode.set(episodeId, "done");
            broadcastToEpisode(episodeId, { type: "renderCompleted", status: "done" });
          } catch (err) {
            log.error(err);
            renderStatusByEpisode.set(episodeId, "failed");
            const errMsg = err instanceof Error ? err.message : "Render failed";
            renderErrorByEpisode.set(episodeId, errMsg);
            broadcastToEpisode(episodeId, {
              type: "renderCompleted",
              status: "failed",
              error: errMsg,
            });
          }
        })();
      });

      return reply.status(202).send({ status: "building" });
    },
  );
}
