import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { join, resolve } from "path";
import { injectSpaMetaHtml } from "@harborfm/shared";
import { resolveSpaMetaForRequest } from "./services/spaMeta.js";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD_HASH,
  API_PREFIX,
  API_KEY_PREFIX,
  APP_NAME,
  CORS_ORIGIN,
  HOST,
  JWT_COOKIE_NAME,
  JWT_COOKIE_SIGNED,
  JWT_SECRET as JWT_SECRET_ENV,
  LOGGER,
  PORT,
  MULTIPART_MAX_BYTES,
  PUBLIC_DIR as CONFIG_PUBLIC_DIR,
  RATE_LIMIT_MAX,
  RATE_LIMIT_TIME_WINDOW,
  SWAGGER_ENABLED,
  SWAGGER_UI_ROUTE_PREFIX,
  SWAGGER_UI_THEME_CSS_FILENAME,
  TRUST_PROXY,
} from "./config.js";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { randomBytes } from "crypto";
import "./db/migrate.js";
import { authPlugin } from "./plugins/auth.js";
import { getRootVersion, healthRoutes } from "./modules/health/index.js";
import { authRoutes } from "./modules/auth/index.js";
import { podcastRoutes } from "./modules/podcasts/index.js";
import { importRoutes } from "./modules/import/index.js";
import { episodeRoutes } from "./modules/episodes/index.js";
import { audioRoutes } from "./modules/audio/index.js";
import { libraryRoutes } from "./modules/library/index.js";
import { segmentRoutes } from "./modules/segments/index.js";
import { showNotesRoutes } from "./modules/showNotes/index.js";
import { episodeFilesRoutes } from "./modules/episodeFiles/index.js";
import { rssRoutes } from "./modules/rss/index.js";
import { exportRoutes } from "./modules/exports/index.js";
import { settingsRoutes } from "./modules/settings/index.js";
import { llmRoutes } from "./modules/llm/index.js";
import { usersRoutes } from "./modules/users/index.js";
import { publicRoutes } from "./modules/public/index.js";
import { setupRoutes } from "./modules/setup/index.js";
import { contactRoutes } from "./modules/contact/index.js";
import { messagesRoutes } from "./modules/messages/index.js";
import { reviewsRoutes } from "./modules/reviews/index.js";
import { pollsRoutes } from "./modules/polls/index.js";
import { sitemapRoutes } from "./modules/sitemap/index.js";
import { registerRobotsRoute } from "./modules/sitemap/routes.robots.js";
import { bansRoutes } from "./modules/bans/index.js";
import { callRoutes } from "./modules/call/index.js";
import { stripeRoutes } from "./modules/stripe/index.js";
import {
  episodeAlertRoutes,
  registerEpisodeAlertPublicRoutes,
  startEpisodeAlertsPoller,
} from "./modules/episodeAlerts/index.js";
import { episodeCollaborationRoutes } from "./modules/episodeCollaboration/index.js";
import { themesRoutes, themePublicRoutes } from "./modules/themes/index.js";
import fastifyWebsocket from "@fastify/websocket";
import {
  flush,
  pruneListenDedup,
  startFlushInterval,
  stopFlushInterval,
} from "./services/podcastStats.js";
import { ensureSecretsDir, getSecretsDir } from "./services/paths.js";
import {
  bootstrapIfNeeded,
  getOrCreateSetupToken,
  isSetupComplete,
} from "./services/setup.js";
import { getSecretsKey } from "./services/secrets.js";
import { SWAGGER_TITLE, SWAGGER_THEME_CSS } from "./swagger-theme.js";

function loadOrCreateJwtSecret(): string {
  const fromEnv = JWT_SECRET_ENV;
  if (fromEnv) return fromEnv;

  ensureSecretsDir();
  const secretPath = join(getSecretsDir(), "jwt-secret.txt");
  if (existsSync(secretPath)) {
    console.warn(
      `[security] JWT_SECRET is not set in the environment. ` +
        `Using the persisted secret. ` +
        `Set JWT_SECRET via env (Docker/PM2) for explicit, manageable deployments.`,
    );
    const existing = readFileSync(secretPath, "utf8").trim();
    // If the file exists but is empty/too short, treat it as invalid and regenerate.
    if (existing.length >= 32) return existing;
  }

  const secret = randomBytes(48).toString("base64url"); // 384-bit secret, URL-safe
  writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
  try {
    chmodSync(secretPath, 0o600);
  } catch {
    // Best-effort: chmod may fail on some FS / platforms.
  }

  console.warn(
    `[security] JWT_SECRET is not set in the environment; generated and persisted a secret. ` +
      `Persist SECRETS_DIR to keep sessions stable across restarts, or (recommended) set JWT_SECRET via env.`,
  );
  return secret;
}

const JWT_SECRET = loadOrCreateJwtSecret();

const APP_VERSION = getRootVersion() ?? "unknown";

async function main() {
  const app = Fastify({
    logger: LOGGER,
    trustProxy: TRUST_PROXY,
  });

  // Validate/init secrets key at startup so missing ENV is visible in logs.
  // (Otherwise we'd only touch it when creating/testing/deploying exports.)
  getSecretsKey();

  const setupComplete = isSetupComplete();
  const adminEmail = ADMIN_EMAIL;
  const adminHash = ADMIN_PASSWORD_HASH;
  const hasEmail = Boolean(adminEmail);
  const hasHash = Boolean(adminHash);
  const hashValid = Boolean(adminHash?.startsWith("$argon2"));
  console.info(
    `[setup] Startup: isSetupComplete=${setupComplete} ADMIN_EMAIL=${hasEmail ? "set" : "unset"} ADMIN_PASSWORD_HASH=${hasHash ? "set" : "unset"} hashStartsWithArgon2=${hashValid}`,
  );
  try {
    bootstrapIfNeeded();
  } catch (err) {
    console.error("[setup] Bootstrap failed:", err);
    throw err;
  }
  if (!isSetupComplete()) {
    const token = getOrCreateSetupToken();
    const path = `/setup?id=${token}`;
    const line = "=".repeat(74);
    console.error(
      `\n${line}\n` +
        `${APP_NAME} SETUP REQUIRED\n\n` +
        `Open this URL to initialize the server (runs once):\n\n` +
        `  ${path}\n\n` +
        `${line}\n`,
    );
  }

  await app.register(cors, {
    origin: CORS_ORIGIN,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_TIME_WINDOW,
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: MULTIPART_MAX_BYTES } });
  await app.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: JWT_COOKIE_NAME, signed: JWT_COOKIE_SIGNED },
  });
  await app.register(authPlugin);
  await app.register(fastifyWebsocket);

  // Console request logging (readable one-line per request)
  app.addHook("onRequest", async (request, _reply) => {
    (request as { _reqStart?: number })._reqStart = Date.now();
  });
  app.addHook("onResponse", async (request, reply) => {
    const start = (request as { _reqStart?: number })._reqStart;
    const ms = start ? (Date.now() - start).toFixed(0) : "?";
    console.log(
      `[server] ${request.method} ${request.url} ${reply.statusCode} ${ms}ms`,
    );
  });

  const apiPrefix = `/${API_PREFIX}`;
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: `${APP_NAME} API`,
        description: `REST API for ${APP_NAME}. Authenticate with an API key from **Profile to API keys** in the app. Use the key as a Bearer token: \`Authorization: Bearer ${API_KEY_PREFIX}your_key_here\`.`,
        version: APP_VERSION,
      },
      servers: [{ url: apiPrefix, description: `${APP_NAME} API base` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API Key",
            description: `Your API key from Profile to API keys (prefix: ${API_KEY_PREFIX})`,
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transformObject(documentObject) {
      const spec =
        "openapiObject" in documentObject
          ? documentObject.openapiObject
          : documentObject.swaggerObject;
      const paths = spec && "paths" in spec ? spec.paths : undefined;
      if (paths) {
        for (const pathMethods of Object.values(paths)) {
          for (const op of Object.values(pathMethods)) {
            const o = op as {
              tags?: string[];
              security?: unknown[];
              responses?: Record<string, { description?: string }>;
            } | undefined;
            if (
              o &&
              typeof o === "object" &&
              (!o.tags || o.tags.length === 0)
            ) {
              o.tags = ["Endpoints"];
            }
          }
        }
        // Add 401/403 to operations that require auth (document-level or operation-level security).
        // Public routes set schema.security: [] so we skip those.
        const isProtected = (op: { security?: unknown[] } | undefined) =>
          op &&
          typeof op === "object" &&
          !(Array.isArray(op.security) && op.security.length === 0);
        for (const pathMethods of Object.values(paths)) {
          for (const op of Object.values(pathMethods)) {
            const o = op as {
              security?: unknown[];
              responses?: Record<string, { description?: string }>;
            } | undefined;
            if (!o || !isProtected(o)) continue;
            if (!o.responses) o.responses = {};
            if (!("401" in o.responses))
              o.responses["401"] = { description: "Unauthorized" };
            if (!("403" in o.responses))
              o.responses["403"] = { description: "Forbidden" };
          }
        }
      }
      return spec;
    },
  });

  if (SWAGGER_ENABLED) {
    await app.register(fastifySwaggerUi, {
      routePrefix: SWAGGER_UI_ROUTE_PREFIX,
      uiConfig: { docExpansion: "list", tryItOutEnabled: true },
      theme: {
        title: SWAGGER_TITLE,
        css: [
          {
            filename: SWAGGER_UI_THEME_CSS_FILENAME,
            content: SWAGGER_THEME_CSS,
          },
        ],
      },
    });
  }

  await app.register(healthRoutes, { prefix: apiPrefix });
  await app.register(authRoutes, { prefix: apiPrefix });
  await app.register(podcastRoutes, { prefix: apiPrefix });
  await app.register(importRoutes, { prefix: apiPrefix });
  await app.register(episodeRoutes, { prefix: apiPrefix });
  await app.register(audioRoutes, { prefix: apiPrefix });
  await app.register(libraryRoutes, { prefix: apiPrefix });
  await app.register(segmentRoutes, { prefix: apiPrefix });
  await app.register(showNotesRoutes, { prefix: apiPrefix });
  await app.register(episodeFilesRoutes, { prefix: apiPrefix });
  await app.register(rssRoutes, { prefix: apiPrefix });
  await app.register(exportRoutes, { prefix: apiPrefix });
  await app.register(settingsRoutes, { prefix: apiPrefix });
  await app.register(llmRoutes, { prefix: apiPrefix });
  await app.register(usersRoutes, { prefix: apiPrefix });
  await app.register(setupRoutes, { prefix: apiPrefix });
  await app.register(contactRoutes, { prefix: apiPrefix });
  await app.register(messagesRoutes, { prefix: apiPrefix });
  await app.register(reviewsRoutes, { prefix: apiPrefix });
  await app.register(pollsRoutes, { prefix: apiPrefix });
  await app.register(publicRoutes, { prefix: apiPrefix });
  await app.register(sitemapRoutes, { prefix: apiPrefix });
  await app.register(bansRoutes, { prefix: apiPrefix });
  await app.register(callRoutes, { prefix: apiPrefix });
  await app.register(stripeRoutes, { prefix: apiPrefix });
  await app.register(episodeAlertRoutes, { prefix: apiPrefix });
  await app.register(registerEpisodeAlertPublicRoutes, { prefix: apiPrefix });
  await app.register(episodeCollaborationRoutes, { prefix: apiPrefix });
  await app.register(themesRoutes, { prefix: apiPrefix });
  await app.register(themePublicRoutes, { prefix: apiPrefix });

  pruneListenDedup();
  startFlushInterval();
  startEpisodeAlertsPoller();
  app.addHook("onClose", async () => {
    stopFlushInterval();
    flush();
  });

  // Host-aware robots.txt (linked/managed domains get their own Sitemap URL).
  // Register before static so it overrides web/public/robots.txt.
  await registerRobotsRoute(app);

  // In production, serve the web app from PUBLIC_DIR (e.g. Docker copies web dist here)
  const publicDir = resolve(CONFIG_PUBLIC_DIR);
  if (existsSync(publicDir)) {
    const sendSpaIndex = (request: FastifyRequest, reply: FastifyReply) => {
      const pathname = request.url.split("?")[0];
      if (pathname === "/login" || pathname === "/login/2fa-setup") {
        reply.header("Cache-Control", "no-store");
      }
      const spaMeta = resolveSpaMetaForRequest(request);
      if (spaMeta) {
        const html = readFileSync(join(publicDir, "index.html"), "utf8");
        reply.type("text/html");
        return reply.send(injectSpaMetaHtml(html, spaMeta));
      }
      return reply.sendFile("index.html");
    };

    // Custom-domain homepages need OG meta injection; register before static so `/` is not auto-served raw index.html.
    app.get("/", (request, reply) => sendSpaIndex(request, reply));

    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
    });

    // SPA fallback: serve index.html for non-API routes that don't match a file (sendFile is added by @fastify/static)
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url === `/${API_PREFIX}` ||
        request.url.startsWith(`/${API_PREFIX}/`)
      ) {
        return reply.status(404).send({ error: "Not found" });
      }
      return sendSpaIndex(request, reply);
    });
  }

  await app.listen({ port: PORT, host: HOST });
  console.log(`Server listening on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
