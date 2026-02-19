import type { FastifyInstance } from "fastify";
import { registerSitemapRoutes } from "./routes.sitemap.js";
import { registerCacheRoutes } from "./routes.cache.js";

export async function sitemapRoutes(app: FastifyInstance) {
  await registerSitemapRoutes(app);
  await registerCacheRoutes(app);
}
