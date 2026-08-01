import type { FastifyInstance } from "fastify";
import { registerArchiveSettingsRoutes } from "./routes.settings.js";
import { registerArchiveEpisodeRoutes } from "./routes.episode.js";

export async function archiveRoutes(app: FastifyInstance) {
  await app.register(registerArchiveSettingsRoutes);
  await app.register(registerArchiveEpisodeRoutes);
}
