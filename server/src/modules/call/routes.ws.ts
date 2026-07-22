import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { CallParticipant } from "../../services/callSession.js";
import {
  getSessionById,
  getSessionByIdRaw,
  updateHostHeartbeat,
  removeParticipant,
  endSession,
  setParticipantMutedBySelf,
  setParticipantMutedByHost,
  setParticipantName,
  setHostDisconnected,
} from "../../services/callSession.js";
import { getWebRtcConfig, webrtcRequestHeaders } from "../../services/webrtcConfig.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { hangUpFakeDialInsForRoom, setPhoneDialInMuted, kickPhoneDialIn } from "./routes.dialIn.js";
import {
  broadcastToSession,
  removeSocketFromSession,
  sessionSockets,
  socketToParticipant,
  pendingMigrateHosts,
  hostSocketAddedAt,
} from "./shared.js";
import {
  type WsState,
  handleHostJoin,
  handleMigrateHost,
  handleGuestJoin,
  handleStartRecording,
  handleStopRecording,
} from "./wsHandlers.js";

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/call/ws",
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      const state: WsState = {
        sessionId: null,
        participantId: null,
        isHost: false,
        initialized: false,
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

        if (!state.initialized) {
          if (type === "host") {
            if (handleHostJoin(socket, req, msg as { sessionId?: string; name?: string }, state)) return;
          } else if (type === "migrateHost") {
            if (handleMigrateHost(socket, req, state)) return;
          } else if (type === "guest") {
            if (handleGuestJoin(socket, req, msg as { token?: string; name?: string; password?: string }, state)) return;
          }
          return;
        }

        const sessionId = state.sessionId;
        const participantId = state.participantId;
        const isHost = state.isHost;

        if (!sessionId) return;

        if (type === "heartbeat") {
          if (isHost) {
            if (updateHostHeartbeat(sessionId)) {
              const session = getSessionById(sessionId);
              const payload: { type: string; participants?: CallParticipant[] } = {
                type: "heartbeatAck",
              };
              if (session) {
                payload.participants = [...session.participants];
              }
              socket.send(JSON.stringify(payload));
            }
          } else if (participantId) {
            // Keep guest signaling WS alive through proxies (Caddy/nginx idle ~10 min).
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

        if (type === "startRecording" && isHost && sessionId) {
          handleStartRecording(req, sessionId, msg as { name?: string; clientEpochMs?: number });
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

        if (type === "stopRecording" && isHost && sessionId) {
          handleStopRecording(req, sessionId);
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
          const sessionAfterMute = getSessionById(sid);
          const target = sessionAfterMute?.participants.find((p) => p.id === targetParticipantId);
          if (target?.source === "phone") {
            void setPhoneDialInMuted(targetParticipantId, muted);
          } else {
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
          const sessionForKick = getSessionById(sid);
          const kickTarget = sessionForKick?.participants.find((p) => p.id === targetParticipantId);
          if (!kickTarget) return;

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

          // Phone dial-in (or any guest with no call WS): tear down media + roster.
          if (kickTarget.source === "phone" || !targetSocket) {
            void kickPhoneDialIn(sid, targetParticipantId).then((ok) => {
              if (!ok) {
                req.log.warn(
                  { participantId: targetParticipantId, source: kickTarget.source },
                  "Dial-in/orphan kick failed",
                );
              }
            });
            return;
          }

          removeParticipant(sid, targetParticipantId);
          socketToParticipant.delete(targetSocket);
          sockets?.delete(targetSocket as unknown as WebSocket);
          targetSocket.send(JSON.stringify({ type: "disconnected" }));
          targetSocket.close();
          broadcastToSession(sid, {
            type: "participants",
            participants: getSessionById(sid)?.participants ?? [],
          });
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
              broadcastToEpisode(endedSession.episodeId, { type: "callEnded" });
              sessionSockets.delete(sessionId);
              void hangUpFakeDialInsForRoom(endedSession.roomId);
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
        if (state.sessionId && state.participantId && !state.isHost) {
          removeParticipant(state.sessionId, state.participantId);
          const session = getSessionById(state.sessionId);
          if (session)
            broadcastToSession(state.sessionId, {
              type: "participants",
              participants: session.participants,
            });
        }
        if (state.sessionId && state.isHost) {
          const session = getSessionByIdRaw(state.sessionId);
          const hostP = session?.participants.find((p) => p.isHost);
          const hostParticipantId = hostP?.id;
          const sockets = sessionSockets.get(state.sessionId);
          const anotherHostSocket =
            sockets &&
            hostParticipantId &&
            Array.from(sockets).some(
              (s) =>
                s !== socket &&
                socketToParticipant.get(s)?.participantId === hostParticipantId,
            );
          if (!anotherHostSocket) {
            const result = setHostDisconnected(state.sessionId);
            if (result && session) {
              broadcastToSession(state.sessionId, {
                type: "hostDisconnected",
                gracePeriodMs: result.gracePeriodMs,
                endsAt: session.hostDisconnectedAt! + result.gracePeriodMs,
              });
              broadcastToSession(state.sessionId, {
                type: "participants",
                participants: session.participants,
              });
            }
          }
        }
        if (state.sessionId) removeSocketFromSession(state.sessionId, socket);
      });
    },
  );
}
