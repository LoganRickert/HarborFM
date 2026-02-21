import type { FastifyInstance } from "fastify";
import { existsSync, statSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments, getPodcastOwnerId } from "../../services/access.js";
import {
  getDataDir,
  libraryDir,
  processedDir,
  assertPathUnder,
  transcriptSrtPath,
  episodeVideoPath,
  resolveDataPath,
  uploadsDir,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { RENDER_RATE_LIMIT_WINDOW_MS } from "../../config.js";
import { segmentEpisodeIdParamSchema } from "@harborfm/shared";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { writeEpisodeChaptersJson } from "../../services/episodeChapters.js";
import { readSettings } from "../settings/index.js";
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
      setImmediate(() => {
        (async () => {
          const tempPathsToClean: string[] = [];
          try {
            const paths: string[] = [];
            const finalMarkers: Array<{ time: number; title?: string; color?: string }> = [];
            let offsetSec = 0;
            for (const s of segments) {
              if (s.disabled || s.inProgress || s.recordFailed) continue;
              let sourcePath: string | null = null;
              let baseDir: string = uploadsDir(podcastId, episodeId);
              if (s.type === "recorded" && s.audioPath) {
                const segPath = resolveDataPath(s.audioPath as string);
                if (existsSync(segPath)) {
                  assertPathUnder(segPath, DATA_DIR);
                  sourcePath = segPath;
                  baseDir = uploadsDir(podcastId, episodeId);
                }
              } else if (s.type === "reusable" && s.reusableAssetId) {
                const asset = repo.getReusableAssetAudio(s.reusableAssetId as string);
                if (asset?.audioPath) {
                  const assetPath = resolveDataPath(asset.audioPath);
                  if (existsSync(assetPath)) {
                    assertPathUnder(assetPath, DATA_DIR);
                    sourcePath = assetPath;
                    baseDir = libraryDir(asset.ownerUserId);
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
                        Array.isArray(r) && r.length === 2 && typeof r[0] === "number" && typeof r[1] === "number"
                    );
                    trimRanges = raw.length > 0 ? raw : null;
                  }
                } catch {
                  /* ignore invalid JSON */
                }
              }

              const durationSec = Number(s.durationSec) || 0;
              const rawRanges = trimRanges ?? [];
              const ranges = rawRanges.length > 0 ? mergeTrimRanges(rawRanges, durationSec) : [];
              const effectiveDuration =
                ranges.length > 0
                  ? durationSec - ranges.reduce((sum, [a, b]) => sum + (b - a), 0)
                  : durationSec;

              const markersRaw = s.markers;
              let markers: Array<{ time: number; title?: string; color?: string; marker_type?: string; markerType?: string }> = [];
              if (typeof markersRaw === "string" && markersRaw) {
                try {
                  const parsed = JSON.parse(markersRaw) as unknown;
                  if (Array.isArray(parsed)) {
                    markers = parsed.filter(
                      (m): m is { time: number; title?: string; color?: string; marker_type?: string; markerType?: string } =>
                        typeof m === "object" && m != null && typeof (m as { time?: number }).time === "number"
                    );
                  }
                } catch {
                  /* ignore invalid JSON */
                }
              }
              for (const m of markers) {
                const markerType = m.marker_type ?? m.markerType;
                if (markerType === "chapter") {
                  const effTime = ranges.length > 0 ? toEffectiveTime(m.time, ranges) : m.time;
                  finalMarkers.push({
                    time: offsetSec + effTime,
                    title: m.title,
                    color: m.color,
                  });
                }
              }
              offsetSec += effectiveDuration;

              let segmentPath: string;
              if (ranges.length > 0) {
                const tempPath = join(tmpdir(), `render_trim_${nanoid()}.wav`);
                tempPathsToClean.push(tempPath);
                await audioService.removeRangesAndExportToWav(
                  sourcePath,
                  baseDir,
                  ranges,
                  tempPath,
                );
                segmentPath = tempPath;
              } else {
                segmentPath = sourcePath;
              }

              const audioEqRaw = s.audioEq;
              let audioEq: { lowDb?: number; midDb?: number; highDb?: number } | null = null;
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
              if (audioEq) {
                const eqPath = join(tmpdir(), `render_eq_${nanoid()}.wav`);
                tempPathsToClean.push(eqPath);
                const segmentBaseDir = segmentPath.startsWith(tmpdir()) ? tmpdir() : baseDir;
                await audioService.applyEqToWav(segmentPath, eqPath, segmentBaseDir, audioEq);
                paths.push(eqPath);
              } else {
                paths.push(segmentPath);
              }
            }
            if (paths.length === 0) {
              renderStatusByEpisode.set(episodeId, "failed");
              renderErrorByEpisode.set(episodeId, "No valid segment audio found.");
              broadcastToEpisode(episodeId, { type: "renderFailed" });
              return;
            }
            await audioService.concatToFinal(paths, outPath, {
              format: settings.final_format,
              bitrateKbps: settings.final_bitrate_kbps,
              channels: settings.final_channels,
            });
            const meta = await audioService.getAudioMetaAfterProcess(
              podcastId,
              episodeId,
              settings.final_format,
            );
            const finalMarkersJson = JSON.stringify(finalMarkers);
            repo.updateEpisodeAfterRender(episodeId, {
              audioFinalPath: outPath,
              audioSourcePath: outPath,
              audioMime: meta.mime,
              audioBytes: meta.sizeBytes,
              audioDurationSec: meta.durationSec,
              descriptionCopyrightSnapshot,
              finalMarkers: finalMarkersJson,
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
          } finally {
            for (const p of tempPathsToClean) {
              try {
                if (existsSync(p)) unlinkSync(p);
              } catch {
                /* ignore */
              }
            }
          }
        })();
      });

      return reply.status(202).send({ status: "building" });
    },
  );
}
