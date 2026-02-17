import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { getWorker, getRoom, setRoom, deleteRoom, roomsMap } from "../room.js";
import { assertSafeId } from "../validation.js";
import { MAX_ROOMS } from "../config.js";

export async function registerRoomRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { roomId?: string; hostToken?: string };
    Reply: { roomId: string; rtpCapabilities: import("mediasoup/types").RtpCapabilities } | { error: string };
  }>("/room", async (request, reply) => {
    const body = request.body as { roomId?: string; hostToken?: string } | undefined;
    const roomId = body?.roomId ?? nanoid(10);
    const hostToken = typeof body?.hostToken === "string" ? body.hostToken.trim() || undefined : undefined;
    if (body?.roomId) {
      try {
        assertSafeId(body.roomId, "roomId");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid roomId";
        return reply.status(400).send({ error: msg });
      }
    }
    const room = getRoom(roomId);
    if (room) {
      if (hostToken) room.hostToken = hostToken;
      return reply.send({ roomId, rtpCapabilities: room.router.rtpCapabilities });
    }
    if (roomsMap.size >= MAX_ROOMS) {
      return reply.status(503).send({ error: "Too many rooms" });
    }
    const w = await getWorker();
    const router = await w.createRouter({
      mediaCodecs: [{ kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }],
    });
    router.on("workerclose", () => deleteRoom(roomId));
    setRoom(roomId, {
      router,
      transports: new Map(),
      producers: new Map(),
      ...(hostToken ? { hostToken } : {}),
    });
    return reply.send({ roomId, rtpCapabilities: router.rtpCapabilities });
  });
}
