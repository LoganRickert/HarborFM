import type { FastifyInstance } from "fastify";
import type { Readable } from "stream";
import { createReadStream, existsSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import {
  IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
  MULTIPART_MAX_BYTES,
  PROJECT_IMPORT_CHUNK_BODY_LIMIT,
  PROJECT_IMPORT_CHUNK_BYTES,
  SEGMENT_UPLOAD_MAX_BYTES,
} from "../../config.js";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import { assertSafeId, uploadsDir } from "../../services/paths.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import * as audioService from "../../services/audio.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import {
  FileTooLargeError,
  extensionFromAudioMimetype,
  streamToFileWithLimit,
} from "../../services/uploads.js";
import {
  appendChunkedUpload,
  ChunkTooLargeError,
  createChunkedUpload,
  finalizeChunkedUpload,
  getChunkedUpload,
} from "../../services/chunkedUpload.js";
import {
  cleanupImportUpload,
  importSegmentMixAudio,
} from "../../services/importSegmentMixAudio.js";
import {
  removeTempPath,
  streamTempZip,
} from "../episodes/projectImport.js";
import {
  getOrBuildSegmentProjectZip,
  getSegmentProjectExportStatus,
  startSegmentProjectExport,
} from "../episodes/projectSegmentExport.js";
import {
  getSegmentProjectImportStatus,
  startSegmentProjectImport,
} from "../episodes/projectSegmentImport.js";
import {
  getSegmentReaperImportStatus,
  startSegmentReaperImport,
  writeTempRpp,
} from "../episodes/projectSegmentReaperImport.js";
import {
  getSegmentOtioImportStatus,
  startSegmentOtioImport,
  writeTempOtio,
} from "../episodes/projectSegmentOtioImport.js";
import { getPodcastTitle } from "../audio/repo.js";
import * as episodeRepo from "../episodes/repo.js";
import { redactSegmentForClient } from "../../utils/segment.js";
import { ALLOWED_MIME, mergeTrimRanges } from "./utils.js";
import * as repo from "./repo.js";

function parseTrimRanges(
  raw: unknown,
  durationSec: number,
): Array<[number, number]> {
  let ranges: Array<[number, number]> = [];
  if (typeof raw === "string" && raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        ranges = parsed.filter(
          (r): r is [number, number] =>
            Array.isArray(r) &&
            r.length === 2 &&
            typeof r[0] === "number" &&
            typeof r[1] === "number",
        );
      }
    } catch {
      ranges = [];
    }
  } else if (Array.isArray(raw)) {
    ranges = raw.filter(
      (r): r is [number, number] =>
        Array.isArray(r) &&
        r.length === 2 &&
        typeof r[0] === "number" &&
        typeof r[1] === "number",
    );
  }
  return ranges.length > 0 ? mergeTrimRanges(ranges, durationSec) : [];
}

function parseAudioEq(
  raw: unknown,
): { lowDb?: number; midDb?: number; highDb?: number } | null {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed != null) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  } else if (typeof raw === "object" && raw != null) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return null;
  const low = typeof obj.lowDb === "number" ? obj.lowDb : 0;
  const mid = typeof obj.midDb === "number" ? obj.midDb : 0;
  const high = typeof obj.highDb === "number" ? obj.highDb : 0;
  if (low === 0 && mid === 0 && high === 0) return null;
  return { lowDb: low, midDb: mid, highDb: high };
}

function safeFilenamePart(raw: string, fallback: string): string {
  const cleaned =
    raw
      .split("")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join("")
      .replace(/[\\/:*?"<>|#%?&{}[\]=+;@!,`'^~]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/-+/g, "-")
      .replace(/^[.\s-]+|[.\s-]+$/g, "")
      .trim() || fallback;
  return cleaned.slice(0, 80);
}

/** `{segment}_{episode}_{podcast}.mp3` */
function segmentMp3Filename(
  segmentName: string | null | undefined,
  episodeTitle: string | null | undefined,
  podcastTitle: string | null | undefined,
): string {
  const segment = safeFilenamePart(segmentName || "", "Segment");
  const episode = safeFilenamePart(episodeTitle || "", "Episode");
  const podcast = safeFilenamePart(podcastTitle || "", "Podcast");
  return `${segment}_${episode}_${podcast}.mp3`;
}

export async function registerSegmentProjectRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/octet-stream",
    function (_request, payload, done) {
      done(null, payload);
    },
  );

  function parsePositiveInt(raw: unknown): number | null {
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === "string" && raw.trim() !== "") {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
    return null;
  }

  app.get(
    "/episodes/:episodeId/segments/:segmentId/download-mp3",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Download trimmed segment MP3",
        description:
          "Download segment audio as MP3 with soft trims and EQ applied (same as final render for that segment). Editors and above only.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "MP3 attachment" },
          400: { description: "Invalid ids" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          500: { description: "Export failed" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can download segment MP3" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }
      const audio = repo.getSegmentAudioPath(
        segment,
        access.podcastId,
        episodeId,
      );
      if (!audio || !existsSync(audio.path)) {
        return reply.status(404).send({ error: "Segment audio not found" });
      }

      const durationSec = Number(segment.durationSec) || 0;
      const ranges = parseTrimRanges(segment.trimRanges, durationSec);
      const audioEq = parseAudioEq(segment.audioEq);
      const episode = episodeRepo.getById(episodeId);
      const podcastTitle = getPodcastTitle(access.podcastId);
      const filename = segmentMp3Filename(
        typeof segment.name === "string" ? segment.name : null,
        episode?.title,
        podcastTitle,
      );

      // No soft edits and already MP3: stream source as attachment.
      if (
        ranges.length === 0 &&
        !audioEq &&
        audio.path.toLowerCase().endsWith(".mp3")
      ) {
        const size = statSync(audio.path).size;
        reply
          .header("Content-Type", "audio/mpeg")
          .header(
            "Content-Disposition",
            `attachment; filename="${filename.replace(/"/g, "")}"`,
          )
          .header("Content-Length", String(size));
        return reply.send(createReadStream(audio.path));
      }

      // Keep temps under episode uploads: transcodeToMp3/ensureDir only allow DATA_DIR.
      const workBase = audio.base;
      const tempPaths: string[] = [];
      const outMp3 = join(workBase, `_seg_dl_${nanoid()}.mp3`);
      tempPaths.push(outMp3);

      try {
        let workPath = audio.path;

        if (ranges.length > 0) {
          const trimmed = join(workBase, `_seg_dl_trim_${nanoid()}.wav`);
          tempPaths.push(trimmed);
          await audioService.removeRangesAndExportToWav(
            audio.path,
            workBase,
            ranges,
            trimmed,
          );
          workPath = trimmed;
        }

        if (audioEq) {
          const eqPath = join(workBase, `_seg_dl_eq_${nanoid()}.wav`);
          tempPaths.push(eqPath);
          await audioService.applyEqToWav(workPath, eqPath, workBase, audioEq);
          workPath = eqPath;
        }

        await audioService.transcodeToMp3(workPath, outMp3, workBase);

        if (!existsSync(outMp3)) {
          return reply.status(500).send({ error: "Failed to build MP3" });
        }
        const size = statSync(outMp3).size;
        reply
          .header("Content-Type", "audio/mpeg")
          .header(
            "Content-Disposition",
            `attachment; filename="${filename.replace(/"/g, "")}"`,
          )
          .header("Content-Length", String(size));

        const stream = createReadStream(outMp3);
        stream.on("close", () => {
          for (const p of tempPaths) {
            try {
              if (existsSync(p)) unlinkSync(p);
            } catch {
              // ignore
            }
          }
        });
        return reply.send(stream);
      } catch (err) {
        for (const p of tempPaths) {
          try {
            if (existsSync(p)) unlinkSync(p);
          } catch {
            // ignore
          }
        }
        request.log.error({ err }, "download-mp3 failed");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to download MP3",
        });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/import-mp3",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "import-mp3",
          windowMs: IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Import MP3 as segment final mix",
        description:
          "Upload audio (MP3/WAV/etc.) to replace this segment's final mix. Soft trims and EQ are cleared (Download MP3 already applies them). Markers past the new duration are pruned. Remake from tracks will overwrite this mix. Editors and above only. Rate limited to once per 30 seconds per user.",
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
          400: { description: "Invalid file" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          429: { description: "Rate limited" },
          500: { description: "Import failed" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import segment audio" });
      }

      let segment: Record<string, unknown> | undefined = repo.getSegmentById(
        segmentId,
        episodeId,
      );
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }

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
                : "Failed to prepare segment for import",
          });
        }
      } else if (segment.type !== "recorded") {
        return reply.status(400).send({
          error: "Only recorded or library segments can import a mix",
        });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      const mimetype = data.mimetype || "";
      const filename = (data.filename || "").toLowerCase();
      const looksAudio =
        ALLOWED_MIME.includes(mimetype) ||
        mimetype.startsWith("audio/") ||
        /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/.test(filename);
      if (!looksAudio) {
        return reply.status(400).send({
          error: "Invalid file type. Use MP3, WAV, or another audio file.",
        });
      }

      const ext = extensionFromAudioMimetype(mimetype) || "mp3";
      const segmentBase = uploadsDir(access.podcastId, episodeId);
      const tempPath = join(
        segmentBase,
        `_import_mix_${segmentId}_${nanoid()}.${ext}`,
      );
      try {
        await streamToFileWithLimit(
          data.file,
          tempPath,
          SEGMENT_UPLOAD_MAX_BYTES,
        );
      } catch (err) {
        cleanupImportUpload(tempPath);
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: "File too large" });
        }
        request.log.error({ err }, "import-mp3 upload failed");
        return reply.status(500).send({ error: "Upload failed" });
      }

      try {
        await importSegmentMixAudio({
          podcastId: access.podcastId,
          episodeId,
          segmentId,
          uploadPath: tempPath,
          inputExt: ext,
        });
        const row = repo.getSegmentById(segmentId, episodeId);
        if (!row) {
          return reply.status(500).send({ error: "Failed to load updated segment" });
        }
        broadcastToEpisode(episodeId, {
          type: "segmentUpdated",
          segmentId,
        });
        return reply.send(redactSegmentForClient(row));
      } catch (err) {
        cleanupImportUpload(tempPath);
        const message =
          err instanceof Error ? err.message : "Failed to import audio";
        if (/storage limit/i.test(message)) {
          return reply.status(403).send({ error: message });
        }
        request.log.error({ err }, "import-mp3 failed");
        return reply.status(500).send({ error: message });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/project-export/prepare",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Start segment project zip build",
        description:
          "Start building a segment project zip in the background. Returns 202; poll GET project-export/status until ready or failed, then GET project-export to download.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
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
          400: { description: "Invalid ids" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can download segment projects" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }
      const hasAudio = !!repo.getSegmentAudioPath(
        segment,
        access.podcastId,
        episodeId,
      );
      if (!hasAudio && segment.type !== "recorded" && segment.type !== "reusable") {
        return reply.status(404).send({ error: "Segment has no exportable content" });
      }
      const started = startSegmentProjectExport(
        episodeId,
        access.podcastId,
        segmentId,
      );
      if (!started) {
        return reply.status(409).send({
          status: "building",
          message: "Segment project export already in progress",
        });
      }
      return reply.status(202).send({ status: "building" });
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/project-export/status",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Get segment project zip build status",
        description:
          "Poll after POST project-export/prepare until ready or failed.",
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
            description: "Export status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "building", "ready", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Invalid ids" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can download segment projects" });
      }
      return reply.send(getSegmentProjectExportStatus(segmentId));
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/project-export",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Download segment project zip",
        description:
          "Download a HarborFM segment project zip (kind: segment). Editors and above only. Prefer POST prepare + status poll first; this endpoint awaits any in-flight build (singleflight) then streams the zip.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Project zip attachment" },
          400: { description: "Invalid ids" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          500: { description: "Export failed" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can download segment projects" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }
      const hasAudio = !!repo.getSegmentAudioPath(
        segment,
        access.podcastId,
        episodeId,
      );
      if (!hasAudio && segment.type !== "recorded" && segment.type !== "reusable") {
        return reply.status(404).send({ error: "Segment has no exportable content" });
      }

      try {
        const { zipPath, filename } = await getOrBuildSegmentProjectZip(
          episodeId,
          access.podcastId,
          segmentId,
        );
        if (!existsSync(zipPath)) {
          return reply.status(500).send({ error: "Failed to build project zip" });
        }
        const size = statSync(zipPath).size;
        reply
          .header("Content-Type", "application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="${filename.replace(/"/g, "")}"`,
          )
          .header("Content-Length", String(size));
        return reply.send(createReadStream(zipPath));
      } catch (err) {
        request.log.error({ err }, "segment project-export failed");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to export project",
        });
      }
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/import-project/status",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Get segment project import status",
        description:
          "Poll after POST import-project (202) until done or failed.",
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
            description: "Import status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "importing", "done", "failed"],
              },
              error: { type: "string" },
              warning: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Invalid ids" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import segment projects" });
      }
      return reply.send(getSegmentProjectImportStatus(segmentId));
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/import-project/upload",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Start chunked segment project upload",
        description:
          "Create a chunked upload session for a large segment project zip. Then PUT chunks and POST finish.",
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
            totalBytes: { type: "number" },
            totalChunks: { type: "number" },
            filename: { type: "string" },
          },
          required: ["totalBytes", "totalChunks"],
        },
        response: {
          200: {
            description: "Upload session created",
            type: "object",
            properties: {
              uploadId: { type: "string" },
              chunkBytes: { type: "number" },
            },
            required: ["uploadId", "chunkBytes"],
          },
          400: { description: "Invalid request" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import segment projects" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }
      const body = request.body as {
        totalBytes?: number;
        totalChunks?: number;
        filename?: string;
      };
      const totalBytes = parsePositiveInt(body.totalBytes);
      const totalChunks = parsePositiveInt(body.totalChunks);
      if (totalBytes == null || totalChunks == null) {
        return reply.status(400).send({
          error: "totalBytes and totalChunks are required",
        });
      }
      try {
        const { uploadId } = createChunkedUpload({
          userId: request.userId!,
          purpose: `segment-import:${episodeId}:${segmentId}`,
          totalBytes,
          totalChunks,
          filename: body.filename,
        });
        return reply.send({
          uploadId,
          chunkBytes: PROJECT_IMPORT_CHUNK_BYTES,
        });
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to start upload",
        });
      }
    },
  );

  app.put(
    "/episodes/:episodeId/segments/:segmentId/import-project/upload/:uploadId/chunks/:chunkIndex",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      bodyLimit: PROJECT_IMPORT_CHUNK_BODY_LIMIT,
      schema: {
        tags: ["Segments"],
        summary: "Upload one segment project zip chunk",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
            uploadId: { type: "string" },
            chunkIndex: { type: "string" },
          },
          required: ["episodeId", "segmentId", "uploadId", "chunkIndex"],
        },
        querystring: {
          type: "object",
          properties: {
            totalChunks: { type: "string" },
            totalBytes: { type: "string" },
          },
          required: ["totalChunks", "totalBytes"],
        },
      },
    },
    async (request, reply) => {
      const {
        episodeId,
        segmentId,
        uploadId,
        chunkIndex: chunkIndexRaw,
      } = request.params as {
        episodeId: string;
        segmentId: string;
        uploadId: string;
        chunkIndex: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import segment projects" });
      }
      const session = getChunkedUpload(uploadId, request.userId!);
      if (
        !session ||
        session.purpose !== `segment-import:${episodeId}:${segmentId}`
      ) {
        return reply.status(404).send({ error: "Upload not found or expired" });
      }
      const chunkIndex = parsePositiveInt(chunkIndexRaw);
      const q = request.query as { totalChunks?: string; totalBytes?: string };
      const totalChunks = parsePositiveInt(q.totalChunks);
      const totalBytes = parsePositiveInt(q.totalBytes);
      if (chunkIndex == null || totalChunks == null || totalBytes == null) {
        return reply.status(400).send({
          error: "chunkIndex, totalChunks, and totalBytes are required",
        });
      }
      const lenHeader = request.headers["content-length"];
      const chunkLength =
        typeof lenHeader === "string" && Number.isFinite(Number(lenHeader))
          ? Number(lenHeader)
          : undefined;
      const stream = request.body as Readable;
      if (!stream || typeof stream.pipe !== "function") {
        return reply
          .status(400)
          .send({ error: "Expected application/octet-stream body" });
      }
      try {
        const result = await appendChunkedUpload(uploadId, request.userId!, {
          chunkIndex,
          totalChunks,
          totalBytes,
          body: stream,
          chunkLength,
          maxChunkBytes: PROJECT_IMPORT_CHUNK_BODY_LIMIT,
        });
        return reply.send({
          ok: true,
          bytes: result.bytes,
          receivedBytes: result.receivedBytes,
          complete: result.complete,
        });
      } catch (err) {
        if (err instanceof ChunkTooLargeError) {
          return reply.status(413).send({ error: err.message });
        }
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Chunk upload failed",
        });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/import-project/upload/:uploadId/finish",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "import-segment-project",
          windowMs: IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Finish chunked segment project upload and start import",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
            uploadId: { type: "string" },
          },
          required: ["episodeId", "segmentId", "uploadId"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { status: { type: "string", enum: ["importing"] } },
            required: ["status"],
          },
          409: { description: "Import already in progress" },
          400: { description: "Invalid upload" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId, uploadId } = request.params as {
        episodeId: string;
        segmentId: string;
        uploadId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import segment projects" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }
      const session = getChunkedUpload(uploadId, request.userId!);
      if (
        !session ||
        session.purpose !== `segment-import:${episodeId}:${segmentId}`
      ) {
        return reply.status(404).send({ error: "Upload not found or expired" });
      }
      let tmpZip: string;
      try {
        tmpZip = finalizeChunkedUpload(uploadId, request.userId!);
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Upload incomplete",
        });
      }
      if (!existsSync(tmpZip) || statSync(tmpZip).size === 0) {
        removeTempPath(tmpZip);
        return reply.status(400).send({ error: "Empty zip file" });
      }
      const started = startSegmentProjectImport(
        access.podcastId,
        episodeId,
        segmentId,
        tmpZip,
        request.userId!,
        () => {
          broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        },
      );
      if (!started) {
        removeTempPath(tmpZip);
        return reply.status(409).send({
          status: "importing",
          message: "Segment import already in progress",
        });
      }
      return reply.status(202).send({ status: "importing" });
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/import-project",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "import-segment-project",
          windowMs: IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Import segment project zip (overwrite)",
        description:
          "Upload a HarborFM segment project zip and overwrite this segment in place. Returns 202; poll GET import-project/status until done or failed. Editors and above only. Rate limited to once per 30 seconds per user. Prefer chunked upload routes for large zips.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { status: { type: "string", enum: ["importing"] } },
            required: ["status"],
          },
          409: {
            description: "Import already in progress",
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { description: "Invalid zip" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          413: { description: "File too large for single-shot upload" },
          429: { description: "Rate limited" },
          500: { description: "Import failed" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import segment projects" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      const filename = data.filename || "segment.zip";
      if (
        !filename.toLowerCase().endsWith(".zip") &&
        data.mimetype !== "application/zip"
      ) {
        return reply
          .status(400)
          .send({ error: "File must be a .zip segment project export" });
      }

      try {
        const tmpZip = await streamTempZip(data.file, MULTIPART_MAX_BYTES);
        if (!existsSync(tmpZip) || statSync(tmpZip).size === 0) {
          removeTempPath(tmpZip);
          return reply.status(400).send({ error: "Empty zip file" });
        }
        const started = startSegmentProjectImport(
          access.podcastId,
          episodeId,
          segmentId,
          tmpZip,
          request.userId!,
          () => {
            broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
          },
        );
        if (!started) {
          removeTempPath(tmpZip);
          return reply.status(409).send({
            status: "importing",
            message: "Segment import already in progress",
          });
        }
        return reply.status(202).send({ status: "importing" });
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(413).send({
            error:
              "This project zip is too large to upload all at once. Refresh the page and try again.",
          });
        }
        request.log.error({ err }, "segment import-project failed to start");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to import project",
        });
      }
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/import-reaper/status",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Get segment Reaper import status",
        description:
          "Poll after POST import-reaper (202) until done or failed.",
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
            description: "Import status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "importing", "done", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Invalid ids" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import Reaper projects" });
      }
      return reply.send(getSegmentReaperImportStatus(segmentId));
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/import-reaper",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "import-reaper",
          windowMs: IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Import segment.rpp (rebuild mix from existing tracks)",
        description:
          "Upload a segment.rpp and rebuild tracks_manifest + segment mix from existing recordings (or mix audio). Returns 202; poll GET import-reaper/status until done or failed. Editors and above only. Rate limited to once per 30 seconds per user.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { status: { type: "string", enum: ["importing"] } },
            required: ["status"],
          },
          409: {
            description: "Import already in progress",
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { description: "Invalid file" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          429: { description: "Rate limited" },
          500: { description: "Import failed" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import Reaper projects" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      const filename = data.filename || "segment.rpp";
      if (!filename.toLowerCase().endsWith(".rpp")) {
        return reply
          .status(400)
          .send({ error: "File must be a .rpp Reaper project" });
      }

      try {
        const buffer = await data.toBuffer();
        if (!buffer.length) {
          return reply.status(400).send({ error: "Empty Reaper file" });
        }
        const tmpRpp = writeTempRpp(buffer);
        const started = startSegmentReaperImport(
          access.podcastId,
          episodeId,
          segmentId,
          tmpRpp,
          request.userId!,
          () => {
            broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
          },
        );
        if (!started) {
          removeTempPath(tmpRpp);
          return reply.status(409).send({
            status: "importing",
            message: "Reaper import already in progress",
          });
        }
        return reply.status(202).send({ status: "importing" });
      } catch (err) {
        request.log.error({ err }, "segment import-reaper failed to start");
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Failed to import Reaper file",
        });
      }
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/import-otio/status",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Get segment OTIO import status",
        description:
          "Poll after POST import-otio (202) until done or failed.",
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
            description: "Import status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "importing", "done", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Invalid ids" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import OTIO timelines" });
      }
      return reply.send(getSegmentOtioImportStatus(segmentId));
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/import-otio",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "import-otio",
          windowMs: IMPORT_PROJECT_RATE_LIMIT_WINDOW_MS,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Import timeline.otio (rebuild mix from existing tracks)",
        description:
          "Upload a timeline.otio and rebuild tracks_manifest + segment mix from existing recordings (or mix audio). Returns 202; poll GET import-otio/status until done or failed. Editors and above only. Rate limited to once per 30 seconds per user.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          202: {
            description: "Import started",
            type: "object",
            properties: { status: { type: "string", enum: ["importing"] } },
            required: ["status"],
          },
          409: {
            description: "Import already in progress",
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { description: "Invalid file" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          429: { description: "Rate limited" },
          500: { description: "Import failed" },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, segmentId } = request.params as {
        episodeId: string;
        segmentId: string;
      };
      try {
        assertSafeId(episodeId, "episodeId");
        assertSafeId(segmentId, "segmentId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "Editors and above can import OTIO timelines" });
      }
      const segment = repo.getSegmentById(segmentId, episodeId);
      if (!segment) {
        return reply.status(404).send({ error: "Segment not found" });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      const filename = data.filename || "timeline.otio";
      if (!filename.toLowerCase().endsWith(".otio")) {
        return reply
          .status(400)
          .send({ error: "File must be a .otio OpenTimelineIO timeline" });
      }

      try {
        const buffer = await data.toBuffer();
        if (!buffer.length) {
          return reply.status(400).send({ error: "Empty OTIO file" });
        }
        const tmpOtio = writeTempOtio(buffer);
        const started = startSegmentOtioImport(
          access.podcastId,
          episodeId,
          segmentId,
          tmpOtio,
          request.userId!,
          () => {
            broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
          },
        );
        if (!started) {
          removeTempPath(tmpOtio);
          return reply.status(409).send({
            status: "importing",
            message: "OTIO import already in progress",
          });
        }
        return reply.status(202).send({ status: "importing" });
      } catch (err) {
        request.log.error({ err }, "segment import-otio failed to start");
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Failed to import OTIO file",
        });
      }
    },
  );
}
