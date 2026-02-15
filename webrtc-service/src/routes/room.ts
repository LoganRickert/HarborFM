import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { getWorker, getRoom, setRoom, deleteRoom } from "../room.js";

export async function registerRoomRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { roomId?: string };
    Reply: { roomId: string; rtpCapabilities: import("mediasoup/types").RtpCapabilities };
  }>("/room", async (request, reply) => {
    const body = request.body as { roomId?: string } | undefined;
    const roomId = body?.roomId ?? nanoid(10);
    const room = getRoom(roomId);
    if (room) {
      return reply.send({ roomId, rtpCapabilities: room.router.rtpCapabilities });
    }
    const w = await getWorker();
    const router = await w.createRouter({
      mediaCodecs: [{ kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }],
    });
    router.on("workerclose", () => deleteRoom(roomId));
    setRoom(roomId, { router, transports: new Map(), producers: new Map() });
    return reply.send({ roomId, rtpCapabilities: router.rtpCapabilities });
  });
}
