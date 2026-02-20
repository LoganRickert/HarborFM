import type { FastifyInstance } from "fastify";
import {
  getOrCreateSetupToken,
  isSetupComplete,
  readSetupToken,
} from "../../services/setup.js";
import { readSettings } from "../settings/index.js";
import {
  getClientIp,
  getIpBan,
  getUserAgent,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import { setupTokenQuerySchema } from "@harborfm/shared";
import { timingSafeEqualStrings } from "../../utils/secretCompare.js";
import { buildSetupStatusResponse } from "./utils.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  app.get(
    "/setup/status",
    {
      schema: {
        tags: ["Setup"],
        summary: "Get setup status",
        description:
          "Returns whether the server needs initial setup and client config (registration, public feeds, CAPTCHA, welcome banner). No authentication required.",
        security: [],
        response: {
          200: {
            description: "Setup status and client config",
            type: "object",
            properties: {
              setupRequired: { type: "boolean" },
              registrationEnabled: { type: "boolean" },
              publicFeedsEnabled: { type: "boolean" },
              captchaProvider: { type: "string" },
              captchaSiteKey: { type: "string" },
              emailConfigured: { type: "boolean" },
              welcomeBanner: { type: "string" },
              twoFactorEnabled: { type: "boolean" },
              twoFactorEnforced: { type: "boolean" },
              twoFactorMethods: { type: "string" },
              emailSigninDisabled: { type: "boolean" },
            },
          },
        },
      },
    },
    async () => {
      const setupRequired = !isSetupComplete();
      if (setupRequired) {
        return {
          setupRequired: true,
          registrationEnabled: false,
          publicFeedsEnabled: false,
          captchaProvider: "none" as const,
          captchaSiteKey: "",
          emailConfigured: false,
          welcomeBanner: "",
          twoFactorEnabled: false,
          twoFactorEnforced: false,
          twoFactorMethods: "totp",
          emailSigninDisabled: false,
        };
      }
      try {
        const settings = readSettings();
        return buildSetupStatusResponse(settings);
      } catch {
        // Best-effort: if settings can't be read for any reason, default to allowing registration.
        return {
          setupRequired: false,
          registrationEnabled: true,
          publicFeedsEnabled: true,
          captchaProvider: "none" as const,
          captchaSiteKey: "",
          emailConfigured: false,
          welcomeBanner: "",
          twoFactorEnabled: false,
          twoFactorEnforced: false,
          twoFactorMethods: "totp",
          emailSigninDisabled: false,
        };
      }
    },
  );

  app.get(
    "/setup/validate",
    {
      schema: {
        tags: ["Setup"],
        summary: "Validate setup token",
        description:
          "Validates a setup link ID (query param `id`). Does not return the token. Used before showing the setup form.",
        security: [],
        querystring: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: {
            description: "Token valid",
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          400: { description: "Missing setup id" },
          401: { description: "Invalid setup id" },
          409: { description: "Setup already completed" },
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

      const parsed = setupTokenQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Missing setup id",
          details: parsed.error.flatten(),
        });
      }
      const token = parsed.data.id.trim();

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
        return reply.status(401).send({ error: "Invalid setup id" });
      }

      return reply.send({ ok: true });
    },
  );

  app.post(
    "/setup/prepare",
    {
      schema: {
        tags: ["Setup"],
        summary: "Prepare setup",
        description:
          "Ensures setup token exists. Call before redirecting to setup. Returns 409 if setup already complete.",
        security: [],
        response: {
          200: {
            description: "Ready",
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          409: { description: "Setup already completed" },
        },
      },
    },
    async (request, reply) => {
      if (isSetupComplete()) {
        return reply.status(409).send({ error: "Setup already completed" });
      }
      getOrCreateSetupToken();
      return { ok: true };
    },
  );
}
