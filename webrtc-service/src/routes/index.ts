import type { FastifyInstance } from "fastify";
import { registerRoomRoutes } from "./room.js";
import { registerRecordingRoutes } from "./recording.js";
import type { RecordingManager } from "../recording/RecordingManager.js";

export async function registerRoutes(
  app: FastifyInstance,
  recordingManager: RecordingManager,
  finalizeProducerStream: (
    roomId: string,
    state: import("../recording/RecordingManager.js").RecordingState,
    producerId: string,
    reason: string
  ) => void
): Promise<void> {
  await registerRoomRoutes(app);
  registerRecordingRoutes(app, recordingManager, finalizeProducerStream);
}
