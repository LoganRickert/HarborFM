import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../plugins/auth.js";
import { clearSitemapCache } from "../../services/sitemap.js";

export async function registerCacheRoutes(app: FastifyInstance) {
  app.delete("/sitemap/cache", {
    preHandler: [requireAdmin],
    schema: {
      tags: ["Sitemap"],
      summary: "Clear sitemap cache (admin)",
      response: {
        200: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          description: "Cache cleared.",
        },
      },
    },
  }, async (_request, reply) => {
    clearSitemapCache();
    return reply.status(200).send({ ok: true });
  });
}
