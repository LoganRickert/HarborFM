import "dotenv/config";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyRateLimit from "@fastify/rate-limit";
import { RecordingManager } from "./recording/RecordingManager.js";
import {
  recoverPartFiles,
  markInterruptedSegments,
  cleanupSoundboardTemp,
} from "./recording/segmentMetadata.js";
import { registerRoutes } from "./routes/index.js";
import { wsHandler } from "./ws/handler.js";
import {
  PORT,
  RECORDING_DATA_DIR,
  RECORD_PORT_BASE,
  RECORD_PORT_STRIDE,
  MAIN_APP_URL,
  WEBRTC_SERVICE_SECRET,
  WEBRTC_INSECURE_SKIP_AUTH,
  WEBRTC_RATE_LIMIT_MAX,
  WEBRTC_RATE_LIMIT_TIME_WINDOW,
  IS_PRODUCTION,
} from "./config.js";
import {
  getRoom,
  recordingByRoom,
  producerSourceMapRef,
  producerParticipantMapRef,
  producerSoundboardAssetMapRef,
  soundboardVolumeByRoomRef,
  soundboardVolumeAtStopRef,
  producerVolumeByProducerId,
} from "./room.js";

const recordingManager = new RecordingManager({
  recordingDataDir: RECORDING_DATA_DIR,
  recordPortBase: RECORD_PORT_BASE,
  recordPortStride: RECORD_PORT_STRIDE,
  getRoom,
  recordingByRoom,
  mainAppUrl: MAIN_APP_URL,
  getProducerSource: (producerId) => producerSourceMapRef.get(producerId),
  getProducerParticipant: (producerId) => producerParticipantMapRef.get(producerId),
  getProducerSoundboardAsset: (producerId) => producerSoundboardAssetMapRef.get(producerId),
  getSoundboardVolumeForSegment: (roomId, producerId) => {
    const atStop = soundboardVolumeAtStopRef.get(producerId);
    if (atStop != null) {
      soundboardVolumeAtStopRef.delete(producerId);
      return atStop;
    }
    return soundboardVolumeByRoomRef.get(roomId) ?? 1;
  },
  getProducerVolumeForSegment: (producerId) =>
    producerVolumeByProducerId.get(producerId) ?? 1,
});

function finalizeProducerStream(
  roomId: string,
  state: import("./recording/RecordingManager.js").RecordingState,
  producerId: string,
  reason: string
): void {
  recordingManager.finalizeProducerStream(roomId, state, producerId, reason);
}

if (!WEBRTC_SERVICE_SECRET && !WEBRTC_INSECURE_SKIP_AUTH) {
  console.error(
    "[webrtc] WEBRTC_SERVICE_SECRET is unset. WebRTC is disabled. Set WEBRTC_SERVICE_SECRET in production, or WEBRTC_INSECURE_SKIP_AUTH=1 for e2e."
  );
  process.exit(1);
}

if (WEBRTC_INSECURE_SKIP_AUTH && IS_PRODUCTION) {
  console.error(
    "[webrtc] WEBRTC_INSECURE_SKIP_AUTH=1 is not allowed in production. Set WEBRTC_SERVICE_SECRET and remove WEBRTC_INSECURE_SKIP_AUTH."
  );
  process.exit(1);
}

const app = Fastify({ logger: true });
await app.register(fastifyRateLimit, {
  max: WEBRTC_RATE_LIMIT_MAX,
  timeWindow: WEBRTC_RATE_LIMIT_TIME_WINDOW,
});
await app.register(fastifyWebsocket);

app.addContentTypeParser(/^application\/json\b/i, { parseAs: "string" }, (req, body, done) => {
  try {
    const str = (body as string) ?? "";
    done(null, str.trim() ? JSON.parse(str) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.get("/health", async (_request, reply) => reply.send({ ok: true }));

app.addHook("preHandler", async (request, reply) => {
  const path = request.url.split("?")[0] ?? "";
  const protectedPaths = ["/room", "/start-recording", "/stop-recording"];
  if (!protectedPaths.includes(path)) return;
  if (!WEBRTC_SERVICE_SECRET) return;
  const header = request.headers["x-webrtc-service-secret"];
  const secret = typeof header === "string" ? header.trim() : "";
  if (secret !== WEBRTC_SERVICE_SECRET) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

await registerRoutes(app, recordingManager, finalizeProducerStream);

app.get("/ws", { websocket: true }, wsHandler);
app.get("/webrtc-ws/ws", { websocket: true }, wsHandler);

const recovered = recoverPartFiles(RECORDING_DATA_DIR);
if (recovered.length > 0) {
  console.warn("[webrtc] Recovered %d part files on startup: %j", recovered.length, recovered);
}
markInterruptedSegments(RECORDING_DATA_DIR);
const sbCleaned = cleanupSoundboardTemp(RECORDING_DATA_DIR);
if (sbCleaned > 0) {
  console.warn("[webrtc] Cleaned %d stale soundboard temp files on startup", sbCleaned);
}

if (!WEBRTC_SERVICE_SECRET && WEBRTC_INSECURE_SKIP_AUTH) {
  console.warn(
    "[webrtc] WEBRTC_INSECURE_SKIP_AUTH=1: /room, /start-recording, /stop-recording are unprotected. Use only for e2e."
  );
}

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log("[webrtc] Service listening on port %d", PORT);
