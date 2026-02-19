import type { WebSocket } from "ws";
import { canAccessEpisode } from "./access.js";

interface SocketInfo {
  episodeId: string;
  podcastId: string;
  userId: string;
}

const episodeRooms = new Map<string, Set<WebSocket>>();
const userRooms = new Map<string, Set<WebSocket>>();
const socketToInfo = new Map<WebSocket, SocketInfo>();

function sendToSocket(ws: WebSocket, payload: object): void {
  if (ws.readyState !== 1) return; // OPEN = 1
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // ignore send errors
  }
}

/**
 * Subscribe a WebSocket to an episode room and user room.
 * Call when a client connects to the episode collaboration WebSocket.
 */
export function subscribeEpisode(
  episodeId: string,
  podcastId: string,
  userId: string,
  ws: WebSocket,
): void {
  socketToInfo.set(ws, { episodeId, podcastId, userId });

  let episodeSockets = episodeRooms.get(episodeId);
  if (!episodeSockets) {
    episodeSockets = new Set();
    episodeRooms.set(episodeId, episodeSockets);
  }
  episodeSockets.add(ws);

  let userSockets = userRooms.get(userId);
  if (!userSockets) {
    userSockets = new Set();
    userRooms.set(userId, userSockets);
  }
  userSockets.add(ws);
}

/**
 * Unsubscribe a WebSocket from all rooms.
 * Call when a client disconnects.
 */
export function unsubscribeEpisode(ws: WebSocket): void {
  const info = socketToInfo.get(ws);
  if (!info) return;

  socketToInfo.delete(ws);

  const episodeSockets = episodeRooms.get(info.episodeId);
  if (episodeSockets) {
    episodeSockets.delete(ws);
    if (episodeSockets.size === 0) episodeRooms.delete(info.episodeId);
  }

  const userSockets = userRooms.get(info.userId);
  if (userSockets) {
    userSockets.delete(ws);
    if (userSockets.size === 0) userRooms.delete(info.userId);
  }
}

/**
 * Broadcast a payload to all clients subscribed to an episode.
 */
export function broadcastToEpisode(episodeId: string, payload: object): void {
  const sockets = episodeRooms.get(episodeId);
  const type = (payload as { type?: string }).type ?? "?";
  const n = sockets ? sockets.size : 0;
  const extra =
    type === "segmentAdded"
      ? ` pendingSegmentIds=${JSON.stringify((payload as { pendingSegmentIds?: string[] }).pendingSegmentIds)}`
      : "";
  console.log("[episodeBroadcast] broadcastToEpisode episodeId=%s type=%s subscribers=%d%s", episodeId, type, n, extra);
  if (!sockets) return;
  for (const ws of sockets) {
    sendToSocket(ws, payload);
  }
}

/**
 * Broadcast a payload to all clients for a given user (e.g. library updates).
 */
export function broadcastToUser(userId: string, payload: object): void {
  const sockets = userRooms.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    sendToSocket(ws, payload);
  }
}

/**
 * Broadcast a payload to all clients viewing any episode of a podcast.
 * Used for show cast changes (create/edit/delete podcast cast member).
 */
export function broadcastToPodcast(podcastId: string, payload: object): void {
  for (const [ws, info] of socketToInfo) {
    if (info.podcastId === podcastId) {
      sendToSocket(ws, payload);
    }
  }
}

const STALE_ACCESS_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Start periodic re-check of episode access for active sockets.
 * Closes sockets when the user no longer has access (e.g. removed from podcast share).
 * Returns a function to stop the interval (call on server shutdown).
 */
export function startStaleAccessCheck(): () => void {
  const id = setInterval(() => {
    for (const [ws, info] of socketToInfo) {
      if (ws.readyState !== 1) continue;
      const access = canAccessEpisode(info.userId, info.episodeId);
      if (!access) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }
  }, STALE_ACCESS_CHECK_INTERVAL_MS);
  return () => clearInterval(id);
}
