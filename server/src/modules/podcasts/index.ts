import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";
import { registerArtworkRoutes } from "./routes.artwork.js";
import { registerCastRoutes } from "./routes.cast.js";
import { registerCollaboratorRoutes } from "./routes.collaborators.js";
import { registerTokenRoutes } from "./routes.tokens.js";

export async function podcastRoutes(app: FastifyInstance) {
  await app.register(registerCoreRoutes);
  await app.register(registerArtworkRoutes);
  await app.register(registerCastRoutes);
  await app.register(registerCollaboratorRoutes);
  await app.register(registerTokenRoutes);
}
