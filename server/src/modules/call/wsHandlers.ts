import type { FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { nanoid } from "nanoid";
import { db } from "../../db/index.js";
import type { CallSession } from "../../services/callSession.js";
import {
  getSessionByToken,
  getSessionById,
  getSessionByIdRaw,
  updateHostHeartbeat,
  addParticipant,
  verifyPassword,
  setParticipantName,
  clearHostDisconnected,
} from "../../services/callSession.js";
import { getWebRtcConfig, webrtcRequestHeaders } from "../../services/webrtcConfig.js";
import { getPodcastOwnerId } from "../../services/access.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { RECORD_MIN_FREE_BYTES } from "../../config.js";
import {
  getClientIp,
  getIpBan,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import {
  getPublicWsUrl,
  broadcastToSession,
  CALL_JOIN_CONTEXT,
  sessionSockets,
  socketToParticipant,
  pendingMigrateHosts,
  hostSocketAddedAt,
} from "./shared.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import type { JWTPayload } from "../../plugins/auth.js";

export interface WsState {
  sessionId: string | null;
  participantId: string | null;
  isHost: boolean;
  initialized: boolean;
}

/** Build the joined payload sent to host after connect or migrateHost. */
function buildHostJoinedPayload(
  session: CallSession,
  sessionId: string,
  participantId: string | null,
  origin?: string,
  referer?: string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: "joined",
    sessionId,
    participantId,
    isHost: true,
    participants: [...session.participants],
    recordingInProgress: session.recordingInProgress === true,
    recordingStartedAtEpochMs: session.recordingStartedAtEpochMs,
    pendingSegmentIds: session.pendingSegmentIds ?? [],
  };
  const publicWs = getPublicWsUrl(origin, referer);
  if (session.roomId && publicWs) {
    payload.webrtcUrl = publicWs;
    payload.roomId = session.roomId;
    if (session.hostToken) payload.hostToken = session.hostToken;
  }
  return payload;
}

export function handleHostJoin(
  socket: WebSocket,
  req: FastifyRequest,
  msg: { sessionId?: string; name?: string },
  state: WsState
): boolean {
  const sessionIdParam = msg.sessionId;
  const hostName = msg.name;
  if (!sessionIdParam) return false;

  req.jwtVerify()
    .then(() => {
      const userId = (req.user as JWTPayload).sub;
      const session = getSessionById(sessionIdParam);
      if (!session || session.ended || session.hostUserId !== userId) {
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
        socket.send(JSON.stringify({ type: "error", error: "Invalid session" }));
        socket.close();
        return;
      }
      state.sessionId = session.sessionId;
      const hostP = session.participants.find((p) => p.isHost);
      state.participantId = hostP?.id ?? null;
      state.isHost = true;

      const OPEN = 1;
      const REMOUNT_GRACE_MS = 500;
      const existingSockets = sessionSockets.get(state.sessionId);
      let existingHostSocket: WebSocket | null = null;
      if (existingSockets) {
        for (const s of existingSockets) {
          if (s === socket) continue;
          if ((s as WebSocket & { readyState?: number }).readyState !== OPEN) continue;
          const ent = socketToParticipant.get(s);
          if (ent?.participantId !== state.participantId) continue;
          const addedAt = hostSocketAddedAt.get(s);
          if (addedAt != null && Date.now() - addedAt < REMOUNT_GRACE_MS) {
            try {
              s.close();
            } catch {
              /* ignore */
            }
            sessionSockets.get(state.sessionId)?.delete(s);
            socketToParticipant.delete(s);
            hostSocketAddedAt.delete(s);
            break;
          }
          existingHostSocket = s;
          break;
        }
      }

      if (existingHostSocket) {
        socket.send(JSON.stringify({ type: "alreadyInCall", canMigrate: true }));
        pendingMigrateHosts.set(socket as unknown as WebSocket, {
          sessionId: state.sessionId,
          participantId: state.participantId!,
          hostName:
            hostName != null && String(hostName).trim()
              ? String(hostName).trim()
              : undefined,
        });
        return;
      }

      state.initialized = true;
      if (state.participantId && hostName != null && String(hostName).trim()) {
        setParticipantName(state.sessionId, state.participantId, String(hostName).trim());
      }
      let set = sessionSockets.get(state.sessionId);
      if (!set) {
        set = new Set();
        sessionSockets.set(state.sessionId, set);
      }
      set.add(socket);
      if (state.participantId) {
        socketToParticipant.set(socket as unknown as WebSocket, {
          sessionId: state.sessionId,
          participantId: state.participantId,
        });
        hostSocketAddedAt.set(socket as unknown as WebSocket, Date.now());
      }
      updateHostHeartbeat(state.sessionId);
      clearHostDisconnected(state.sessionId);
      broadcastToSession(state.sessionId, {
        type: "participants",
        participants: [...session.participants],
      });
      const hostJoinedPayload = buildHostJoinedPayload(
        session,
        state.sessionId,
        state.participantId,
        req.headers.origin as string | undefined,
        req.headers.referer as string | undefined
      );
      socket.send(JSON.stringify(hostJoinedPayload));
    })
    .catch(() => {
      socket.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
      socket.close();
    });
  return true;
}

export function handleMigrateHost(
  socket: WebSocket,
  req: FastifyRequest,
  state: WsState
): boolean {
  const pending = pendingMigrateHosts.get(socket as unknown as WebSocket);
  if (!pending) return false;

  const { sessionId: sid, participantId: pid, hostName: hn } = pending;
  const sess = getSessionById(sid);
  if (!sess || sess.ended) {
    pendingMigrateHosts.delete(socket as unknown as WebSocket);
    socket.send(JSON.stringify({ type: "error", error: "Session ended" }));
    socket.close();
    return true;
  }

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

  state.sessionId = sid;
  state.participantId = pid;
  state.isHost = true;
  state.initialized = true;
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
  const hostJoinedPayload = buildHostJoinedPayload(
    sess,
    sid,
    pid,
    req.headers.origin as string | undefined,
    req.headers.referer as string | undefined
  );
  socket.send(JSON.stringify(hostJoinedPayload));
  return true;
}

export function handleGuestJoin(
  socket: WebSocket,
  req: FastifyRequest,
  msg: { token?: string; name?: string; password?: string },
  state: WsState
): boolean {
  const guestToken = msg.token;
  const name = msg.name;
  const password = msg.password;
  if (!guestToken) {
    socket.send(JSON.stringify({ type: "error", error: "Token required" }));
    socket.close();
    return true;
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
    return true;
  }
  const session = getSessionByToken(guestToken);
  if (!session) {
    recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
      userAgent: req.headers["user-agent"],
    });
    socket.send(JSON.stringify({ type: "error", error: "Invalid or expired link" }));
    socket.close();
    return true;
  }
  if (!verifyPassword(session, password ?? "")) {
    recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
      userAgent: req.headers["user-agent"],
    });
    socket.send(JSON.stringify({ type: "error", error: "Wrong password" }));
    socket.close();
    return true;
  }
  const pid = nanoid();
  const p = addParticipant(session.sessionId, pid, name ?? "Guest");
  if (!p) {
    socket.send(JSON.stringify({ type: "error", error: "Could not join" }));
    socket.close();
    return true;
  }
  state.sessionId = session.sessionId;
  state.participantId = p.id;
  state.initialized = true;
  let set = sessionSockets.get(state.sessionId);
  if (!set) {
    set = new Set();
    sessionSockets.set(state.sessionId, set);
  }
  set.add(socket);
  socketToParticipant.set(socket as unknown as WebSocket, {
    sessionId: state.sessionId,
    participantId: state.participantId,
  });
  const webrtcJoinedPayload: Record<string, unknown> = {
    type: "joined",
    sessionId: state.sessionId,
    participantId: state.participantId,
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
    sessionId: state.sessionId,
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
    return true;
  }
  if (hasRoom) {
    webrtcJoinedPayload.webrtcUrl =
      webrtcCfg.publicWsUrl!.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
    webrtcJoinedPayload.roomId = session.roomId;
  }
  socket.send(JSON.stringify(webrtcJoinedPayload));
  broadcastToSession(state.sessionId, {
    type: "participantJoined",
    participant: p,
  });
  return true;
}

export function handleStartRecording(
  req: FastifyRequest,
  sessionId: string,
  msg: { name?: string; clientEpochMs?: number }
): void {
  updateHostHeartbeat(sessionId);
  const session = getSessionById(sessionId);
  if (session?.recordingInProgress) {
    broadcastToSession(sessionId, {
      type: "recordingError",
      error: "A recording is already in progress.",
    });
    return;
  }
  const name = msg.name?.trim() || null;
  const clientEpochMs = msg.clientEpochMs;
  const webrtcCfg = getWebRtcConfig();
  const ownerId = session?.podcastId ? getPodcastOwnerId(session.podcastId) : undefined;
  if (ownerId && wouldExceedStorageLimit(db, ownerId, RECORD_MIN_FREE_BYTES)) {
    broadcastToSession(sessionId, {
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
      sessionId,
      filePathRelative,
      segmentId: segId,
      episodeId: session.episodeId,
      podcastId: session.podcastId,
      name,
      clientEpochMs: typeof clientEpochMs === "number" ? clientEpochMs : undefined,
      recordingCallbackSecret: webrtcCfg.recordingCallbackSecret || undefined,
    };
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
          const sessionForRecording = getSessionById(sessionId);
          if (sessionForRecording) {
            sessionForRecording.recordingStartedAtEpochMs =
              typeof data?.recordingEpochMs === "number" ? data.recordingEpochMs : Date.now();
            if (!sessionForRecording.recordingInProgress) return;
          }
          req.log.info({ sid: sessionId }, "[call] broadcasting recordingStarted");
          const sessForSegId = getSessionById(sessionId);
          if (sessForSegId) {
            sessForSegId.currentRecordingSegmentId = segId;
          }
          broadcastToSession(sessionId, {
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
          const sessionOnFail = getSessionById(sessionId);
          if (sessionOnFail) {
            sessionOnFail.recordingInProgress = false;
            sessionOnFail.recordingStartedAtEpochMs = undefined;
          }
          broadcastToSession(sessionId, {
            type: "recordingError",
            error: errorMsg,
          });
        }
      })
      .catch((err) => {
        req.log.warn({ err, url: startRecordingUrl }, "WebRTC start-recording fetch failed");
        const sessionOnFail = getSessionById(sessionId);
        if (sessionOnFail) {
          sessionOnFail.recordingInProgress = false;
          sessionOnFail.recordingStartedAtEpochMs = undefined;
        }
        broadcastToSession(sessionId, {
          type: "recordingError",
          error: "Failed to start recording",
        });
      });
  } else {
    broadcastToSession(sessionId, {
      type: "recordingError",
      error: "WebRTC not configured or call not ready for recording",
    });
  }
}

export function handleStopRecording(req: FastifyRequest, sessionId: string): void {
  updateHostHeartbeat(sessionId);
  const session = getSessionById(sessionId);
  req.log.info({ sid: sessionId, hasSession: !!session, roomId: session?.roomId }, "[call] stopRecording received");
  if (session) {
    session.recordingInProgress = false;
    session.recordingStartedAtEpochMs = undefined;
    if (session.currentRecordingSegmentId) {
      session.pendingSegmentIds = [...(session.pendingSegmentIds ?? []), session.currentRecordingSegmentId];
      session.currentRecordingSegmentId = undefined;
    }
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
        console.log("[call] stop-recording response", { ok: res.ok, status: res.status, sid: sessionId });
        req.log.info({ status: res.status, sid: sessionId }, `[call] stop-recording response${text}`);
        if (!res.ok) throw new Error(`stop-recording returned ${res.status}`);
        req.log.info({ sid: sessionId }, "[call] broadcasting recordingStopped");
        console.log("[call] broadcasting recordingStopped");
        const sessAfterStop = getSessionById(sessionId);
        broadcastToSession(sessionId, {
          type: "recordingStopped",
          pendingSegmentIds: sessAfterStop?.pendingSegmentIds ?? [],
        });
        if (session?.episodeId) {
          broadcastToEpisode(session.episodeId, { type: "callSessionUpdated" });
        }
      })
      .catch((err) => {
        clearTimeout(timeout);
        console.log("[call] stop-recording fetch failed", { err: String(err), roomId, sid: sessionId });
        req.log.warn({ err, roomId, sid: sessionId }, "[call] WebRTC stop-recording failed");
        broadcastToSession(sessionId, {
          type: "recordingStopFailed",
          error: "Failed to stop recording",
        });
      });
  } else {
    req.log.info(
      { sid: sessionId, reason: !session?.roomId ? "no roomId" : "no serviceUrl" },
      "[call] stopRecording else branch, broadcasting recordingStopped",
    );
    const sessElse = getSessionById(sessionId);
    broadcastToSession(sessionId, {
      type: "recordingStopped",
      pendingSegmentIds: sessElse?.pendingSegmentIds ?? [],
    });
    if (session?.episodeId) {
      broadcastToEpisode(session.episodeId, { type: "callSessionUpdated" });
    }
  }
}
