import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/drizzle.js";
import { ipBans, loginAttempts } from "../../db/schema.js";
import { bansIpParamSchema } from "@harborfm/shared";

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
      const parsed = bansIpParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const trimmed = parsed.data.ip.trim();
      const banResult = drizzleDb.delete(ipBans).where(eq(ipBans.ip, trimmed)).run();
      const failResult = drizzleDb.delete(loginAttempts).where(eq(loginAttempts.ip, trimmed)).run();
      request.log.info(
        { ip: trimmed, bansDeleted: banResult.changes, failuresCleared: failResult.changes },
        "[ban] Unban IP",
      );
      return reply
        .status(200)
        .send({ ok: true, deleted: banResult.changes });
    },
  );
}
