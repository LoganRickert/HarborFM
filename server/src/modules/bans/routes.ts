import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../plugins/auth.js";
import { db } from "../../db/index.js";

export async function bansRoutes(app: FastifyInstance) {
  app.delete(
    "/bans/:ip",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Bans"],
        summary: "Unban IP",
        description:
          "Remove all ban entries for an IP address. Admin only. Use after clearing login/API-key/subscriber-token failures if desired.",
        params: {
          type: "object",
          properties: { ip: { type: "string" } },
          required: ["ip"],
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" }, deleted: { type: "integer" } },
            required: ["ok", "deleted"],
            description: "IP unbanned.",
          },
          400: { description: "IP missing or empty" },
        },
      },
    },
    async (request, reply) => {
      const { ip } = request.params as { ip: string };
      const trimmed = (ip || "").trim();
      if (!trimmed) {
        return reply.status(400).send({ error: "IP is required" });
      }
      const banResult = db.prepare("DELETE FROM ip_bans WHERE ip = ?").run(trimmed);
      const failResult = db.prepare("DELETE FROM login_attempts WHERE ip = ?").run(trimmed);
      console.log(`[ban] Unban IP=${trimmed} bans_deleted=${banResult.changes} failures_cleared=${failResult.changes}`);
      return reply
        .status(200)
        .send({ ok: true, deleted: banResult.changes });
    },
  );
}
