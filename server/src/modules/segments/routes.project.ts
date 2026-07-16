import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import { assertSafeId } from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { redactSegmentForClient } from "../../utils/segment.js";
import {
  ImportValidationError,
  removeTempPath,
  writeTempZip,
} from "../episodes/projectImport.js";
import { getOrBuildSegmentProjectZip } from "../episodes/projectSegmentExport.js";
import { importSegmentProjectZip } from "../episodes/projectSegmentImport.js";
import { getPodcastTitle } from "../audio/repo.js";
import * as episodeRepo from "../episodes/repo.js";
import { mergeTrimRanges, waveformPath } from "./utils.js";
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
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
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

  app.get(
    "/episodes/:episodeId/segments/:segmentId/project-export",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Download segment project zip",
        description:
          "Download a HarborFM segment project zip (kind: segment). Editors and above only. Cached under /tmp (best-effort).",
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
      // Allow export when audio or multitrack exists (packSegment may still write metadata)
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

  app.post(
    "/episodes/:episodeId/segments/:segmentId/import-project",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Import segment project zip (overwrite)",
        description:
          "Upload a HarborFM segment project zip and overwrite this segment in place. Editors and above only.",
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
          400: { description: "Invalid zip" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
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

      let tmpZip: string | null = null;
      try {
        const buffer = await data.toBuffer();
        if (!buffer.length) {
          return reply.status(400).send({ error: "Empty zip file" });
        }
        tmpZip = writeTempZip(buffer);
        await importSegmentProjectZip(
          access.podcastId,
          episodeId,
          segmentId,
          tmpZip,
          request.userId!,
        );

        const row = repo.getSegmentById(segmentId, episodeId);
        if (!row) {
          return reply.status(404).send({ error: "Segment not found" });
        }
        const audio = repo.getSegmentAudioPath(
          row,
          access.podcastId,
          episodeId,
        );
        const waveformExists =
          audio && existsSync(audio.path)
            ? existsSync(waveformPath(audio.path))
            : false;
        broadcastToEpisode(episodeId, { type: "segmentUpdated", segmentId });
        return redactSegmentForClient({
          ...row,
          waveformExists,
        });
      } catch (err) {
        if (err instanceof ImportValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        request.log.error({ err }, "segment import-project failed");
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to import project",
        });
      } finally {
        if (tmpZip) removeTempPath(tmpZip);
      }
    },
  );
}
