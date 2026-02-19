import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import send from "@fastify/send";
import { basename, dirname, join, resolve } from "path";
import { copyFileSync, existsSync, writeFileSync } from "fs";
import { drizzleDb } from "../../db/index.js";
import { getPodcastOwnerId, canReadLibraryAsset } from "../../services/access.js";
import { getReusableAssetById } from "./repo.js";
import { getSessionById } from "../../services/callSession.js";
import { getWebRtcConfig } from "../../services/webrtcConfig.js";
import {
  segmentPath,
  getWebrtcRecordingsDir,
  multitrackRecordingsDir,
  libraryDir,
  assertPathUnder,
  assertResolvedPathUnder,
  assertSafeId,
  resolveDataPath,
} from "../../services/paths.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import {
  createSegmentFromPath,
  markSegmentRecordFailed,
} from "../../services/segmentFromRecording.js";
import * as audioService from "../../services/audio.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { recordFailureAndMaybeBan } from "../../services/loginAttempts.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { redactSegmentForClient } from "../../utils/segment.js";
import {
  validateRecordingSecret,
  broadcastToSession,
  CALL_JOIN_CONTEXT,
} from "./shared.js";

async function requireRecordingSecret(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const secret = request.headers["x-recording-secret"] as string | undefined;
  const webrtcCfg = getWebRtcConfig();
  if (!validateRecordingSecret(secret, webrtcCfg.recordingCallbackSecret)) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/call/internal/recording-check-storage",
    {
      preHandler: [requireRecordingSecret],
      schema: {
        tags: ["Call"],
        summary: "Check if owner would exceed storage (internal)",
        description:
          "INTERNAL: For WebRTC service only. Do not call from external clients. Called by webrtc service during recording. Returns whether to stop. Requires X-Recording-Secret.",
        body: {
          type: "object",
          properties: {
            sessionId: { type: "string", nullable: true },
            bytesRecordedSoFar: { type: "number" },
          },
          required: ["bytesRecordedSoFar"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { sessionId?: string | null; bytesRecordedSoFar: number };
      const session = body.sessionId ? getSessionById(body.sessionId) : null;
      const podcastId = session?.podcastId;
      const ownerId = podcastId ? getPodcastOwnerId(podcastId) : undefined;
      if (!ownerId) {
        return reply.send({ stop: false });
      }
      const stop = wouldExceedStorageLimit(drizzleDb, ownerId, body.bytesRecordedSoFar);
      return reply.send({
        stop,
        error: stop ? "Storage limit reached. Free up space to record." : undefined,
      });
    },
  );

  app.post(
    "/call/internal/webrtc-connection-failed",
    {
      preHandler: [requireRecordingSecret],
      schema: {
        tags: ["Call"],
        summary: "Record failed WebRTC connection (internal)",
        description:
          "INTERNAL: For WebRTC service only. Do not call from external clients. Called by webrtc service when WS connection is rejected (no/invalid room). Counts toward call_join ban. Requires X-Recording-Secret.",
        body: {
          type: "object",
          properties: {
            ip: { type: "string" },
          },
          required: ["ip"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { ip: string };
      const ip = typeof body?.ip === "string" ? body.ip.trim() || "unknown" : "unknown";
      recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT);
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/call/internal/recording-error",
    {
      preHandler: [requireRecordingSecret],
      schema: {
        tags: ["Call"],
        summary: "Notify recording stopped early (internal)",
        description:
          "INTERNAL: For WebRTC service only. Do not call from external clients. Called by webrtc service when recording stops due to error. Requires X-Recording-Secret.",
        body: {
          type: "object",
          properties: {
            sessionId: { type: "string", nullable: true },
            segmentId: { type: "string", nullable: true },
            error: { type: "string" },
          },
          required: ["error"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        sessionId?: string | null;
        segmentId?: string | null;
        error: string;
      };
      let segmentId = body.segmentId?.trim() || null;
      if (!segmentId && body.sessionId) {
        const sess = getSessionById(body.sessionId);
        segmentId =
          sess?.currentRecordingSegmentId ??
          (Array.isArray(sess?.pendingSegmentIds) && sess.pendingSegmentIds.length > 0
            ? sess.pendingSegmentIds[sess.pendingSegmentIds.length - 1]
            : null);
      }
      if (segmentId) {
        markSegmentRecordFailed(segmentId);
        if (body.sessionId) {
          const sess = getSessionById(body.sessionId);
          if (sess?.pendingSegmentIds) {
            sess.pendingSegmentIds = sess.pendingSegmentIds.filter((id) => id !== segmentId);
            if (sess.pendingSegmentIds.length === 0) sess.pendingSegmentIds = undefined;
          }
        }
      }
      if (body.sessionId) {
        broadcastToSession(body.sessionId, {
          type: "recordingError",
          error: body.error,
        });
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/call/internal/recording-progress",
    {
      preHandler: [requireRecordingSecret],
      schema: {
        tags: ["Call"],
        summary: "Notify recording processing progress (internal)",
        description:
          "INTERNAL: For WebRTC service only. Do not call from external clients. Called by webrtc service to broadcast progress during post-stop processing. Requires X-Recording-Secret.",
        body: {
          type: "object",
          properties: {
            sessionId: { type: "string", nullable: true },
            stage: { type: "string" },
            message: { type: "string", nullable: true },
          },
          required: ["stage"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { sessionId?: string | null; stage: string; message?: string };
      if (body.sessionId) {
        broadcastToSession(body.sessionId, {
          type: "recordingProgress",
          stage: body.stage,
          message: body.message,
        });
      }
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/call/internal/library-stream",
    {
      preHandler: [requireRecordingSecret],
      schema: {
        tags: ["Call"],
        summary: "Stream library asset (internal)",
        description:
          "INTERNAL: For WebRTC service only. Do not call from external clients. Stream audio file for soundboard playback. Requires X-Recording-Secret.",
        querystring: {
          type: "object",
          properties: {
            assetId: { type: "string" },
            sessionId: { type: "string" },
          },
          required: ["assetId", "sessionId"],
        },
        response: {
          200: { description: "Audio stream" },
          206: { description: "Partial content" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { assetId, sessionId } = request.query as { assetId: string; sessionId: string };
      const session = getSessionById(sessionId);
      if (!session) return reply.status(404).send({ error: "Session not found" });
      if (!canReadLibraryAsset(session.hostUserId, assetId)) {
        return reply.status(403).send({ error: "Asset not found" });
      }
      const row = getReusableAssetById(assetId);
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audioPath ? resolveDataPath(row.audioPath) : "";
      const ownerUserId = row.ownerUserId;
      if (!path || !existsSync(path)) return reply.status(404).send({ error: "File not found" });
      const base = libraryDir(ownerUserId);
      const safePath = assertPathUnder(path, base);
      const contentType = contentTypeFromAudioPath(path);
      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        acceptRanges: true,
        cacheControl: false,
      });
      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        return reply.status((err.status ?? 500) as 404 | 500).send({ error: err.message ?? "Internal Server Error" });
      }
      reply.code(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply.header("Content-Type", contentType);
      return reply.send(result.stream);
    },
  );

  app.post(
    "/call/internal/recording-segment",
    {
      preHandler: [requireRecordingSecret],
      schema: {
        tags: ["Call"],
        summary: "Create segment from recording file (internal)",
        description:
          "INTERNAL: For WebRTC service only. Do not call from external clients. Called by the webrtc recording service when a recording is ready. Requires X-Recording-Secret.",
        body: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Path relative to WebRTC recordings dir (e.g. recordings/segmentId.wav)" },
            segmentId: { type: "string" },
            episodeId: { type: "string" },
            podcastId: { type: "string" },
            name: { type: "string", nullable: true },
            sessionId: { type: "string", nullable: true },
            tracksManifest: { type: "object", nullable: true },
            perTrackFilePaths: { type: "array", items: { type: "string" }, nullable: true },
          },
          required: ["filePath", "segmentId", "episodeId", "podcastId"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        filePath: string;
        segmentId: string;
        episodeId: string;
        podcastId: string;
        name?: string | null;
        sessionId?: string | null;
        tracksManifest?: unknown;
        perTrackFilePaths?: string[];
      };
      request.log.debug(
        { filePath: body.filePath, segmentId: body.segmentId, episodeId: body.episodeId },
        "[call] recording-segment callback received",
      );
      try {
        assertSafeId(body.segmentId, "segmentId");
        assertSafeId(body.episodeId, "episodeId");
        assertSafeId(body.podcastId, "podcastId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid ID" });
      }
      try {
        if (body.sessionId) {
          broadcastToSession(body.sessionId, {
            type: "recordingProgress",
            stage: "adding",
            message: "Adding segment to episode…",
          });
        }
        const webrtcDir = getWebrtcRecordingsDir();
        const sourcePath = resolve(join(webrtcDir, body.filePath));
        assertResolvedPathUnder(sourcePath, webrtcDir);
        if (!existsSync(sourcePath)) {
          return reply.status(400).send({ error: "Recording file not found" });
        }
        const destPath = segmentPath(
          body.podcastId,
          body.episodeId,
          body.segmentId,
          "wav",
        );
        copyFileSync(sourcePath, destPath);
        if (!existsSync(destPath)) {
          return reply.status(400).send({
            error: "Recording copy failed: destination file was not created",
          });
        }
        const row = await createSegmentFromPath(
          destPath,
          body.segmentId,
          body.episodeId,
          body.podcastId,
          body.name?.trim() || null,
        );
        request.log.debug({ segmentId: body.segmentId, durationSec: row?.durationSec }, "[call] createSegmentFromPath done");
        let pendingSegmentIds: string[] = [];
        if (body.sessionId) {
          const sess = getSessionById(body.sessionId);
          const beforePending = sess?.pendingSegmentIds ?? [];
          if (sess?.pendingSegmentIds) {
            sess.pendingSegmentIds = sess.pendingSegmentIds.filter((id) => id !== body.segmentId);
            if (sess.pendingSegmentIds.length === 0) sess.pendingSegmentIds = undefined;
          }
          const sessAfterAdd = getSessionById(body.sessionId);
          pendingSegmentIds = sessAfterAdd?.pendingSegmentIds ?? [];
          request.log.debug({ before: beforePending, after: pendingSegmentIds }, "[call] session pendingSegmentIds updated");
          broadcastToSession(body.sessionId, {
            type: "segmentRecorded",
            segment: redactSegmentForClient(row),
            pendingSegmentIds,
          });
        }
        const episodePayload: { type: "segmentAdded"; segment: unknown; pendingSegmentIds?: string[]; recordingInProgress?: boolean } = {
          type: "segmentAdded",
          segment: redactSegmentForClient(row),
        };
        if (body.sessionId) {
          episodePayload.pendingSegmentIds = pendingSegmentIds;
          episodePayload.recordingInProgress = false;
        }
        request.log.debug(
          { episodeId: body.episodeId, segmentId: body.segmentId, pendingSegmentIds: episodePayload.pendingSegmentIds },
          "[call] broadcasting segmentAdded to episode",
        );
        broadcastToEpisode(body.episodeId, episodePayload);
        // Source file is deleted by the WebRTC service after successful callback (same process that created it).
        if (body.tracksManifest && Array.isArray(body.perTrackFilePaths) && body.perTrackFilePaths.length > 0) {
          try {
            const manifest = body.tracksManifest as { recordingEpochMs?: number } | undefined;
            const recordingEpochMs = typeof manifest?.recordingEpochMs === "number" ? manifest.recordingEpochMs : undefined;
            const mtDir = multitrackRecordingsDir(body.podcastId, body.episodeId, body.segmentId, recordingEpochMs);
            writeFileSync(join(mtDir, "tracks_manifest.json"), JSON.stringify(body.tracksManifest, null, 2));
            const webrtcDir = getWebrtcRecordingsDir();
            const copiedBases: string[] = [];
            for (const relPath of body.perTrackFilePaths) {
              const src = resolve(join(webrtcDir, relPath));
              assertResolvedPathUnder(src, webrtcDir);
              if (existsSync(src)) {
                const base = relPath.split("/").pop() ?? relPath;
                copyFileSync(src, join(mtDir, base));
                copiedBases.push(base);
                // Per-track files are deleted by the WebRTC service after successful callback.
              }
            }
            setImmediate(() => {
              for (const base of copiedBases) {
                const audioPath = join(mtDir, base);
                if (existsSync(audioPath)) {
                  audioService.generateWaveformFile(audioPath, mtDir).catch((err) => {
                    request.log.warn({ err, segmentId: body.segmentId, file: base }, "Per-track waveform failed");
                  });
                }
              }
            });
          } catch (mtErr) {
            request.log.warn({ err: mtErr }, "Failed to save multitrack files (segment created successfully)");
          }
        }
        return reply.status(201).send(redactSegmentForClient(row));
      } catch (err) {
        request.log.error(err);
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Failed" });
      }
    },
  );
}
