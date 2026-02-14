import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import { db } from "../../db/index.js";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import type { JWTPayload } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import { nanoid } from "nanoid";
import {
  createSession,
  getSessionByToken,
  getSessionById,
  getSessionForJoinInfo,
  updateHostHeartbeat,
  addParticipant,
  removeParticipant,
  endSession,
  verifyPassword,
  getActiveSessionForEpisode,
  setSessionRoomId,
  setParticipantMuted,
  type CallSession,
  type CallParticipant,
} from "../../services/callSession.js";
import { getWebRtcConfig } from "../../services/webrtcConfig.js";
import { join } from "path";
import { pathRelativeToData, segmentPath } from "../../services/paths.js";
import { createSegmentFromPath } from "../../services/segmentFromRecording.js";

const sessionSockets = new Map<string, Set<WebSocket>>(); // sessionId -> Set<WebSocket>
const socketToParticipant = new Map<
  WebSocket,
  { sessionId: string; participantId: string }
>();

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
        const origin =
          (request.headers["origin"] as string) ||
          (request.headers["referer"] as string)?.replace(/\/[^/]*$/, "") ||
          "";
        const joinUrl = origin ? `${origin}/call/join/${existing.token}` : "";
        const payload: Record<string, unknown> = {
          token: existing.token,
          sessionId: existing.sessionId,
          joinUrl: joinUrl || `/call/join/${existing.token}`,
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
            },
          },
          404: { description: "Invalid or ended session" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      const session = getSessionForJoinInfo(token);
      if (!session)
        return reply.status(404).send({ error: "Invalid or expired link" });

      const podcast = db
        .prepare("SELECT title FROM podcasts WHERE id = ?")
        .get(session.podcastId) as { title: string } | undefined;
      const episode = db
        .prepare("SELECT id, title FROM episodes WHERE id = ?")
        .get(session.episodeId) as { id: string; title: string } | undefined;
      if (!podcast || !episode)
        return reply.status(404).send({ error: "Show or episode not found" });

      return reply.send({
        podcast: { title: podcast.title },
        episode: { id: episode.id, title: episode.title },
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
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { episodeId } = request.query as { episodeId: string };
      const session = getActiveSessionForEpisode(episodeId, request.userId);
      if (!session) return reply.send(null);
      const origin =
        (request.headers["origin"] as string) ||
        (request.headers["referer"] as string)?.replace(/\/[^/]*$/, "") ||
        "";
      const joinUrl = origin ? `${origin}/call/join/${session.token}` : "";
      const payload: Record<string, unknown> = {
        sessionId: session.sessionId,
        token: session.token,
        joinUrl: joinUrl || `/call/join/${session.token}`,
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
            filePath: { type: "string", description: "Path relative to DATA_DIR" },
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
        const { getDataDir } = await import("../../services/paths.js");
        const resolvedPath = join(getDataDir(), body.filePath);
        const row = await createSegmentFromPath(
          resolvedPath,
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
                initialized = true;
                let set = sessionSockets.get(sessionId);
                if (!set) {
                  set = new Set();
                  sessionSockets.set(sessionId, set);
                }
                set.add(socket);
                if (participantId)
                  socketToParticipant.set(socket as unknown as WebSocket, {
                    sessionId,
                    participantId,
                  });
                const hostJoinedPayload: Record<string, unknown> = {
                    type: "joined",
                    sessionId,
                    participantId,
                    isHost: true,
                    participants: session.participants,
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
            const session = getSessionByToken(guestToken);
            if (!session) {
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

        if (type === "startRecording" && isHost) {
          const sid = sessionId;
          const session = getSessionById(sid);
          const name = (msg as { name?: string }).name?.trim() || null;
          const webrtcCfg = getWebRtcConfig();
          if (
            session?.roomId &&
            webrtcCfg.serviceUrl &&
            session.episodeId &&
            session.podcastId
          ) {
            const segId = nanoid();
            const filePath = segmentPath(
              session.podcastId,
              session.episodeId,
              segId,
              "wav",
            );
            const filePathRelative = pathRelativeToData(filePath);
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
                    error: "Failed to start recording",
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

        if (type === "setMute" && isHost) {
          const sid = sessionId;
          const targetParticipantId = (msg as { participantId?: string }).participantId;
          const muted = (msg as { muted?: boolean }).muted === true;
          if (!targetParticipantId) return;
          if (!setParticipantMuted(sid, targetParticipantId, muted)) return;
          const sockets = sessionSockets.get(sid);
          if (sockets) {
            for (const s of sockets) {
              const info = socketToParticipant.get(s as unknown as WebSocket);
              if (info?.participantId === targetParticipantId) {
                s.send(JSON.stringify({ type: "setMute", muted }));
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
          const session = endSession(sessionId);
          if (session) {
            broadcastToSession(sessionId, { type: "callEnded" });
            sessionSockets.delete(sessionId);
          }
          removeSocketFromSession(sessionId, socket);
          return;
        }
      });

      socket.on("close", () => {
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
