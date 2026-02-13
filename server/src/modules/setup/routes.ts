import type { FastifyInstance } from "fastify";
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { db } from "../../db/index.js";
import {
  consumeSetupToken,
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
import { setupTokenQuerySchema, setupCompleteBodySchema } from "@harborfm/shared";
import { normalizeHostname } from "../../utils/url.js";
import { libraryDir, libraryAssetPath } from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { existsSync, statSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INITIAL_ASSETS_PATH = join(__dirname, "..", "..", "..", "initial-assets.json");

function writeSetting(key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(key, value);
}

export async function setupRoutes(app: FastifyInstance) {
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
        };
      }
      try {
        const settings = readSettings();
        const captchaProvider = settings.captcha_provider ?? "none";
        const captchaSiteKey =
          captchaProvider !== "none" ? (settings.captcha_site_key ?? "") : "";
        const emailConfigured =
          settings.email_provider === "smtp" ||
          settings.email_provider === "sendgrid";
        return {
          setupRequired: false,
          registrationEnabled: Boolean(settings.registration_enabled),
          publicFeedsEnabled: Boolean(settings.public_feeds_enabled),
          captchaProvider,
          captchaSiteKey,
          emailConfigured,
          welcomeBanner: String(settings.welcome_banner ?? ""),
        };
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
        };
      }
    },
  );

  // Validate a setup link id (does NOT return the token).
  // Also participates in setup IP banning (too many invalid IDs).
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
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Missing setup id", details: parsed.error.flatten() });
      }
      const token = parsed.data.id.trim();

      const currentToken = readSetupToken();
      if (!currentToken || token !== currentToken) {
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

  // Convenience endpoint so startup logs can mention a stable token exists (does NOT return the token).
  // Also ensures token is generated/persisted for the admin to use.
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
      if (isSetupComplete())
        return reply.status(409).send({ error: "Setup already completed" });
      getOrCreateSetupToken();
      return { ok: true };
    },
  );

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
            registration_enabled: { type: "boolean" },
            public_feeds_enabled: { type: "boolean" },
            import_pixabay_assets: { type: "boolean" },
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
        return reply
          .status(401)
          .send({
            error: queryParsed.error.issues[0]?.message ?? "Missing setup id. Check server logs for the setup URL.",
          });
      }
      const token = queryParsed.data.id.trim();

      const bodyParsed = setupCompleteBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const body = bodyParsed.data;
      const email = body.email.trim().toLowerCase();
      const password = body.password;
      const hostname =
        body.hostname !== undefined
          ? normalizeHostname(body.hostname)
          : "";
      const registrationEnabled =
        typeof body?.registration_enabled === "boolean"
          ? body.registration_enabled
          : false;
      const publicFeedsEnabled =
        typeof body?.public_feeds_enabled === "boolean"
          ? body.public_feeds_enabled
          : true;
      const importPixabayAssets =
        typeof body?.import_pixabay_assets === "boolean"
          ? body.import_pixabay_assets
          : false;

      if (!email || !email.includes("@")) {
        return reply.status(400).send({ error: "Valid email is required" });
      }
      if (!password || password.trim().length < 8) {
        return reply
          .status(400)
          .send({ error: "Password must be at least 8 characters" });
      }

      // Validate token before doing any writes (do not consume yet)
      const currentToken = readSetupToken();
      if (!currentToken || token !== currentToken) {
        // Record failed setup token attempt unless banned (checked above).
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
        return reply
          .status(401)
          .send({
            error: "Invalid setup id. Check server logs for the setup URL.",
          });
      }

      // Create initial admin user (can_transcribe = 1 so first admin can use transcription)
      const id = nanoid();
      const password_hash = await argon2.hash(password);
      db.prepare(
        "INSERT INTO users (id, email, password_hash, role, can_transcribe) VALUES (?, ?, ?, ?, 1)",
      ).run(id, email, password_hash, "admin");

      // Persist initial settings
      writeSetting("hostname", hostname);
      writeSetting("registration_enabled", String(registrationEnabled));
      writeSetting("public_feeds_enabled", String(publicFeedsEnabled));
      writeSetting("setup_completed", "true");

      if (importPixabayAssets) {
        try {
          await importPixabayAssetsIntoLibrary(id, request.log);
        } catch (err) {
          request.log.warn(
            { err },
            "Pixabay assets import failed (setup completed)",
          );
        }
      }

      // Consume token last so transient failures don't burn the setup URL.
      consumeSetupToken(token);

      return reply
        .status(201)
        .send({ ok: true, user: { id, email, role: "admin" as const } });
    },
  );
}

type InitialAsset = {
  name: string;
  tag?: string | null;
  copyright?: string | null;
  license?: string | null;
  download: string;
  source: string;
};

async function importPixabayAssetsIntoLibrary(
  ownerUserId: string,
  log: FastifyInstance["log"],
): Promise<void> {
  if (!existsSync(INITIAL_ASSETS_PATH)) {
    log.info("initial-assets.json not found, skipping Pixabay import");
    return;
  }
  const raw = await readFile(INITIAL_ASSETS_PATH, "utf8");
  const list = raw.trim() ? (JSON.parse(raw) as unknown) : [];
  const assets = Array.isArray(list) ? (list as InitialAsset[]) : [];
  if (assets.length === 0) return;

  const dir = libraryDir(ownerUserId);
  let totalBytes = 0;
  for (const asset of assets) {
    const downloadUrl =
      typeof asset.download === "string" ? asset.download : "";
    const name = typeof asset.name === "string" ? asset.name : "Untitled";
    const tag = typeof asset.tag === "string" ? asset.tag : null;
    const copyright =
      typeof asset.copyright === "string" ? asset.copyright : null;
    const license = typeof asset.license === "string" ? asset.license : null;
    const source = typeof asset.source === "string" ? asset.source : null;
    if (!downloadUrl) continue;
    const assetId = nanoid();
    const destPath = libraryAssetPath(ownerUserId, assetId, "mp3");
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        log.warn(
          { url: downloadUrl, status: res.status },
          "Pixabay asset download failed",
        );
        continue;
      }
      const buf = await res.arrayBuffer();
      await writeFile(destPath, new Uint8Array(buf));
      const bytesWritten = statSync(destPath).size;
      totalBytes += bytesWritten;
      let durationSec = 0;
      try {
        const probe = await audioService.probeAudio(destPath, dir);
        durationSec = probe.durationSec;
      } catch {
        // keep 0
      }
      try {
        await audioService.generateWaveformFile(destPath, dir);
      } catch (err) {
        log.warn(
          { err, path: destPath },
          "Waveform generation failed for Pixabay asset",
        );
      }
      db.prepare(
        `INSERT INTO reusable_assets (id, owner_user_id, name, tag, audio_path, duration_sec, global_asset, copyright, license, source_url)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(
        assetId,
        ownerUserId,
        name,
        tag,
        destPath,
        durationSec,
        copyright,
        license,
        source,
      );
    } catch (err) {
      log.warn({ err, url: downloadUrl }, "Pixabay asset import failed");
    }

    // Rate limit to avoid overwhelming the server.
    await new Promise((r) => setTimeout(r, 250));
  }
  if (totalBytes > 0) {
    db.prepare(
      `UPDATE users SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ? WHERE id = ?`,
    ).run(totalBytes, ownerUserId);
  }
}
