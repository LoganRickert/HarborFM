import type { FastifyInstance } from "fastify";
import { registerAsrRoutes } from "./routes.asr.js";
import { registerCoreRoutes } from "./routes.core.js";
import { registerMediaRoutes } from "./routes.media.js";
import { registerTranscriptRoutes } from "./routes.transcript.js";
import { registerProcessingRoutes } from "./routes.processing.js";
import { registerRenderRoutes } from "./routes.render.js";

export async function segmentRoutes(app: FastifyInstance) {
  await app.register(registerAsrRoutes);
  await app.register(registerCoreRoutes);
  await app.register(registerMediaRoutes);
  await app.register(registerTranscriptRoutes);
  await app.register(registerProcessingRoutes);
  await app.register(registerRenderRoutes);
}

export { generateSrtFromWhisper, generateSrtFromOpenAI } from "./utils.js";
