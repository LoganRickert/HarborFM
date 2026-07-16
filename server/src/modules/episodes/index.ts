import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";
import { registerArtworkRoutes } from "./routes.artwork.js";
import { registerCastRoutes } from "./routes.cast.js";
import { registerProjectRoutes } from "./routes.project.js";

export async function episodeRoutes(app: FastifyInstance) {
  await app.register(registerCoreRoutes);
  await app.register(registerArtworkRoutes);
  await app.register(registerCastRoutes);
  await app.register(registerProjectRoutes);
}
