import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import send from "@fastify/send";
import { basename, dirname } from "path";
import { db } from "../../db/index.js";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import type { JWTPayload } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments, getPodcastOwnerId, canReadLibraryAsset } from "../../services/access.js";
import { nanoid } from "nanoid";
import type { CallParticipant } from "../../services/callSession.js";
import {
  createSession,
  getSessionByToken,
  getSessionById,
  getSessionByIdRaw,
  getSessionByCode,
  getSessionForJoinInfo,
  ensureSessionJoinCode,
  updateHostHeartbeat,
  addParticipant,
  removeParticipant,
  endSession,
  verifyPassword,
  getActiveSessionForEpisode,
  getAnyActiveSessionForEpisode,
  getActiveSessionCount,
  setSessionRoomId,
  setSessionHostToken,
  setParticipantMutedBySelf,
  setParticipantMutedByHost,
  setParticipantName,
  setHostDisconnected,
  clearHostDisconnected,
} from "../../services/callSession.js";
import { getWebRtcConfig, webrtcRequestHeaders } from "../../services/webrtcConfig.js";
import { join, resolve } from "path";
import { copyFileSync, unlinkSync, existsSync, writeFileSync } from "fs";
import { segmentPath, getWebrtcRecordingsDir, multitrackRecordingsDir, libraryDir } from "../../services/paths.js";
import { assertPathUnder, assertResolvedPathUnder } from "../../services/paths.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import { createSegmentFromPath } from "../../services/segmentFromRecording.js";
import * as audioService from "../../services/audio.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { RECORD_MIN_FREE_BYTES, WEBRTC_ENABLED } from "../../config.js";
import {
  getClientIp,
  getIpBan,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";

const CALL_JOIN_CONTEXT = "call_join" as const;

const sessionSockets = new Map<string, Set<WebSocket>>(); // sessionId -> Set<WebSocket>
const socketToParticipant = new Map<
  WebSocket,
  { sessionId: string; participantId: string }
>();
// Sockets that connected as host but were told "alreadyInCall" - awaiting migrateHost
const pendingMigrateHosts = new Map<
  WebSocket,
  { sessionId: string; participantId: string; hostName?: string }
>();
// When each host socket was added (for detecting React StrictMode remount)
const hostSocketAddedAt = new Map<WebSocket, number>();

function broadcastToSession(sessionId: string, payload: object): void {
  const sockets = sessionSockets.get(sessionId);
  if (!sockets) return;
  const data = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

function removeSocketFromSession(sessionId: string, ws: WebSocket): void {
  const sockets = sessionSockets.get(sessionId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) sessionSockets.delete(sessionId);
  }
}

/** Extract base origin (scheme + host) from request headers. Origin header is preferred; referer is parsed to get origin (not just path-stripped). */
function getRequestOrigin(
  origin: string | undefined,
  referer: string | undefined
): string {
  if (origin) return origin;
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

export async function callRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/call/start",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Call"],
        summary: "Start group call",
        description:
          "Create a call session for an episode. Returns token and join URL.",
        body: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            password: { type: "string", nullable: true },
          },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Session created",
            type: "object",
            properties: {
              token: { type: "string" },
              sessionId: { type: "string" },
              joinUrl: { type: "string" },
              joinCode: { type: "string", description: "4-digit code for quick join from Dashboard" },
              webrtcUrl: { type: "string", nullable: true },
              roomId: { type: "string", nullable: true },
              hostToken: { type: "string", nullable: true },
              webrtcUnavailable: { type: "boolean", nullable: true },
            },
          },
          403: { description: "No permission" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { episodeId: string; password?: string };
      const episodeId = body.episodeId;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });

      const existing = getActiveSessionForEpisode(episodeId, request.userId);
      const anyExisting = getAnyActiveSessionForEpisode(episodeId);
      if (anyExisting && anyExisting.hostUserId !== request.userId) {
        return reply.status(409).send({
          error: "A call is already in progress for this episode.",
        });
      }
      if (existing) {
        ensureSessionJoinCode(existing);
        const origin = getRequestOrigin(
          request.headers["origin"] as string | undefined,
          request.headers["referer"] as string | undefined
        );
        const joinUrl = origin ? `${origin}/call/join/${existing.token}` : "";
        const payload: Record<string, unknown> = {
          token: existing.token,
          sessionId: existing.sessionId,
          joinUrl: joinUrl || `/call/join/${existing.token}`,
          joinCode: existing.joinCode,
        };
        const webrtcCfg = getWebRtcConfig();
        if (WEBRTC_ENABLED && existing.roomId && webrtcCfg.publicWsUrl) {
          payload.webrtcUrl =
            webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
          payload.roomId = existing.roomId;
          if (existing.hostToken) payload.hostToken = existing.hostToken;
        }
        return reply.send(payload);
      }

      const episodeRow = db
        .prepare("SELECT podcast_id FROM episodes WHERE id = ?")
        .get(episodeId) as { podcast_id: string } | undefined;
      if (!episodeRow)
        return reply.status(404).send({ error: "Episode not found" });
      const podcastId = episodeRow.podcast_id;

      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined
      );
      const session = createSession(
        episodeId,
        podcastId,
        request.userId,
        origin,
        body.password ?? null,
        async (endedSession) => {
          if (
            endedSession.roomId &&
            endedSession.recordingInProgress === true
          ) {
            const webrtcCfg = getWebRtcConfig();
            if (webrtcCfg?.serviceUrl) {
              try {
                await fetch(
                  `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/stop-recording`,
                  {
                    method: "POST",
                    headers: webrtcRequestHeaders(webrtcCfg),
                    body: JSON.stringify({ roomId: endedSession.roomId }),
                  },
                );
              } catch (err) {
                request.log.warn(
                  { err, roomId: endedSession.roomId },
                  "WebRTC stop-recording failed on host-away call end",
                );
              }
            }
          }
          broadcastToSession(endedSession.sessionId, { type: "callEnded" });
          broadcastToEpisode(endedSession.episodeId, { type: "callEnded" });
          sessionSockets.delete(endedSession.sessionId);
        },
      );
      let webrtcUrl: string | null = null;
      let roomId: string | null = null;
      let webrtcUnavailable = false;
      const webrtcCfg = getWebRtcConfig();
      const publicWsBase = webrtcCfg.publicWsUrl
        ? webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws"
        : origin
          ? (() => {
              try {
                return (
                  new URL(origin).origin.replace(/^http/, "ws").replace(/^https/, "wss") +
                  "/webrtc-ws/ws"
                );
              } catch {
                return null;
              }
            })()
          : null;
      if (WEBRTC_ENABLED && webrtcCfg.serviceUrl) {
        const hostToken = nanoid(24);
        const roomUrl = `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/room`;
        const roomBody = JSON.stringify({
          roomId: session.sessionId,
          hostToken,
        });
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const roomRes = await fetch(roomUrl, {
              method: "POST",
              headers: webrtcRequestHeaders(webrtcCfg),
              body: roomBody,
            });
            if (roomRes.ok && publicWsBase) {
              const roomData = (await roomRes.json()) as { roomId: string };
              roomId = roomData.roomId;
              setSessionRoomId(session.sessionId, roomId);
              setSessionHostToken(session.sessionId, hostToken);
              webrtcUrl = publicWsBase;
              console.log("[call] room created ok", { sessionId: session.sessionId, attempt });
              break;
            }
            console.log("[call] room POST not ok", { sessionId: session.sessionId, attempt, status: roomRes.status });
            if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
          } catch (err) {
            console.log("[call] room POST failed", { sessionId: session.sessionId, attempt, err: String(err) });
            if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
          }
        }
        if (!roomId) webrtcUnavailable = true;
      }
      const joinUrl = origin ? `${origin}/call/join/${session.token}` : "";
      const payload: Record<string, unknown> = {
        token: session.token,
        sessionId: session.sessionId,
        joinUrl: joinUrl || `/call/join/${session.token}`,
        joinCode: session.joinCode,
      };
      if (webrtcUrl && roomId) {
        payload.webrtcUrl = webrtcUrl;
        payload.roomId = roomId;
        if (session.hostToken) payload.hostToken = session.hostToken;
      }
      if (webrtcUnavailable) payload.webrtcUnavailable = true;
      broadcastToEpisode(episodeId, {
        type: "callStarted",
        sessionId: session.sessionId,
        joinUrl: payload.joinUrl,
        joinCode: session.joinCode,
        webrtcUrl: payload.webrtcUrl,
        roomId: payload.roomId,
        hostToken: payload.hostToken,
      });
      return reply.send(payload);
    },
  );

  app.get(
    "/call/by-code/:code",
    {
      schema: {
        tags: ["Call"],
        summary: "Look up call by 4-digit code",
        description:
          "Returns the join token if a call exists with the given 4-digit code. No auth required.",
        params: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
        },
        response: {
          200: {
            description: "Token for joining, or alreadyConnected if requester is the host",
            type: "object",
            properties: {
              token: { type: "string" },
              alreadyConnected: { type: "boolean", description: "True when requester is the host and already in the call" },
              episodeId: { type: "string", description: "Episode ID when alreadyConnected, for redirect" },
            },
            required: ["token"],
          },
          404: { description: "No call found for this code" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code } = request.params as { code: string };
      const ip = getClientIp(request);
      const ban = getIpBan(ip, CALL_JOIN_CONTEXT);
      if (ban.banned) {
        return reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({ error: "Too many failed attempts", retryAfterSec: ban.retryAfterSec });
      }
      const session = getSessionByCode(code);
      if (!session) {
        const normalized = String(code ?? "").trim();
        request.log.info(
          {
            code: normalized,
            formatOk: normalized.length === 4 && /^\d{4}$/.test(normalized),
            activeSessionCount: getActiveSessionCount(),
          },
          "call by-code: no session found",
        );
        recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
          userAgent: request.headers["user-agent"],
        });
        return reply.status(404).send({ error: "No call found for this code" });
      }
      let alreadyConnected = false;
      try {
        await request.jwtVerify();
        const payload = request.user as { sub?: string };
        if (payload?.sub && session.hostUserId === payload.sub) {
          alreadyConnected = true;
        }
      } catch {
        /* not authenticated - guest flow */
      }
      const body: { token: string; alreadyConnected?: boolean; episodeId?: string } = {
        token: session.token,
      };
      if (alreadyConnected) {
        body.alreadyConnected = true;
        body.episodeId = session.episodeId;
      }
      return reply.send(body);
    },
  );

  app.get(
    "/call/join-info/:token",
    {
      schema: {
        tags: ["Call"],
        summary: "Get join info (public)",
        description:
          "Returns podcast and episode info for the join page. No auth required.",
        params: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
        response: {
          200: {
            description: "Join info",
            type: "object",
            properties: {
              podcast: { type: "object", properties: { title: { type: "string" } } },
              episode: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  id: { type: "string" },
                },
              },
              hostName: { type: "string", description: "Current host display name" },
              passwordRequired: { type: "boolean", description: "True when host set a password" },
              artworkUrl: { type: "string", nullable: true, description: "Podcast or episode cover URL" },
            },
          },
          404: { description: "Invalid or ended session" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      const ip = getClientIp(request);
      const ban = getIpBan(ip, CALL_JOIN_CONTEXT);
      if (ban.banned) {
        return reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({ error: "Too many failed attempts", retryAfterSec: ban.retryAfterSec });
      }
      const session = getSessionForJoinInfo(token);
      if (!session) {
        recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
          userAgent: request.headers["user-agent"],
        });
        return reply.status(404).send({ error: "Invalid or expired link" });
      }

      const podcast = db
        .prepare("SELECT title, artwork_path, artwork_url FROM podcasts WHERE id = ?")
        .get(session.podcastId) as { title: string; artwork_path: string | null; artwork_url: string | null } | undefined;
      const episode = db
        .prepare("SELECT id, title, artwork_path, artwork_url FROM episodes WHERE id = ? AND podcast_id = ?")
        .get(session.episodeId, session.podcastId) as { id: string; title: string; artwork_path: string | null; artwork_url: string | null } | undefined;
      if (!podcast || !episode)
        return reply.status(404).send({ error: "Show or episode not found" });

      const hostP = session.participants.find((p) => p.isHost);
      const hostName = hostP?.name ?? "Host";
      const passwordRequired = Boolean(session.password && session.password.trim());

      let artworkUrl: string | null = null;
      if (episode.artwork_url) {
        artworkUrl = episode.artwork_url;
      } else if (episode.artwork_path) {
        const fn = episode.artwork_path.split(/[/\\]/).pop();
        if (fn) artworkUrl = `/api/public/artwork/${session.podcastId}/episodes/${episode.id}/${encodeURIComponent(fn)}`;
      }
      if (!artworkUrl && podcast.artwork_url) artworkUrl = podcast.artwork_url;
      if (!artworkUrl && podcast.artwork_path) {
        const fn = podcast.artwork_path.split(/[/\\]/).pop();
        if (fn) artworkUrl = `/api/public/artwork/${session.podcastId}/${encodeURIComponent(fn)}`;
      }

      return reply.send({
        podcast: { title: podcast.title },
        episode: { id: episode.id, title: episode.title },
        hostName,
        passwordRequired,
        artworkUrl,
      });
    },
  );

  app.get(
    "/call/session",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Call"],
        summary: "Get active session for episode",
        description:
          "If the user has an active call for this episode, return session info.",
        querystring: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Session if active",
            type: "object",
            nullable: true,
            properties: {
              sessionId: { type: "string" },
              token: { type: "string" },
              joinUrl: { type: "string" },
              joinCode: { type: "string", description: "4-digit code for quick join from Dashboard" },
              webrtcUrl: { type: "string", nullable: true },
              roomId: { type: "string", nullable: true },
              hostToken: { type: "string", nullable: true },
              webrtcUnavailable: { type: "boolean", nullable: true },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { episodeId } = request.query as { episodeId: string };
      const session = getActiveSessionForEpisode(episodeId, request.userId);
      if (!session) return reply.send(null);
      ensureSessionJoinCode(session);
      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined
      );
      const joinUrl = origin ? `${origin}/call/join/${session.token}` : "";
      const payload: Record<string, unknown> = {
        sessionId: session.sessionId,
        token: session.token,
        joinUrl: joinUrl || `/call/join/${session.token}`,
        joinCode: session.joinCode,
      };
      const webrtcCfg = getWebRtcConfig();
      const publicWs =
        (webrtcCfg.publicWsUrl &&
          webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws") ||
        (origin
          ? (() => {
              try {
                return (
                  new URL(origin).origin.replace(/^http/, "ws").replace(/^https/, "wss") +
                  "/webrtc-ws/ws"
                );
              } catch {
                return null;
              }
            })()
          : null);
      if (session.roomId && publicWs) {
        payload.webrtcUrl = publicWs;
        payload.roomId = session.roomId;
        if (session.hostToken) payload.hostToken = session.hostToken;
      }
      return reply.send(payload);
    },
  );

  app.post(
    "/call/internal/recording-check-storage",
    {
      schema: {
        tags: ["Call"],
        summary: "Check if owner would exceed storage (internal)",
        description:
          "Called by webrtc service during recording. Returns whether to stop. Requires X-Recording-Secret.",
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
      const secret = request.headers["x-recording-secret"] as string | undefined;
      const webrtcCfg = getWebRtcConfig();
      if (!webrtcCfg.recordingCallbackSecret || secret !== webrtcCfg.recordingCallbackSecret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body as { sessionId?: string | null; bytesRecordedSoFar: number };
      const session = body.sessionId ? getSessionById(body.sessionId) : null;
      const podcastId = session?.podcastId;
      const ownerId = podcastId ? getPodcastOwnerId(podcastId) : undefined;
      if (!ownerId) {
        return reply.send({ stop: false });
      }
      const stop = wouldExceedStorageLimit(db, ownerId, body.bytesRecordedSoFar);
      return reply.send({
        stop,
        error: stop ? "Storage limit reached. Free up space to record." : undefined,
      });
    },
  );

  app.post(
    "/call/internal/webrtc-connection-failed",
    {
      schema: {
        tags: ["Call"],
        summary: "Record failed WebRTC connection (internal)",
        description:
          "Called by webrtc service when WS connection is rejected (no/invalid room). Counts toward call_join ban. Requires X-Recording-Secret.",
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
      const secret = request.headers["x-recording-secret"] as string | undefined;
      const webrtcCfg = getWebRtcConfig();
      if (!webrtcCfg.recordingCallbackSecret || secret !== webrtcCfg.recordingCallbackSecret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body as { ip: string };
      const ip = typeof body?.ip === "string" ? body.ip.trim() || "unknown" : "unknown";
      recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT);
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/call/internal/recording-error",
    {
      schema: {
        tags: ["Call"],
        summary: "Notify recording stopped early (internal)",
        description:
          "Called by webrtc service when recording stops due to error. Requires X-Recording-Secret.",
        body: {
          type: "object",
          properties: {
            sessionId: { type: "string", nullable: true },
            error: { type: "string" },
          },
          required: ["error"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-recording-secret"] as string | undefined;
      const webrtcCfg = getWebRtcConfig();
      if (!webrtcCfg.recordingCallbackSecret || secret !== webrtcCfg.recordingCallbackSecret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const body = request.body as { sessionId?: string | null; error: string };
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
      schema: {
        tags: ["Call"],
        summary: "Notify recording processing progress (internal)",
        description:
          "Called by webrtc service to broadcast progress during post-stop processing. Requires X-Recording-Secret.",
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
      const secret = request.headers["x-recording-secret"] as string | undefined;
      const webrtcCfg = getWebRtcConfig();
      if (!webrtcCfg.recordingCallbackSecret || secret !== webrtcCfg.recordingCallbackSecret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
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
      schema: {
        tags: ["Call"],
        summary: "Stream library asset (internal)",
        description:
          "Stream audio file for soundboard playback. Requires X-Recording-Secret. Used by webrtc service.",
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
      const secret = request.headers["x-recording-secret"] as string | undefined;
      const webrtcCfg = getWebRtcConfig();
      if (!webrtcCfg.recordingCallbackSecret || secret !== webrtcCfg.recordingCallbackSecret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const { assetId, sessionId } = request.query as { assetId: string; sessionId: string };
      const session = getSessionById(sessionId);
      if (!session) return reply.status(404).send({ error: "Session not found" });
      if (!canReadLibraryAsset(session.hostUserId, assetId)) {
        return reply.status(403).send({ error: "Asset not found" });
      }
      const row = db
        .prepare("SELECT * FROM reusable_assets WHERE id = ?")
        .get(assetId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audio_path as string;
      const ownerUserId = row.owner_user_id as string;
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
      schema: {
        tags: ["Call"],
        summary: "Create segment from recording file (internal)",
        description:
          "Called by the webrtc recording service when a recording is ready. Requires X-Recording-Secret.",
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
      const secret = request.headers["x-recording-secret"] as string | undefined;
      const webrtcCfg = getWebRtcConfig();
      if (!webrtcCfg.recordingCallbackSecret || secret !== webrtcCfg.recordingCallbackSecret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
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
        if (body.sessionId) {
          broadcastToSession(body.sessionId, {
            type: "segmentRecorded",
            segment: row,
          });
        }
        broadcastToEpisode(body.episodeId, { type: "segmentAdded", segment: row });
        try {
          unlinkSync(sourcePath);
        } catch (unlinkErr) {
          request.log.warn(
            { err: unlinkErr, sourcePath },
            "Could not remove source recording file (permission denied); segment created successfully",
          );
        }
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
                try {
                  unlinkSync(src);
                } catch {
                  /* ignore */
                }
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
        return reply.status(201).send(row);
      } catch (err) {
        request.log.error(err);
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Failed" });
      }
    },
  );

  app.get(
    "/call/ws",
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      let sessionId: string | null = null;
      let participantId: string | null = null;
      let isHost = false;
      let initialized = false;

      socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        let msg: unknown;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object" || !("type" in msg)) return;
        const type = (msg as { type: string }).type;

        if (!initialized) {
          if (type === "host") {
            const sessionIdParam = (msg as { sessionId?: string }).sessionId;
            const hostName = (msg as { name?: string }).name;
            if (!sessionIdParam) return;
            req.jwtVerify()
              .then(() => {
                const userId = (req.user as JWTPayload).sub;
                const session = getSessionById(sessionIdParam);
                if (
                  !session ||
                  session.ended ||
                  session.hostUserId !== userId
                ) {
                  const raw = getSessionByIdRaw(sessionIdParam);
                  req.log.warn(
                    {
                      sessionId: sessionIdParam,
                      jwtUserId: userId,
                      sessionExists: !!raw,
                      sessionEnded: raw?.ended,
                      sessionHostUserId: raw?.hostUserId,
                    },
                    "Call host rejected: Invalid session",
                  );
                  socket.send(
                    JSON.stringify({ type: "error", error: "Invalid session" }),
                  );
                  socket.close();
                  return;
                }
                sessionId = session.sessionId;
                const hostP = session.participants.find((p) => p.isHost);
                participantId = hostP?.id ?? null;
                isHost = true;

                // Check if another tab already has the host connected.
                // If existing host socket was added very recently (<500ms), treat as React StrictMode
                // remount and auto-replace instead of showing "already in call".
                const OPEN = 1;
                const REMOUNT_GRACE_MS = 500;
                const existingSockets = sessionSockets.get(sessionId);
                let existingHostSocket: WebSocket | null = null;
                if (existingSockets) {
                  for (const s of existingSockets) {
                    if (s === socket) continue;
                    if ((s as WebSocket & { readyState?: number }).readyState !== OPEN) continue;
                    const ent = socketToParticipant.get(s);
                    if (ent?.participantId !== participantId) continue;
                    const addedAt = hostSocketAddedAt.get(s);
                    if (addedAt != null && Date.now() - addedAt < REMOUNT_GRACE_MS) {
                      try {
                        s.close();
                      } catch {
                        /* ignore */
                      }
                      sessionSockets.get(sessionId)?.delete(s);
                      socketToParticipant.delete(s);
                      hostSocketAddedAt.delete(s);
                      break;
                    }
                    existingHostSocket = s;
                    break;
                  }
                }

                if (existingHostSocket) {
                  socket.send(
                    JSON.stringify({ type: "alreadyInCall", canMigrate: true }),
                  );
                  pendingMigrateHosts.set(socket as unknown as WebSocket, {
                    sessionId,
                    participantId: participantId!,
                    hostName:
                      hostName != null && String(hostName).trim()
                        ? String(hostName).trim()
                        : undefined,
                  });
                  return;
                }

                initialized = true;
                if (participantId && hostName != null && String(hostName).trim()) {
                  setParticipantName(sessionId, participantId, String(hostName).trim());
                }
                let set = sessionSockets.get(sessionId);
                if (!set) {
                  set = new Set();
                  sessionSockets.set(sessionId, set);
                }
                set.add(socket);
                if (participantId) {
                  socketToParticipant.set(socket as unknown as WebSocket, {
                    sessionId,
                    participantId,
                  });
                  hostSocketAddedAt.set(socket as unknown as WebSocket, Date.now());
                }
                updateHostHeartbeat(sessionId);
                clearHostDisconnected(sessionId);
                broadcastToSession(sessionId, {
                  type: "participants",
                  participants: [...session.participants],
                });
                const hostJoinedPayload: Record<string, unknown> = {
                    type: "joined",
                    sessionId,
                    participantId,
                    isHost: true,
                    participants: [...session.participants],
                    recordingInProgress: session.recordingInProgress === true,
                    recordingStartedAtEpochMs: session.recordingStartedAtEpochMs,
                  };
                  const webrtcCfg = getWebRtcConfig();
                  const publicWs =
                    (webrtcCfg.publicWsUrl &&
                      webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/^https/, "wss").replace(/\/$/, "") + "/ws") ||
                    (() => {
                      const o = getRequestOrigin(
                        req.headers.origin as string | undefined,
                        req.headers.referer as string | undefined
                      );
                      if (o) {
                        try {
                          const base = new URL(o).origin.replace(/^http/, "ws").replace(/^https/, "wss");
                          return `${base}/webrtc-ws/ws`;
                        } catch {
                          return null;
                        }
                      }
                      return null;
                    })();
                  if (session.roomId && publicWs) {
                    hostJoinedPayload.webrtcUrl = publicWs;
                    hostJoinedPayload.roomId = session.roomId;
                    if (session.hostToken) hostJoinedPayload.hostToken = session.hostToken;
                  }
                  socket.send(JSON.stringify(hostJoinedPayload));
              })
              .catch(() => {
                socket.send(
                  JSON.stringify({ type: "error", error: "Unauthorized" }),
                );
                socket.close();
              });
            return;
          }
          if (type === "migrateHost") {
            const pending = pendingMigrateHosts.get(socket as unknown as WebSocket);
            if (!pending) return;
            const { sessionId: sid, participantId: pid, hostName: hn } = pending;
            const sess = getSessionById(sid);
            if (!sess || sess.ended) {
              pendingMigrateHosts.delete(socket as unknown as WebSocket);
              socket.send(JSON.stringify({ type: "error", error: "Session ended" }));
              socket.close();
              return;
            }
            // Close existing host socket(s)
            const existingSet = sessionSockets.get(sid);
            if (existingSet) {
              for (const s of Array.from(existingSet)) {
                const ent = socketToParticipant.get(s);
                if (ent?.participantId === pid) {
                  try {
                    s.close();
                  } catch {
                    /* ignore */
                  }
                  existingSet.delete(s);
                  socketToParticipant.delete(s);
                }
              }
              if (existingSet.size === 0) sessionSockets.delete(sid);
            }
            // Add this socket as the new host
            sessionId = sid;
            participantId = pid;
            isHost = true;
            initialized = true;
            pendingMigrateHosts.delete(socket as unknown as WebSocket);
            updateHostHeartbeat(sid);
            if (hn) setParticipantName(sid, pid, hn);
            let newSet = sessionSockets.get(sid);
            if (!newSet) {
              newSet = new Set();
              sessionSockets.set(sid, newSet);
            }
            newSet.add(socket);
            socketToParticipant.set(socket as unknown as WebSocket, {
              sessionId: sid,
              participantId: pid,
            });
            clearHostDisconnected(sid);
            broadcastToSession(sid, {
              type: "participants",
              participants: [...sess.participants],
            });
            const hostJoinedPayload: Record<string, unknown> = {
              type: "joined",
              sessionId: sid,
              participantId: pid,
              isHost: true,
              participants: [...sess.participants],
              recordingInProgress: sess.recordingInProgress === true,
              recordingStartedAtEpochMs: sess.recordingStartedAtEpochMs,
            };
            const webrtcCfg = getWebRtcConfig();
            const publicWs =
              (webrtcCfg.publicWsUrl &&
                webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/^https/, "wss").replace(/\/$/, "") + "/ws") ||
              (() => {
                const o = getRequestOrigin(
                  req.headers.origin as string | undefined,
                  req.headers.referer as string | undefined
                );
                if (o) {
                  try {
                    const base = new URL(o).origin.replace(/^http/, "ws").replace(/^https/, "wss");
                    return `${base}/webrtc-ws/ws`;
                  } catch {
                    return null;
                  }
                }
                return null;
              })();
            if (sess.roomId && publicWs) {
              hostJoinedPayload.webrtcUrl = publicWs;
              hostJoinedPayload.roomId = sess.roomId;
              if (sess.hostToken) hostJoinedPayload.hostToken = sess.hostToken;
            }
            socket.send(JSON.stringify(hostJoinedPayload));
            return;
          }
          if (type === "guest") {
            const guestToken = (msg as { token?: string }).token;
            const name = (msg as { name?: string }).name;
            const password = (msg as { password?: string }).password;
            if (!guestToken) {
              socket.send(
                JSON.stringify({ type: "error", error: "Token required" }),
              );
              socket.close();
              return;
            }
            const ip = getClientIp(req);
            const ban = getIpBan(ip, CALL_JOIN_CONTEXT);
            if (ban.banned) {
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: "Too many failed attempts",
                  retryAfterSec: ban.retryAfterSec,
                }),
              );
              socket.close();
              return;
            }
            const session = getSessionByToken(guestToken);
            if (!session) {
              recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
                userAgent: req.headers["user-agent"],
              });
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: "Invalid or expired link",
                }),
              );
              socket.close();
              return;
            }
            if (!verifyPassword(session, password ?? "")) {
              recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
                userAgent: req.headers["user-agent"],
              });
              socket.send(
                JSON.stringify({ type: "error", error: "Wrong password" }),
              );
              socket.close();
              return;
            }
            const pid = nanoid();
            const p = addParticipant(session.sessionId, pid, name ?? "Guest");
            if (!p) {
              socket.send(
                JSON.stringify({ type: "error", error: "Could not join" }),
              );
              socket.close();
              return;
            }
            sessionId = session.sessionId;
            participantId = p.id;
            initialized = true;
            let set = sessionSockets.get(sessionId);
            if (!set) {
              set = new Set();
              sessionSockets.set(sessionId, set);
            }
            set.add(socket);
            socketToParticipant.set(socket as unknown as WebSocket, {
              sessionId,
              participantId,
            });
            const webrtcJoinedPayload: Record<string, unknown> = {
              type: "joined",
              sessionId,
              participantId,
              isHost: false,
              participants: session.participants,
              recordingInProgress: session.recordingInProgress === true,
            };
            if (session.hostDisconnectedAt != null && session.hostDisconnectGraceMs != null) {
              webrtcJoinedPayload.hostDisconnected = true;
              webrtcJoinedPayload.gracePeriodMs = session.hostDisconnectGraceMs;
              webrtcJoinedPayload.endsAt = session.hostDisconnectedAt + session.hostDisconnectGraceMs;
            }
            const webrtcCfg = getWebRtcConfig();
            const hasRoom = Boolean(session.roomId && webrtcCfg.publicWsUrl);
            console.log("[call] guest join", {
              sessionId,
              roomId: session.roomId,
              hasRoom,
              hasServiceUrl: !!webrtcCfg.serviceUrl,
              hasPublicWs: !!webrtcCfg.publicWsUrl,
            });
            if (!hasRoom && webrtcCfg.serviceUrl) {
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: "Call is not ready. The host's connection failed. Please ask them to refresh and try again.",
                }),
              );
              socket.close();
              return;
            }
            if (hasRoom) {
              webrtcJoinedPayload.webrtcUrl =
                webrtcCfg.publicWsUrl!.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
              webrtcJoinedPayload.roomId = session.roomId;
            }
            socket.send(JSON.stringify(webrtcJoinedPayload));
            broadcastToSession(sessionId, {
              type: "participantJoined",
              participant: p,
            });
            return;
          }
          return;
        }

        if (!sessionId) return;

        if (type === "heartbeat") {
          if (isHost && updateHostHeartbeat(sessionId)) {
            const session = getSessionById(sessionId);
            const payload: { type: string; participants?: CallParticipant[] } = {
              type: "heartbeatAck",
            };
            if (session) {
              payload.participants = [...session.participants];
            }
            socket.send(JSON.stringify(payload));
          }
          return;
        }

        if (type === "updateHostName" && isHost && participantId) {
          const name = (msg as { name?: string }).name;
          if (name != null && typeof name === "string") {
            setParticipantName(sessionId, participantId, name);
            const session = getSessionById(sessionId);
            if (session) {
              broadcastToSession(sessionId, {
                type: "participants",
                participants: [...session.participants],
              });
            }
          }
          return;
        }

        if (type === "updateParticipantName" && participantId) {
          const name = (msg as { name?: string }).name;
          if (name != null && typeof name === "string") {
            setParticipantName(sessionId, participantId, name);
            const session = getSessionById(sessionId);
            if (session) {
              broadcastToSession(sessionId, {
                type: "participants",
                participants: [...session.participants],
              });
            }
          }
          return;
        }

        if (type === "leave") {
          if (participantId && !isHost) {
            removeParticipant(sessionId, participantId);
            broadcastToSession(sessionId, {
              type: "participants",
              participants: getSessionById(sessionId)?.participants ?? [],
            });
          }
          removeSocketFromSession(sessionId, socket);
          return;
        }

        if (type === "chat" && participantId) {
          const text = (msg as { text?: string }).text;
          if (text != null && typeof text === "string") {
            const trimmed = text.trim().slice(0, 2000);
            if (trimmed) {
              const session = getSessionById(sessionId);
              const p = session?.participants.find((x) => x.id === participantId);
              const name = p?.name ?? "Unknown";
              broadcastToSession(sessionId, {
                type: "chat",
                participantId,
                participantName: name,
                text: trimmed,
              });
            }
          }
          return;
        }

        if (type === "startRecording" && isHost) {
          const sid = sessionId;
          if (sid) updateHostHeartbeat(sid);
          const session = getSessionById(sid);
          if (session?.recordingInProgress) {
            broadcastToSession(sid, {
              type: "recordingError",
              error: "A recording is already in progress.",
            });
            return;
          }
          const name = (msg as { name?: string }).name?.trim() || null;
          const clientEpochMs = (msg as { clientEpochMs?: number }).clientEpochMs;
          const webrtcCfg = getWebRtcConfig();

          const ownerId = session?.podcastId
            ? getPodcastOwnerId(session.podcastId)
            : undefined;
          if (
            ownerId &&
            wouldExceedStorageLimit(db, ownerId, RECORD_MIN_FREE_BYTES)
          ) {
            broadcastToSession(sid, {
              type: "recordingError",
              error: "Storage limit reached. Free up space to record.",
            });
            return;
          }

          if (
            session?.roomId &&
            webrtcCfg.serviceUrl &&
            session.episodeId &&
            session.podcastId
          ) {
            const segId = nanoid();
            const filePathRelative = `recordings/${segId}.wav`;
            const startRecordingUrl = `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/start-recording`;
            const payload = {
              roomId: session.roomId,
              sessionId: sid,
              filePathRelative,
              segmentId: segId,
              episodeId: session.episodeId,
              podcastId: session.podcastId,
              name,
              clientEpochMs: typeof clientEpochMs === "number" ? clientEpochMs : undefined,
              recordingCallbackSecret: webrtcCfg.recordingCallbackSecret || undefined,
            };
            // Set optimistically so host-away path sees it before fetch resolves (race fix)
            session.recordingEvents = [];
            session.recordingInProgress = true;
            session.recordingStartedAtEpochMs = Date.now();
            fetch(startRecordingUrl, {
              method: "POST",
              headers: webrtcRequestHeaders(webrtcCfg),
              body: JSON.stringify(payload),
            })
              .then(async (res) => {
                if (res.ok) {
                  const data = (await res.json()) as { recordingEpochMs?: number };
                  const sessionForRecording = getSessionById(sid);
                  if (sessionForRecording) {
                    sessionForRecording.recordingStartedAtEpochMs =
                      typeof data?.recordingEpochMs === "number" ? data.recordingEpochMs : Date.now();
                    if (!sessionForRecording.recordingInProgress) {
                      return;
                    }
                  }
                  req.log.info({ sid }, "[call] broadcasting recordingStarted");
                  broadcastToSession(sid, {
                    type: "recordingStarted",
                    recordingEpochMs: typeof data?.recordingEpochMs === "number" ? data.recordingEpochMs : undefined,
                  });
                } else {
                  const text = await res.text();
                  let errorMsg = "Failed to start recording";
                  try {
                    const parsed = JSON.parse(text) as { error?: string };
                    if (parsed?.error) errorMsg = parsed.error;
                  } catch {
                    /* use default */
                  }
                  req.log.warn(
                    {
                      status: res.status,
                      statusText: res.statusText,
                      body: text,
                      url: startRecordingUrl,
                      payload: { ...payload, recordingCallbackSecret: "[redacted]" },
                    },
                    "WebRTC start-recording failed",
                  );
                  const sessionOnFail = getSessionById(sid);
                  if (sessionOnFail) {
                    sessionOnFail.recordingInProgress = false;
                    sessionOnFail.recordingStartedAtEpochMs = undefined;
                  }
                  broadcastToSession(sid, {
                    type: "recordingError",
                    error: errorMsg,
                  });
                }
              })
              .catch((err) => {
                req.log.warn({ err, url: startRecordingUrl }, "WebRTC start-recording fetch failed");
                const sessionOnFail = getSessionById(sid);
                if (sessionOnFail) {
                  sessionOnFail.recordingInProgress = false;
                  sessionOnFail.recordingStartedAtEpochMs = undefined;
                }
                broadcastToSession(sid, {
                  type: "recordingError",
                  error: "Failed to start recording",
                });
              });
          } else {
            broadcastToSession(sid, {
              type: "recordingError",
              error: "WebRTC not configured or call not ready for recording",
            });
          }
          return;
        }

        if (type === "recordingEvent" && isHost) {
          const sid = sessionId;
          const session = getSessionById(sid);
          if (session?.recordingEvents) {
            const ev = msg as { event?: string; assetId?: string; clientTimestampMs?: number; durationSec?: number };
            if (typeof ev.event === "string") {
              session.recordingEvents.push({
                event: ev.event,
                assetId: ev.assetId,
                clientTimestampMs: ev.clientTimestampMs,
                durationSec: ev.durationSec,
              });
            }
          }
          return;
        }

        if (type === "stopRecording" && isHost) {
          const sid = sessionId;
          if (sid) updateHostHeartbeat(sid);
          const session = getSessionById(sid);
          req.log.info({ sid, hasSession: !!session, roomId: session?.roomId }, "[call] stopRecording received");
          if (session) {
            session.recordingInProgress = false;
            session.recordingStartedAtEpochMs = undefined;
          }
          const webrtcCfg = getWebRtcConfig();
          if (session?.roomId && webrtcCfg.serviceUrl) {
            const events = session.recordingEvents ?? [];
            session.recordingEvents = undefined;
            const recordingEndedAtMs = Date.now();
            const roomId = session.roomId;
            const stopUrl = `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/stop-recording`;
            req.log.info({ stopUrl, roomId }, "[call] stopRecording POSTing to webrtc");
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const stopHeaders = webrtcRequestHeaders(webrtcCfg);
            console.log("[call] stop-recording request", { stopUrl, roomId, hasSecret: !!webrtcCfg.webrtcServiceSecret });
            fetch(stopUrl, {
              method: "POST",
              headers: stopHeaders,
              body: JSON.stringify({ roomId, events, recordingEndedAtMs }),
              signal: controller.signal,
            })
              .then((res) => {
                clearTimeout(timeout);
                const text = res.ok ? "" : ` status=${res.status}`;
                console.log("[call] stop-recording response", { ok: res.ok, status: res.status, sid });
                req.log.info({ status: res.status, sid }, `[call] stop-recording response${text}`);
                if (!res.ok) throw new Error(`stop-recording returned ${res.status}`);
                const sockets = sessionSockets.get(sid);
                req.log.info({ sid, socketCount: sockets?.size ?? 0 }, "[call] broadcasting recordingStopped");
                console.log("[call] broadcasting recordingStopped");
                broadcastToSession(sid, { type: "recordingStopped" });
              })
              .catch((err) => {
                clearTimeout(timeout);
                console.log("[call] stop-recording fetch failed", { err: String(err), roomId, sid });
                req.log.warn({ err, roomId, sid }, "[call] WebRTC stop-recording failed");
                broadcastToSession(sid, {
                  type: "recordingStopFailed",
                  error: "Failed to stop recording",
                });
              });
          } else {
            req.log.info({ sid, reason: !session?.roomId ? "no roomId" : "no serviceUrl" }, "[call] stopRecording else branch, broadcasting recordingStopped");
            broadcastToSession(sid, { type: "recordingStopped" });
          }
          return;
        }

        if (type === "setMute") {
          const sid = sessionId;
          const targetParticipantId = (msg as { participantId?: string }).participantId;
          const muted = (msg as { muted?: boolean }).muted === true;
          if (!targetParticipantId) {
            const pid = participantId ?? socketToParticipant.get(socket as unknown as WebSocket)?.participantId;
            if (pid) {
              const ok = setParticipantMutedBySelf(sid, pid, muted);
              const session = getSessionById(sid);
              broadcastToSession(sid, {
                type: "participants",
                participants: session ? [...session.participants] : [],
              });
              if (!muted && !ok) {
                const sockets = sessionSockets.get(sid);
                if (sockets) {
                  for (const s of sockets) {
                    if (socketToParticipant.get(s as unknown as WebSocket)?.participantId === pid) {
                      s.send(JSON.stringify({ type: "setMute", muted: true, mutedByHost: true }));
                      break;
                    }
                  }
                }
              }
            }
            return;
          }
          if (!isHost) return;
          if (!setParticipantMutedByHost(sid, targetParticipantId, muted)) return;
          const sockets = sessionSockets.get(sid);
          if (sockets) {
            for (const s of sockets) {
              const info = socketToParticipant.get(s as unknown as WebSocket);
              if (info?.participantId === targetParticipantId) {
                s.send(JSON.stringify({ type: "setMute", muted, mutedByHost: muted }));
                break;
              }
            }
          }
          broadcastToSession(sid, {
            type: "participants",
            participants: getSessionById(sid)?.participants ?? [],
          });
          return;
        }

        if (type === "disconnectParticipant" && isHost) {
          const sid = sessionId;
          const targetParticipantId = (msg as { participantId?: string }).participantId;
          if (!targetParticipantId || targetParticipantId === participantId) return;
          const sockets = sessionSockets.get(sid);
          let targetSocket: WebSocket | null = null;
          if (sockets) {
            for (const s of sockets) {
              const info = socketToParticipant.get(s as unknown as WebSocket);
              if (info?.participantId === targetParticipantId) {
                targetSocket = s as unknown as WebSocket;
                break;
              }
            }
          }
          if (targetSocket) {
            removeParticipant(sid, targetParticipantId);
            socketToParticipant.delete(targetSocket);
            sockets?.delete(targetSocket as unknown as WebSocket);
            targetSocket.send(JSON.stringify({ type: "disconnected" }));
            targetSocket.close();
            broadcastToSession(sid, {
              type: "participants",
              participants: getSessionById(sid)?.participants ?? [],
            });
          }
          return;
        }

        if (type === "endCall" && isHost) {
          (async () => {
            const session = getSessionById(sessionId);
            const webrtcCfg = getWebRtcConfig();
            if (session?.roomId && webrtcCfg?.serviceUrl) {
              try {
                await fetch(`${webrtcCfg.serviceUrl.replace(/\/$/, "")}/stop-recording`, {
                  method: "POST",
                  headers: webrtcRequestHeaders(webrtcCfg),
                  body: JSON.stringify({ roomId: session.roomId }),
                });
              } catch (err) {
                req.log.warn({ err, roomId: session.roomId }, "WebRTC stop-recording failed on end call");
              }
            }
            const endedSession = endSession(sessionId);
            if (endedSession) {
              broadcastToSession(sessionId, { type: "callEnded" });
              sessionSockets.delete(sessionId);
            }
            removeSocketFromSession(sessionId, socket);
          })();
          return;
        }
      });

      socket.on("close", () => {
        pendingMigrateHosts.delete(socket as unknown as WebSocket);
        hostSocketAddedAt.delete(socket as unknown as WebSocket);
        socketToParticipant.delete(socket as unknown as WebSocket);
        if (sessionId && participantId && !isHost) {
          removeParticipant(sessionId, participantId);
          const session = getSessionById(sessionId);
          if (session)
            broadcastToSession(sessionId, {
              type: "participants",
              participants: session.participants,
            });
        }
        if (sessionId && isHost) {
          const session = getSessionByIdRaw(sessionId);
          const hostP = session?.participants.find((p) => p.isHost);
          const hostParticipantId = hostP?.id;
          const sockets = sessionSockets.get(sessionId);
          const anotherHostSocket =
            sockets &&
            hostParticipantId &&
            Array.from(sockets).some(
              (s) =>
                s !== socket &&
                socketToParticipant.get(s)?.participantId === hostParticipantId,
            );
          if (!anotherHostSocket) {
            const result = setHostDisconnected(sessionId);
            if (result && session) {
              broadcastToSession(sessionId, {
                type: "hostDisconnected",
                gracePeriodMs: result.gracePeriodMs,
                endsAt: session.hostDisconnectedAt! + result.gracePeriodMs,
              });
              broadcastToSession(sessionId, {
                type: "participants",
                participants: session.participants,
              });
            }
          }
        }
        if (sessionId) removeSocketFromSession(sessionId, socket);
      });
    },
  );
}
