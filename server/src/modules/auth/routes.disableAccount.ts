import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { disableAccountBodySchema } from "@harborfm/shared";
import { JWT_COOKIE_NAME } from "../../config.js";
import { requireSession } from "./shared.js";
import { sha256Hex } from "../../utils/hash.js";

function disableAccountRateLimitKeyGenerator(request: {
  cookies?: Record<string, string | undefined>;
  ip?: string;
}) {
  const token = (
    request as { cookies?: Record<string, string | undefined> }
  ).cookies?.[JWT_COOKIE_NAME];
  if (typeof token === "string" && token.trim()) {
    return `disable-account:${sha256Hex(token.trim())}`;
  }
  return `disable-account:ip:${(request.ip || "").trim() || "unknown"}`;
}

export async function registerDisableAccountRoutes(app: FastifyInstance) {
  app.post(
    "/auth/me/disable-account",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: disableAccountRateLimitKeyGenerator,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Disable own account",
        body: {
          type: "object",
          properties: {
            password: { type: "string" },
          },
        },
        response: {
          200: { description: "OK" },
          400: { description: "Validation failed" },
          401: { description: "Invalid password or unauthorized" },
          403: { description: "Forbidden (read-only, 2FA required off, only admin)" },
          404: { description: "User not found" },
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      if (
        !requireSession(request, reply as Parameters<typeof requireSession>[1])
      )
        return;

      const parsed = disableAccountBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const row = drizzleDb
        .select({
          passwordHash: users.passwordHash,
          role: users.role,
          twoFactorMethod: users.twoFactorMethod,
          totpSecretEnc: users.totpSecretEnc,
        })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1)
        .get();

      if (!row) {
        return reply.status(404).send({ error: "User not found" });
      }

      const has2FA =
        Boolean(row.twoFactorMethod?.trim()) || Boolean(row.totpSecretEnc);
      if (has2FA) {
        return reply.status(403).send({
          error:
            "Disable two-factor authentication first before disabling your account.",
        });
      }

      if (row.role === "admin") {
        const adminCountRow = drizzleDb
          .select({
            count: sql<number>`count(*)`.as("count"),
          })
          .from(users)
          .where(
            and(
              eq(users.role, "admin"),
              sql`COALESCE(${users.disabled}, 0) = 0`,
            ),
          )
          .get();
        const adminCount = Number(adminCountRow?.count ?? 0);
        if (adminCount <= 1) {
          return reply.status(403).send({
            error:
              "You cannot disable your account because you are the only administrator.",
          });
        }
      }

      const isFederated =
        !row.passwordHash || String(row.passwordHash).trim() === "";

      if (!isFederated) {
        const password = parsed.data.password?.trim();
        if (!password) {
          return reply.status(400).send({
            error: "Password is required to disable your account.",
          });
        }
        const valid = await argon2.verify(row.passwordHash!, password);
        if (!valid) {
          return reply.status(401).send({ error: "Invalid password" });
        }
      }

      drizzleDb
        .update(users)
        .set({ disabled: true })
        .where(eq(users.id, request.userId))
        .run();

      return reply.send({ ok: true });
    },
  );
}
