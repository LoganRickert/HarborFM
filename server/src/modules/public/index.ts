import type { FastifyInstance } from "fastify";
import { registerLegalRoutes } from "./routes.legal.js";
import { registerConfigRoutes } from "./routes.config.js";
import { registerArtworkRoutes } from "./routes.artwork.js";
import { registerPodcastsRoutes } from "./routes.podcasts.js";
import { registerEpisodesRoutes } from "./routes.episodes.js";
import { registerRssRoutes } from "./routes.rss.js";
import { registerPrivateRoutes } from "./routes.private.js";
import { registerSubscriberAuthRoutes } from "./routes.subscriber-auth.js";

export async function publicRoutes(app: FastifyInstance) {
  await app.register(registerLegalRoutes);
  await app.register(registerConfigRoutes);
  await app.register(registerArtworkRoutes);
  await app.register(registerPodcastsRoutes);
  await app.register(registerEpisodesRoutes);
  await app.register(registerRssRoutes);
  await app.register(registerPrivateRoutes);
  await app.register(registerSubscriberAuthRoutes);
}
