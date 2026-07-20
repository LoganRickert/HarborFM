import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import {
  consumeSetupToken,
  isSetupComplete,
  readSetupToken,
} from "../../services/setup.js";
import {
  getClientIp,
  getIpBan,
  getUserAgent,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import {
  setupTokenQuerySchema,
  setupCompleteBodySchema,
} from "@harborfm/shared";
import { normalizeHostname } from "../../utils/url.js";
import { timingSafeEqualStrings } from "../../utils/secretCompare.js";
import * as repo from "./repo.js";

export async function registerCompleteRoutes(app: FastifyInstance) {
  app.post(
    "/setup/complete",
    {
      schema: {
        tags: ["Setup"],
        summary: "Complete setup",
        description:
          "Finish initial setup: create admin account and apply settings. Requires valid setup token (id query). No auth.",
        security: [],
        querystring: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            email: { type: "string" },
            password: { type: "string" },
            hostname: { type: "string" },
            registrationEnabled: { type: "boolean" },
            publicFeedsEnabled: { type: "boolean" },
            importPixabayAssets: { type: "boolean" },
          },
          required: ["email", "password"],
        },
        response: {
          200: { description: "Setup complete" },
          201: { description: "Setup complete" },
          400: { description: "Validation failed" },
          401: { description: "Missing setup id" },
          409: { description: "Already completed" },
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      if (isSetupComplete()) {
        return reply.status(409).send({ error: "Setup already completed" });
      }

      const ip = getClientIp(request);
      const userAgent = getUserAgent(request);
      const ban = getIpBan(ip, "setup");
      if (ban.banned) {
        return reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({
            error:
              "Too many invalid setup link attempts. Try again in a few minutes.",
          });
      }

      const queryParsed = setupTokenQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.status(401).send({
          error:
            queryParsed.error.issues[0]?.message ??
            "Missing setup id. Check server logs for the setup URL.",
        });
      }
      const token = queryParsed.data.id.trim();

      const bodyParsed = setupCompleteBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
          details: bodyParsed.error.flatten(),
        });
      }
      const body = bodyParsed.data;
      const email = body.email.trim().toLowerCase();
      const password = body.password;
      const hostname =
        body.hostname !== undefined
          ? normalizeHostname(body.hostname)
          : "";
      const registrationEnabled =
        body.registrationEnabled !== undefined
          ? Boolean(body.registrationEnabled)
          : true;
      const publicFeedsEnabled =
        body.publicFeedsEnabled !== undefined
          ? Boolean(body.publicFeedsEnabled)
          : true;
      const importPixabayAssets =
        typeof body?.importPixabayAssets === "boolean"
          ? body.importPixabayAssets
          : false;

      if (!email || !email.includes("@")) {
        return reply.status(400).send({ error: "Valid email is required" });
      }
      if (!password || password.trim().length < 8) {
        return reply
          .status(400)
          .send({ error: "Password must be at least 8 characters" });
      }

      const currentToken = readSetupToken();
      if (!currentToken || !timingSafeEqualStrings(token, currentToken)) {
        const after = recordFailureAndMaybeBan(ip, "setup", { userAgent });
        if (after.bannedNow) {
          return reply
            .status(429)
            .header("Retry-After", String(after.retryAfterSec))
            .send({
              error:
                "Too many invalid setup link attempts. Try again in a few minutes.",
            });
        }
        return reply.status(401).send({
          error: "Invalid setup id. Check server logs for the setup URL.",
        });
      }

      const id = nanoid();
      const password_hash = await argon2.hash(password);
      drizzleDb.insert(users).values({
        id,
        email,
        passwordHash: password_hash,
        role: "admin",
        canTranscribe: 1,
        canGenerateVideo: 1,
        canStripe: 1,
        canEpisodeAlert: 1,
        canUploadEpisodeFiles: 1,
        canImportTheme: 1,
      }).run();

      repo.writeSetting("hostname", hostname);
      repo.writeSetting("registration_enabled", String(registrationEnabled));
      repo.writeSetting("public_feeds_enabled", String(publicFeedsEnabled));
      repo.writeSetting("setup_completed", "true");

      if (importPixabayAssets) {
        try {
          await repo.importPixabayAssetsIntoLibrary(id, request.log);
        } catch (err) {
          request.log.warn(
            { err },
            "Pixabay assets import failed (setup completed)",
          );
        }
      }

      consumeSetupToken(token);

      return reply
        .status(201)
        .send({ ok: true, user: { id, email, role: "admin" as const } });
    },
  );
}
