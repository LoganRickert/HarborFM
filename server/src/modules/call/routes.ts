import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import { db } from "../../db/index.js";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import type { JWTPayload } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments, getPodcastOwnerId } from "../../services/access.js";
import { nanoid } from "nanoid";
import {
  createSession,
  getSessionByToken,
  getSessionById,
  getSessionByCode,
  getSessionForJoinInfo,
  ensureSessionJoinCode,
  updateHostHeartbeat,
  addParticipant,
  removeParticipant,
  endSession,
  verifyPassword,
  getActiveSessionForEpisode,
  setSessionRoomId,
  setParticipantMutedBySelf,
  setParticipantMutedByHost,
  setParticipantName,
  type CallSession,
  type CallParticipant,
} from "../../services/callSession.js";
import { getWebRtcConfig } from "../../services/webrtcConfig.js";
import { join, resolve } from "path";
import { copyFileSync, unlinkSync, existsSync } from "fs";
import { segmentPath, getWebrtcRecordingsDir } from "../../services/paths.js";
import { assertResolvedPathUnder } from "../../services/paths.js";
import { createSegmentFromPath } from "../../services/segmentFromRecording.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { RECORD_MIN_FREE_BYTES } from "../../config.js";
import {
  getClientIp,
  getIpBan,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";

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
      if (existing) {
        ensureSessionJoinCode(existing);
        const origin =
          (request.headers["origin"] as string) ||
          (request.headers["referer"] as string)?.replace(/\/[^/]*$/, "") ||
          "";
        const joinUrl = origin ? `${origin}/call/join/${existing.token}` : "";
        const payload: Record<string, unknown> = {
          token: existing.token,
          sessionId: existing.sessionId,
          joinUrl: joinUrl || `/call/join/${existing.token}`,
          joinCode: existing.joinCode,
        };
        const webrtcCfg = getWebRtcConfig();
        if (existing.roomId && webrtcCfg.publicWsUrl) {
          payload.webrtcUrl =
            webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
          payload.roomId = existing.roomId;
        }
        return reply.send(payload);
      }

      const episodeRow = db
        .prepare("SELECT podcast_id FROM episodes WHERE id = ?")
        .get(episodeId) as { podcast_id: string } | undefined;
      if (!episodeRow)
        return reply.status(404).send({ error: "Episode not found" });
      const podcastId = episodeRow.podcast_id;

      const origin =
        (request.headers["origin"] as string) ||
        (request.headers["referer"] as string)?.replace(/\/[^/]*$/, "") ||
        "";
      const session = createSession(
        episodeId,
        podcastId,
        request.userId,
        origin,
        body.password ?? null,
        (endedSession) => {
          broadcastToSession(endedSession.sessionId, { type: "callEnded" });
          sessionSockets.delete(endedSession.sessionId);
        },
      );
      let webrtcUrl: string | null = null;
      let roomId: string | null = null;
      let webrtcUnavailable = false;
      const webrtcCfg = getWebRtcConfig();
      if (webrtcCfg.serviceUrl && webrtcCfg.publicWsUrl) {
        try {
          const roomRes = await fetch(`${webrtcCfg.serviceUrl.replace(/\/$/, "")}/room`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomId: session.sessionId }),
          });
          if (roomRes.ok) {
            const roomData = (await roomRes.json()) as { roomId: string };
            roomId = roomData.roomId;
            setSessionRoomId(session.sessionId, roomId);
            webrtcUrl = webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
          } else {
            webrtcUnavailable = true;
          }
        } catch {
          webrtcUnavailable = true;
        }
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
      }
      if (webrtcUnavailable) payload.webrtcUnavailable = true;
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
            description: "Token for joining",
            type: "object",
            properties: { token: { type: "string" } },
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
        recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
          userAgent: request.headers["user-agent"],
        });
        return reply.status(404).send({ error: "No call found for this code" });
      }
      return reply.send({ token: session.token });
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
      const origin =
        (request.headers["origin"] as string) ||
        (request.headers["referer"] as string)?.replace(/\/[^/]*$/, "") ||
        "";
      const joinUrl = origin ? `${origin}/call/join/${session.token}` : "";
      const payload: Record<string, unknown> = {
        sessionId: session.sessionId,
        token: session.token,
        joinUrl: joinUrl || `/call/join/${session.token}`,
        joinCode: session.joinCode,
      };
      const webrtcCfg = getWebRtcConfig();
      if (session.roomId && webrtcCfg.publicWsUrl) {
        payload.webrtcUrl =
          webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
        payload.roomId = session.roomId;
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
      };
      try {
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
        try {
          unlinkSync(sourcePath);
        } catch (unlinkErr) {
          request.log.warn(
            { err: unlinkErr, sourcePath },
            "Could not remove source recording file (permission denied); segment created successfully",
          );
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

      const sendParticipants = (session: CallSession) => {
        broadcastToSession(session.sessionId, {
          type: "participants",
          participants: session.participants,
        });
      };

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
                const hostJoinedPayload: Record<string, unknown> = {
                    type: "joined",
                    sessionId,
                    participantId,
                    isHost: true,
                    participants: [...session.participants],
                  };
                  const webrtcCfg = getWebRtcConfig();
                  if (session.roomId && webrtcCfg.publicWsUrl) {
                    hostJoinedPayload.webrtcUrl =
                      webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
                    hostJoinedPayload.roomId = session.roomId;
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
            const hostJoinedPayload: Record<string, unknown> = {
              type: "joined",
              sessionId: sid,
              participantId: pid,
              isHost: true,
              participants: [...sess.participants],
            };
            const webrtcCfg = getWebRtcConfig();
            if (sess.roomId && webrtcCfg.publicWsUrl) {
              hostJoinedPayload.webrtcUrl =
                webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
              hostJoinedPayload.roomId = sess.roomId;
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
            };
            const webrtcCfg = getWebRtcConfig();
            if (session.roomId && webrtcCfg.publicWsUrl) {
              webrtcJoinedPayload.webrtcUrl =
                webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
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
            socket.send(JSON.stringify({ type: "heartbeatAck" }));
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
          const session = getSessionById(sid);
          const name = (msg as { name?: string }).name?.trim() || null;
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
              recordingCallbackSecret: webrtcCfg.recordingCallbackSecret || undefined,
            };
            fetch(startRecordingUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
              .then(async (res) => {
                if (res.ok) {
                  broadcastToSession(sid, { type: "recordingStarted" });
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
                  broadcastToSession(sid, {
                    type: "recordingError",
                    error: errorMsg,
                  });
                }
              })
              .catch((err) => {
                req.log.warn({ err, url: startRecordingUrl }, "WebRTC start-recording fetch failed");
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

        if (type === "stopRecording" && isHost) {
          const sid = sessionId;
          const session = getSessionById(sid);
          const webrtcCfg = getWebRtcConfig();
          if (session?.roomId && webrtcCfg.serviceUrl) {
            fetch(`${webrtcCfg.serviceUrl}/stop-recording`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ roomId: session.roomId }),
            })
              .then(() => {
                broadcastToSession(sid, { type: "recordingStopped" });
              })
              .catch((err) => {
                req.log.warn({ err, roomId: session.roomId }, "WebRTC stop-recording failed");
                broadcastToSession(sid, {
                  type: "recordingStopFailed",
                  error: "Failed to stop recording",
                });
              });
          } else {
            broadcastToSession(sid, { type: "recordingStopped" });
          }
          return;
        }

        if (type === "setMute") {
          const sid = sessionId;
          const targetParticipantId = (msg as { participantId?: string }).participantId;
          const muted = (msg as { muted?: boolean }).muted === true;
          if (!targetParticipantId) {
            if (participantId) {
              const ok = setParticipantMutedBySelf(sid, participantId, muted);
              broadcastToSession(sid, {
                type: "participants",
                participants: getSessionById(sid)?.participants ?? [],
              });
              if (!muted && !ok) {
                const sockets = sessionSockets.get(sid);
                if (sockets) {
                  for (const s of sockets) {
                    if (socketToParticipant.get(s as unknown as WebSocket)?.participantId === participantId) {
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
                  headers: { "Content-Type": "application/json" },
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
        if (sessionId) removeSocketFromSession(sessionId, socket);
      });
    },
  );
}
