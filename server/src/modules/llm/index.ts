import type { FastifyInstance } from "fastify";
import { registerAvailableRoutes } from "./routes.available.js";
import { registerAskRoutes } from "./routes.ask.js";
import { registerChapterRoutes } from "./routes.chapters.js";
import { registerEpisodeMetadataRoutes } from "./routes.episodeMetadata.js";

export async function llmRoutes(app: FastifyInstance) {
  await app.register(registerAvailableRoutes);
  await app.register(registerAskRoutes);
  await app.register(registerChapterRoutes);
  await app.register(registerEpisodeMetadataRoutes);
}
