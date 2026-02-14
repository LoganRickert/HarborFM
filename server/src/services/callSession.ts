import { nanoid } from "nanoid";

export interface CallParticipant {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  muted?: boolean;
}

export interface CallSession {
  sessionId: string;
  episodeId: string;
  podcastId: string;
  hostUserId: string;
  token: string;
  password: string | null;
  participants: CallParticipant[];
  createdAt: number;
  lastHostHeartbeatAt: number;
  ended: boolean;
  /** Set when WEBRTC_SERVICE_URL is configured and a mediasoup room was created. */
  roomId?: string;
}

const HOST_AWAY_MS = 5 * 60 * 1000; // 5 minutes

const sessionsByToken = new Map<string, CallSession>();
const sessionsById = new Map<string, CallSession>();
let hostAwayCheckInterval: ReturnType<typeof setInterval> | null = null;

function ensureHostAwayChecker(
  onSessionEnd: (session: CallSession) => void,
): void {
  if (hostAwayCheckInterval != null) return;
  hostAwayCheckInterval = setInterval(() => {
    const now = Date.now();
    for (const session of sessionsById.values()) {
      if (session.ended) continue;
      if (now - session.lastHostHeartbeatAt >= HOST_AWAY_MS) {
        session.ended = true;
        onSessionEnd(session);
      }
    }
  }, 30_000); // check every 30s
}

export function createSession(
  episodeId: string,
  podcastId: string,
  hostUserId: string,
  origin: string,
  password: string | null,
  onSessionEnd: (session: CallSession) => void,
): CallSession {
  const sessionId = nanoid();
  const token = nanoid(16);
  const now = Date.now();
  const hostParticipant: CallParticipant = {
    id: nanoid(),
    name: "Host",
    isHost: true,
    joinedAt: now,
  };
  const session: CallSession = {
    sessionId,
    episodeId,
    podcastId,
    hostUserId,
    token,
    password: password?.trim() || null,
    participants: [hostParticipant],
    createdAt: now,
    lastHostHeartbeatAt: now,
    ended: false,
  };
  sessionsByToken.set(token, session);
  sessionsById.set(sessionId, session);
  ensureHostAwayChecker(onSessionEnd);
  return session;
}

export function getSessionByToken(token: string): CallSession | undefined {
  const s = sessionsByToken.get(token);
  return s && !s.ended ? s : undefined;
}

export function getSessionById(sessionId: string): CallSession | undefined {
  const s = sessionsById.get(sessionId);
  return s && !s.ended ? s : undefined;
}

export function getSessionForJoinInfo(token: string): CallSession | undefined {
  const s = sessionsByToken.get(token);
  return s && !s.ended ? s : undefined;
}

export function updateHostHeartbeat(sessionId: string): boolean {
  const session = sessionsById.get(sessionId);
  if (!session || session.ended) return false;
  session.lastHostHeartbeatAt = Date.now();
  return true;
}

export function addParticipant(
  sessionId: string,
  participantId: string,
  name: string,
): CallParticipant | null {
  const session = sessionsById.get(sessionId);
  if (!session || session.ended) return null;
  const p: CallParticipant = {
    id: participantId,
    name: name || "Guest",
    isHost: false,
    joinedAt: Date.now(),
  };
  session.participants.push(p);
  return p;
}

export function removeParticipant(
  sessionId: string,
  participantId: string,
): void {
  const session = sessionsById.get(sessionId);
  if (!session) return;
  session.participants = session.participants.filter((p) => p.id !== participantId);
}

export function setParticipantMuted(
  sessionId: string,
  participantId: string,
  muted: boolean,
): boolean {
  const session = sessionsById.get(sessionId);
  if (!session) return false;
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  p.muted = muted;
  return true;
}

export function endSession(sessionId: string): CallSession | null {
  const session = sessionsById.get(sessionId);
  if (!session) return null;
  session.ended = true;
  sessionsByToken.delete(session.token);
  sessionsById.delete(sessionId);
  return session;
}

export function verifyPassword(session: CallSession, password: string): boolean {
  if (session.password == null || session.password === "") return true;
  return session.password === (password?.trim() ?? "");
}

export function setSessionRoomId(sessionId: string, roomId: string): void {
  const session = sessionsById.get(sessionId);
  if (session) session.roomId = roomId;
}

export function getActiveSessionForEpisode(
  episodeId: string,
  hostUserId: string,
): CallSession | undefined {
  for (const session of sessionsById.values()) {
    if (
      !session.ended &&
      session.episodeId === episodeId &&
      session.hostUserId === hostUserId
    ) {
      return session;
    }
  }
  return undefined;
}
