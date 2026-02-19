import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../plugins/auth.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import {
  runGeoIPUpdate,
  validateMaxMindCredentials,
} from "../../services/geoipupdate.js";
import {
  checkGeoLiteDatabases,
  refreshGeoLiteReaders,
} from "../../services/geolocation.js";
import { settingsGeoliteTestBodySchema } from "@harborfm/shared";
import * as repo from "./repo.js";

export async function registerGeoliteRoutes(app: FastifyInstance) {
  app.post(
    "/settings/geolite/test",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "geolite-test", windowMs: 5000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test MaxMind credentials",
        description:
          "Validate Account ID and License Key by running geoipupdate in a temp directory. If credentials are omitted, uses saved settings. Admin only.",
        body: {
          type: "object",
          properties: {
            maxmindAccountId: { type: "string" },
            maxmindLicenseKey: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" }, error: { type: "string" } },
            required: ["ok"],
          },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsGeoliteTestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const accountId = body.maxmindAccountId?.trim();
      const licenseKey =
        body.maxmindLicenseKey != null && body.maxmindLicenseKey !== ""
          ? body.maxmindLicenseKey.trim()
          : undefined;
      const result = await validateMaxMindCredentials(
        accountId,
        licenseKey,
        () => {
          const current = repo.readSettings();
          return {
            accountId: (current.maxmind_account_id ?? "").trim(),
            licenseKey: (current.maxmind_license_key ?? "").trim(),
          };
        },
      );
      return reply.send(result);
    },
  );

  app.get(
    "/settings/geolite/check",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Check GeoLite2 databases",
        description:
          "Verify whether GeoLite2-City and/or GeoLite2-Country database files exist. Admin only.",
        response: {
          200: {
            type: "object",
            properties: {
              city: { type: "boolean" },
              country: { type: "boolean" },
            },
            required: ["city", "country"],
          },
        },
      },
    },
    async (_request, reply) => {
      const result = checkGeoLiteDatabases();
      return reply.send(result);
    },
  );

  app.post(
    "/settings/geolite/update",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "geolite-update", windowMs: 60_000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Update GeoLite2 databases",
        description:
          "Run geoipupdate with the provided or saved MaxMind credentials. If license key is omitted or empty, the saved key is used. Admin only.",
        body: {
          type: "object",
          properties: {
            maxmindAccountId: { type: "string" },
            maxmindLicenseKey: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" }, error: { type: "string" } },
            required: ["ok"],
          },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsGeoliteTestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const accountId = body.maxmindAccountId?.trim();
      const licenseKey =
        body.maxmindLicenseKey != null && body.maxmindLicenseKey !== ""
          ? body.maxmindLicenseKey.trim()
          : undefined;
      const result = await runGeoIPUpdate(accountId, licenseKey, () => {
        const current = repo.readSettings();
        return {
          accountId: (current.maxmind_account_id ?? "").trim(),
          licenseKey: (current.maxmind_license_key ?? "").trim(),
        };
      });
      if (result.ok) {
        refreshGeoLiteReaders();
      }
      return reply.send(result);
    },
  );
}
