import { nanoid } from "nanoid";
import {
  HOST_AWAY_CHECK_INTERVAL_MS,
  HOST_AWAY_GRACE_NO_GUESTS_MS,
  HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS,
  HOST_AWAY_GRACE_WITH_GUESTS_MS,
} from "../config.js";
import { listReservedJoinCodes, markMeetingEndedBySessionId } from "../modules/call/meetings.js";

export interface CallParticipant {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  muted?: boolean;
  /** When true, host muted this guest; host can unmute, guest cannot. When false, guest muted self; guest can unmute, host cannot. */
  mutedByHost?: boolean;
  /** True when host's socket disconnected (e.g. tab closed). Call continues for grace period. */
  disconnected?: boolean;
  /** How the participant joined. Phone dial-in (incl. FakeDialIn) uses "phone". */
  source?: "phone";
}

export interface RecordingEvent {
  event: string;
  assetId?: string;
  clientTimestampMs?: number;
  durationSec?: number;
}

export interface CallSession {
  sessionId: string;
  episodeId: string;
  podcastId: string;
  hostUserId: string;
  token: string;
  /** 4-digit code (1000–9999) for quick join from Dashboard. */
  joinCode: string;
  password: string | null;
  participants: CallParticipant[];
  createdAt: number;
  lastHostHeartbeatAt: number;
  ended: boolean;
  /** Scheduled meeting id when this session was started via Start Meeting. */
  meetingId?: string;
  /** Set when WEBRTC_SERVICE_URL is configured and a mediasoup room was created. */
  roomId?: string;
  /** Host token for host-only WebRTC actions (soundboard). Set when room created. */
  hostToken?: string;
  /** Events during recording (soundboard plays, etc.). Cleared on start, sent to webrtc on stop. */
  recordingEvents?: RecordingEvent[];
  /** True when a recording has been started and not yet stopped (for reconnecting host). */
  recordingInProgress?: boolean;
  /** Client epoch ms when recording started (for reconnecting host to show elapsed time). */
  recordingStartedAtEpochMs?: number;
  /** When host's socket disconnected. Grace period ends at this + hostDisconnectGraceMs. */
  hostDisconnectedAt?: number;
  /** Grace period ms from hostDisconnectedAt before ending session. */
  hostDisconnectGraceMs?: number;
  /** Segment IDs being processed (recording stopped, webrtc finalizing). Cleared when callback completes. */
  pendingSegmentIds?: string[];
  /** Internal: segmentId of current recording (moved to pendingSegmentIds when stop received). */
  currentRecordingSegmentId?: string;
}

const sessionsByToken = new Map<string, CallSession>();
const sessionsById = new Map<string, CallSession>();
const sessionsByCode = new Map<string, CallSession>();
let hostAwayCheckInterval: ReturnType<typeof setInterval> | null = null;

function getHostDisconnectGraceMs(session: CallSession): number {
  const guestCount = session.participants.filter((p) => !p.isHost).length;
  if (guestCount > 0) return HOST_AWAY_GRACE_WITH_GUESTS_MS;
  if (session.recordingInProgress === true)
    return HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS;
  return HOST_AWAY_GRACE_NO_GUESTS_MS;
}

function ensureHostAwayChecker(
  onSessionEnd: (session: CallSession) => void | Promise<void>,
): void {
  if (hostAwayCheckInterval != null) return;
  hostAwayCheckInterval = setInterval(() => {
    const now = Date.now();
    for (const session of sessionsById.values()) {
      if (session.ended) continue;
      let shouldEnd = false;
      if (session.hostDisconnectedAt != null && session.hostDisconnectGraceMs != null) {
        shouldEnd = now >= session.hostDisconnectedAt + session.hostDisconnectGraceMs;
      } else {
        // No hostDisconnectedAt: host socket never closed. Use configured grace.
        // lastHostHeartbeatAt is updated when host connects (not just heartbeat), so host has full grace.
        const grace = getHostDisconnectGraceMs(session);
        shouldEnd = now - session.lastHostHeartbeatAt >= grace;
      }
      if (shouldEnd) {
        session.ended = true;
        const result = onSessionEnd(session);
        if (result && typeof (result as Promise<unknown>).catch === "function") {
          (result as Promise<void>).catch((err) =>
            console.error("[hostAwayChecker] onSessionEnd failed:", err),
          );
        }
      }
    }
  }, HOST_AWAY_CHECK_INTERVAL_MS);
}

/** Mark host as disconnected (socket closed). Returns grace period for broadcasting. */
export function setHostDisconnected(sessionId: string): { gracePeriodMs: number } | null {
  const session = sessionsById.get(sessionId);
  if (!session || session.ended) return null;
  const hostP = session.participants.find((p) => p.isHost);
  if (!hostP) return null;
  hostP.disconnected = true;
  session.hostDisconnectedAt = Date.now();
  session.hostDisconnectGraceMs = getHostDisconnectGraceMs(session);
  return { gracePeriodMs: session.hostDisconnectGraceMs };
}

/** Clear host disconnected state when host reconnects. */
export function clearHostDisconnected(sessionId: string): void {
  const session = sessionsById.get(sessionId);
  if (!session) return;
  const hostP = session.participants.find((p) => p.isHost);
  if (hostP) hostP.disconnected = false;
  session.hostDisconnectedAt = undefined;
  session.hostDisconnectGraceMs = undefined;
}

function generateJoinCode(): string {
  const reserved = listReservedJoinCodes();
  for (let i = 0; i < 40; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (sessionsByCode.has(code)) continue;
    if (reserved.has(code)) continue;
    return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000)); // fallback, allow collision
}

/** True when a live in-memory session currently holds this join code. */
export function isJoinCodeInUseLive(code: string): boolean {
  const s = sessionsByCode.get(code);
  return s != null && !s.ended;
}

export type CreateSessionOptions = {
  password?: string | null;
  /** Reuse a scheduled meeting's token instead of generating a new one. */
  token?: string;
  /** Reuse a scheduled meeting's join code instead of generating a new one. */
  joinCode?: string;
  /** When set, stored on session for meeting end hooks. */
  meetingId?: string;
};

export function createSession(
  episodeId: string,
  podcastId: string,
  hostUserId: string,
  origin: string,
  passwordOrOpts: string | null | CreateSessionOptions,
  onSessionEnd: (session: CallSession) => void | Promise<void>,
): CallSession {
  const opts: CreateSessionOptions =
    passwordOrOpts != null &&
    typeof passwordOrOpts === "object" &&
    !Array.isArray(passwordOrOpts)
      ? passwordOrOpts
      : { password: passwordOrOpts as string | null };

  const sessionId = nanoid();
  const token = opts.token?.trim() || nanoid(16);
  const joinCode = opts.joinCode?.trim() || generateJoinCode();
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
    joinCode,
    password: opts.password?.trim() || null,
    participants: [hostParticipant],
    createdAt: now,
    lastHostHeartbeatAt: now,
    ended: false,
    meetingId: opts.meetingId,
  };
  sessionsByToken.set(token, session);
  sessionsById.set(sessionId, session);
  sessionsByCode.set(joinCode, session);
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

/** Returns session even if ended; for debug logging. */
export function getSessionByIdRaw(sessionId: string): CallSession | undefined {
  return sessionsById.get(sessionId);
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
  opts?: { source?: "phone" },
): CallParticipant | null {
  const session = sessionsById.get(sessionId);
  if (!session || session.ended) return null;
  const p: CallParticipant = {
    id: participantId,
    name: name || "Guest",
    isHost: false,
    joinedAt: Date.now(),
    ...(opts?.source === "phone" ? { source: "phone" as const } : {}),
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
  if (!muted) p.mutedByHost = undefined;
  return true;
}

/** Guest mutes/unmutes themselves. Unmute only allowed when not host-muted. Returns false if action rejected. */
export function setParticipantMutedBySelf(
  sessionId: string,
  participantId: string,
  muted: boolean,
): boolean {
  const session = sessionsById.get(sessionId);
  if (!session) return false;
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  if (muted) {
    p.muted = true;
    p.mutedByHost = false;
    return true;
  }
  if (p.mutedByHost === true) return false;
  p.muted = false;
  p.mutedByHost = undefined;
  return true;
}

/** Host mutes/unmutes a guest. Unmute only allowed when host was the one who muted. Returns false if action rejected. */
export function setParticipantMutedByHost(
  sessionId: string,
  participantId: string,
  muted: boolean,
): boolean {
  const session = sessionsById.get(sessionId);
  if (!session) return false;
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  if (muted) {
    p.muted = true;
    p.mutedByHost = true;
    return true;
  }
  if (p.mutedByHost !== true) return false;
  p.muted = false;
  p.mutedByHost = undefined;
  return true;
}

export function setParticipantName(
  sessionId: string,
  participantId: string,
  name: string,
): boolean {
  const session = sessionsById.get(sessionId);
  if (!session || session.ended) return false;
  const p = session.participants.find((x) => x.id === participantId);
  if (!p) return false;
  const trimmed = (name ?? "").trim();
  if (trimmed) p.name = trimmed;
  return true;
}

export function endSession(sessionId: string): CallSession | null {
  const session = sessionsById.get(sessionId);
  if (!session) return null;
  session.ended = true;
  sessionsByToken.delete(session.token);
  sessionsById.delete(sessionId);
  if (session.joinCode) sessionsByCode.delete(session.joinCode);
  if (session.meetingId) {
    try {
      markMeetingEndedBySessionId(session.sessionId);
    } catch (err) {
      console.error("[callSession] markMeetingEndedBySessionId failed:", err);
    }
  }
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

export function setSessionHostToken(sessionId: string, hostToken: string): void {
  const session = sessionsById.get(sessionId);
  if (session) session.hostToken = hostToken;
}

/** Ensure session has a joinCode (for legacy sessions created before joinCode was added). */
export function ensureSessionJoinCode(session: CallSession): void {
  if (session.joinCode) return;
  const code = generateJoinCode();
  session.joinCode = code;
  sessionsByCode.set(code, session);
}

export function getSessionByCode(code: string): CallSession | undefined {
  const normalized = String(code).trim();
  if (normalized.length !== 4 || !/^\d{4}$/.test(normalized)) return undefined;
  const s = sessionsByCode.get(normalized);
  return s && !s.ended ? s : undefined;
}

/** Find active session that still has this participant id. */
export function findSessionByParticipantId(participantId: string): CallSession | undefined {
  for (const session of sessionsById.values()) {
    if (session.ended) continue;
    if (session.participants.some((p) => p.id === participantId)) return session;
  }
  return undefined;
}

/** For debugging: count of active (non-ended) sessions. */
export function getActiveSessionCount(): number {
  return Array.from(sessionsById.values()).filter((s) => !s.ended).length;
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

/** Returns any active (non-ended) session for this episode, for limiting one call per episode. */
export function getAnyActiveSessionForEpisode(
  episodeId: string,
): CallSession | undefined {
  for (const session of sessionsById.values()) {
    if (!session.ended && session.episodeId === episodeId) {
      return session;
    }
  }
  return undefined;
}
