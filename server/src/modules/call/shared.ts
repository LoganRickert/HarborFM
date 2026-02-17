import type { WebSocket } from "ws";
import { timingSafeEqualStrings } from "../../utils/secretCompare.js";
import { getWebRtcConfig } from "../../services/webrtcConfig.js";

export function validateRecordingSecret(
  secret: string | undefined,
  expected: string | null,
): boolean {
  if (!expected) return false;
  const s = typeof secret === "string" ? secret : "";
  return timingSafeEqualStrings(s, expected);
}

export const CALL_JOIN_CONTEXT = "call_join" as const;

export const sessionSockets = new Map<string, Set<WebSocket>>(); // sessionId -> Set<WebSocket>
export const socketToParticipant = new Map<
  WebSocket,
  { sessionId: string; participantId: string }
>();
// Sockets that connected as host but were told "alreadyInCall" - awaiting migrateHost
export const pendingMigrateHosts = new Map<
  WebSocket,
  { sessionId: string; participantId: string; hostName?: string }
>();
// When each host socket was added (for detecting React StrictMode remount)
export const hostSocketAddedAt = new Map<WebSocket, number>();

export function broadcastToSession(sessionId: string, payload: object): void {
  const sockets = sessionSockets.get(sessionId);
  if (!sockets) return;
  const data = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

export function removeSocketFromSession(sessionId: string, ws: WebSocket): void {
  const sockets = sessionSockets.get(sessionId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) sessionSockets.delete(sessionId);
  }
}

/** Extract base origin (scheme + host) from request headers. Origin header is preferred; referer is parsed to get origin (not just path-stripped). */
export function getRequestOrigin(
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

/** Build WebRTC public WS URL from config or origin. Returns null if unavailable. */
export function getPublicWsUrl(
  origin?: string,
  referer?: string
): string | null {
  const webrtcCfg = getWebRtcConfig();
  if (webrtcCfg.publicWsUrl) {
    return (
      webrtcCfg.publicWsUrl
        .replace(/^http/, "ws")
        .replace(/^https/, "wss")
        .replace(/\/$/, "") + "/ws"
    );
  }
  const o = getRequestOrigin(origin, referer);
  if (!o) return null;
  try {
    const base = new URL(o).origin.replace(/^http/, "ws").replace(/^https/, "wss");
    return `${base}/webrtc-ws/ws`;
  } catch {
    return null;
  }
}
