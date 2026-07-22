/** Shared WebSocket room membership for mediasoup signaling clients. */
const socketRooms = new Map<unknown, string>();

export function setSocketRoom(socket: unknown, roomId: string): void {
  socketRooms.set(socket, roomId);
}

export function deleteSocketRoom(socket: unknown): void {
  socketRooms.delete(socket);
}

export function getSocketRoom(socket: unknown): string | undefined {
  return socketRooms.get(socket);
}

/** Broadcast a JSON payload to all WebSocket clients in a mediasoup room. */
export function broadcastToRoom(roomId: string, payload: object): void {
  const data = JSON.stringify(payload);
  for (const [s, r] of socketRooms.entries()) {
    if (r === roomId && (s as { readyState?: number }).readyState === 1) {
      (s as { send: (d: string) => void }).send(data);
    }
  }
}

/** Iterate sockets in a room (for soundboard fan-out that needs the Map). */
export function forEachSocketInRoom(
  roomId: string,
  fn: (socket: unknown) => void,
): void {
  for (const [s, r] of socketRooms.entries()) {
    if (r === roomId) fn(s);
  }
}
