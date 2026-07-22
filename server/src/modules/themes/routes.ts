import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, statSync } from "fs";
import {
  FEED_THEME_ZIP_MAX_BYTES,
  feedThemePatchSchema,
  feedThemeScopeBodySchema,
  themeCatalogDestinationCreateBodySchema,
  themeCatalogInstallBodySchema,
} from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  THEME_CATALOG_RATE_LIMIT_MAX,
  THEME_CATALOG_RATE_LIMIT_WINDOW_MS,
  THEME_DOWNLOAD_RATE_LIMIT_MAX,
  THEME_DOWNLOAD_RATE_LIMIT_WINDOW_MS,
  THEME_IMPORT_RATE_LIMIT_MAX,
  THEME_IMPORT_RATE_LIMIT_WINDOW_MS,
} from "../../config.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { getUserCanImportTheme } from "./canImportTheme.js";
import { isServerWideThemeId, listBuiltinThemes, listDiskBuiltinThemes } from "./builtins.js";
import {
  addDestinationFromUrl,
  browseDestinationCatalog,
  deleteDestination,
  installThemeFromCatalog,
  listDestinationsForApi,
  updateServerThemeFromCatalog,
} from "./catalogInstall.js";
import { deleteThemeForUser, importThemeZip, ThemeImportError } from "./importTheme.js";
import {
  createEmptyThemeFile,
  deleteServerTheme,
  deleteThemeFile,
  getThemeDetail,
  readThemeTextFile,
  resolveThemeAccess,
  setThemeScope,
  patchThemeMetadata,
  writeThemeBinaryFile,
  writeThemeTextFile,
} from "./themeFiles.js";
import {
  getOrBuildServerThemeZip,
  getOrBuildUserThemeZip,
} from "./themeZip.js";
import { userThemeDirPath } from "./paths.js";
import { readThemeManifest } from "./themePages.js";
import * as repo from "./repo.js";

/** Cap theme zip downloads (defaults 2/min; configurable via env). */
const THEME_DOWNLOAD_RATE_LIMIT = {
  bucket: "theme-download",
  windowMs: THEME_DOWNLOAD_RATE_LIMIT_WINDOW_MS,
  max: THEME_DOWNLOAD_RATE_LIMIT_MAX,
};

/** Cap theme ZIP imports (defaults 2/min; e2e shortens the window via env). */
const THEME_IMPORT_RATE_LIMIT = {
  bucket: "theme-import",
  windowMs: THEME_IMPORT_RATE_LIMIT_WINDOW_MS,
  max: THEME_IMPORT_RATE_LIMIT_MAX,
};

/** Cap catalog fetches / browses (defaults 10/min; configurable via env). */
const THEME_CATALOG_RATE_LIMIT = {
  bucket: "theme-catalog",
  windowMs: THEME_CATALOG_RATE_LIMIT_WINDOW_MS,
  max: THEME_CATALOG_RATE_LIMIT_MAX,
};

const THEME_FILE_MAX_BYTES = 2 * 1024 * 1024;

function isAdminUser(userId: string): boolean {
  const row = drizzleDb
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.role === "admin";
}

function requireAdmin(userId: string): void {
  if (!isAdminUser(userId)) {
    throw new ThemeImportError("Admin access required", 403);
  }
}

async function readMultipartZip(
  request: { file: () => Promise<{ file: NodeJS.ReadableStream; filename: string } | undefined> },
): Promise<Buffer> {
  const part = await request.file();
  if (!part) {
    throw new ThemeImportError("Zip file is required");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of part.file) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > FEED_THEME_ZIP_MAX_BYTES) {
      part.file.resume();
      throw new ThemeImportError(
        `Theme zip must be at most ${FEED_THEME_ZIP_MAX_BYTES / (1024 * 1024)} MB`,
        413,
      );
    }
    chunks.push(buf);
  }
  const name = (part.filename || "").toLowerCase();
  if (name && !name.endsWith(".zip")) {
    throw new ThemeImportError("File must be a .zip");
  }
  return Buffer.concat(chunks);
}

async function readMultipartBuffer(
  request: {
    file: () => Promise<
      | {
          file: NodeJS.ReadableStream;
          filename: string;
          fields?: Record<string, { value?: unknown } | unknown>;
          toBuffer: () => Promise<Buffer>;
        }
      | undefined
    >;
  },
): Promise<{ buffer: Buffer; pathFromField: string | null }> {
  const part = await request.file();
  if (!part) {
    throw new ThemeImportError("File is required");
  }
  let pathFromField: string | null = null;
  const fields = part.fields as Record<string, { value?: unknown }> | undefined;
  const pathField = fields?.path;
  if (pathField && typeof pathField === "object" && "value" in pathField) {
    pathFromField = String(pathField.value ?? "") || null;
  }
  const buffer = await part.toBuffer();
  if (buffer.byteLength > THEME_FILE_MAX_BYTES) {
    throw new ThemeImportError(
      `Theme file must be at most ${THEME_FILE_MAX_BYTES / (1024 * 1024)} MB`,
      413,
    );
  }
  return { buffer, pathFromField };
}

function requireThemeImport(userId: string): void {
  if (!getUserCanImportTheme(userId)) {
    throw new ThemeImportError("Theme import is not enabled for this account", 403);
  }
}

function sendThemeError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, err: unknown) {
  if (err instanceof ThemeImportError) {
    return reply.status(err.statusCode).send({ error: err.message });
  }
  throw err;
}

export async function themesRoutes(app: FastifyInstance) {
  app.get(
    "/themes",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Themes"],
        summary: "List imported feed themes for the current user",
      },
    },
    async (request) => {
      const userId = request.userId as string;
      const themes = repo.listThemesForUser(userId).map((t) => {
        const description =
          readThemeManifest(userThemeDirPath(userId, t.id))?.description?.trim() ?? "";
        return {
          id: t.id,
          packageId: t.packageId,
          name: t.name,
          version: t.version,
          description,
          byteSize: t.byteSize,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        };
      });
      return { themes };
    },
  );

  app.get(
    "/themes/builtins",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Themes"],
        summary: "List built-in feed themes available to download",
      },
    },
    async () => ({ builtins: listBuiltinThemes() }),
  );

  app.get(
    "/themes/destinations",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Themes"],
        summary: "List theme catalog destinations for this instance",
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        return listDestinationsForApi();
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.post(
    "/themes/destinations",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler(THEME_CATALOG_RATE_LIMIT),
      ],
      schema: {
        tags: ["Themes"],
        summary: "Add a theme catalog destination (admin)",
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        requireAdmin(userId);
        const body = themeCatalogDestinationCreateBodySchema.parse(request.body);
        const destination = await addDestinationFromUrl({
          name: body.name,
          url: body.url,
        });
        return reply.status(201).send({ destination });
      } catch (err) {
        if (err instanceof ThemeImportError) {
          return sendThemeError(reply, err);
        }
        if (err instanceof Error && "issues" in err) {
          return reply.status(400).send({ error: "Invalid request body" });
        }
        if (err instanceof Error) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/themes/destinations/:destinationId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Remove a theme catalog destination (admin)",
        params: {
          type: "object",
          required: ["destinationId"],
          properties: { destinationId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        requireAdmin(userId);
        const { destinationId } = request.params as { destinationId: string };
        deleteDestination(destinationId);
        return reply.status(204).send();
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.get(
    "/themes/destinations/:destinationId/catalog",
    {
      preHandler: [
        requireAuth,
        userRateLimitPreHandler(THEME_CATALOG_RATE_LIMIT),
      ],
      schema: {
        tags: ["Themes"],
        summary: "Fetch a destination catalog via the server (SSRF-safe proxy)",
        params: {
          type: "object",
          required: ["destinationId"],
          properties: { destinationId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const { destinationId } = request.params as { destinationId: string };
        return await browseDestinationCatalog(destinationId);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.post(
    "/themes/catalog/install",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler(THEME_IMPORT_RATE_LIMIT),
      ],
      schema: {
        tags: ["Themes"],
        summary: "Install a theme from a catalog destination",
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const body = themeCatalogInstallBodySchema.parse(request.body);
        if (body.scope === "server") {
          requireAdmin(userId);
        }
        const result = await installThemeFromCatalog(userId, body);
        return reply.status(result.updated ? 200 : 201).send(result);
      } catch (err) {
        if (err instanceof ThemeImportError) {
          return sendThemeError(reply, err);
        }
        if (err instanceof Error && "issues" in err) {
          return reply.status(400).send({ error: "Invalid request body" });
        }
        throw err;
      }
    },
  );

  app.post(
    "/themes/builtins/:builtinId/update",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler(THEME_IMPORT_RATE_LIMIT),
      ],
      schema: {
        tags: ["Themes"],
        summary: "Update a server theme from its catalog URL (admin)",
        params: {
          type: "object",
          required: ["builtinId"],
          properties: { builtinId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        requireAdmin(userId);
        const { builtinId } = request.params as { builtinId: string };
        const result = await updateServerThemeFromCatalog(userId, builtinId);
        return result;
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.get(
    "/themes/builtins/:builtinId/download",
    {
      preHandler: [
        requireAuth,
        userRateLimitPreHandler(THEME_DOWNLOAD_RATE_LIMIT),
      ],
      schema: {
        tags: ["Themes"],
        summary: "Download a built-in theme as a zip",
        description:
          "Rate limited per user (THEME_DOWNLOAD_RATE_LIMIT_MAX / THEME_DOWNLOAD_RATE_LIMIT_WINDOW_MS).",
        params: {
          type: "object",
          required: ["builtinId"],
          properties: { builtinId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      if (!getUserCanImportTheme(userId)) {
        return reply.status(403).send({
          error: "Theme import is not enabled for this account",
        });
      }
      const { builtinId } = request.params as { builtinId: string };
      if (
        !isServerWideThemeId(builtinId) &&
        !listDiskBuiltinThemes().some((t) => t.id === builtinId)
      ) {
        return reply.status(404).send({ error: "Built-in theme not found" });
      }
      try {
        const { zipPath, filename } = getOrBuildServerThemeZip(builtinId);
        if (!existsSync(zipPath)) {
          return reply.status(500).send({ error: "Failed to build theme zip" });
        }
        const size = statSync(zipPath).size;
        return reply
          .header("Content-Type", "application/zip")
          .header("Content-Disposition", `attachment; filename="${filename}"`)
          .header("Content-Length", size)
          .send(createReadStream(zipPath));
      } catch {
        return reply.status(404).send({ error: "Built-in theme not found" });
      }
    },
  );

  app.delete(
    "/themes/builtins/:builtinId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Delete a server-wide theme (admin)",
        params: {
          type: "object",
          required: ["builtinId"],
          properties: { builtinId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        deleteServerTheme(userId, (request.params as { builtinId: string }).builtinId);
        return reply.status(204).send();
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.get(
    "/themes/:themeId/download",
    {
      preHandler: [
        requireAuth,
        userRateLimitPreHandler(THEME_DOWNLOAD_RATE_LIMIT),
      ],
      schema: {
        tags: ["Themes"],
        summary: "Download one of your imported themes as a zip",
        description:
          "Rate limited per user (THEME_DOWNLOAD_RATE_LIMIT_MAX / THEME_DOWNLOAD_RATE_LIMIT_WINDOW_MS).",
        params: {
          type: "object",
          required: ["themeId"],
          properties: { themeId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      if (!getUserCanImportTheme(userId)) {
        return reply.status(403).send({
          error: "Theme import is not enabled for this account",
        });
      }
      const { themeId } = request.params as { themeId: string };
      try {
        const { zipPath, filename } = getOrBuildUserThemeZip(userId, themeId);
        if (!existsSync(zipPath)) {
          return reply.status(500).send({ error: "Failed to build theme zip" });
        }
        const size = statSync(zipPath).size;
        return reply
          .header("Content-Type", "application/zip")
          .header("Content-Disposition", `attachment; filename="${filename}"`)
          .header("Content-Length", size)
          .send(createReadStream(zipPath));
      } catch {
        return reply.status(404).send({ error: "Theme not found" });
      }
    },
  );

  app.get(
    "/themes/:themeId",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Themes"],
        summary: "Get theme metadata and file list for the editor",
        params: {
          type: "object",
          required: ["themeId"],
          properties: { themeId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const access = resolveThemeAccess(userId, (request.params as { themeId: string }).themeId);
        return getThemeDetail(access);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.patch(
    "/themes/:themeId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Update theme metadata (name, version, index, pages)",
        params: {
          type: "object",
          required: ["themeId"],
          properties: { themeId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const parsed = feedThemePatchSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: parsed.error.issues[0]?.message ?? "Invalid body",
          });
        }
        const access = resolveThemeAccess(userId, (request.params as { themeId: string }).themeId);
        patchThemeMetadata(access, parsed.data);
        return getThemeDetail(access);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.post(
    "/themes/:themeId/scope",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Promote or demote theme scope (admin)",
        params: {
          type: "object",
          required: ["themeId"],
          properties: { themeId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const parsed = feedThemeScopeBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: parsed.error.issues[0]?.message ?? "Invalid body",
          });
        }
        const result = setThemeScope(
          userId,
          (request.params as { themeId: string }).themeId,
          parsed.data.scope,
        );
        return result;
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.post(
    "/themes/:themeId/files/new",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Create an empty template or CSS file",
        params: {
          type: "object",
          required: ["themeId"],
          properties: { themeId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const body = request.body as { path?: string };
        if (!body?.path || typeof body.path !== "string") {
          return reply.status(400).send({ error: "path is required" });
        }
        const access = resolveThemeAccess(userId, (request.params as { themeId: string }).themeId);
        createEmptyThemeFile(access, body.path);
        return getThemeDetail(access);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.post(
    "/themes/:themeId/files",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Upload or replace a theme file (multipart)",
        consumes: ["multipart/form-data"],
        params: {
          type: "object",
          required: ["themeId"],
          properties: { themeId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const access = resolveThemeAccess(userId, (request.params as { themeId: string }).themeId);
        const { buffer, pathFromField } = await readMultipartBuffer(request);
        const queryPath =
          typeof (request.query as { path?: string })?.path === "string"
            ? (request.query as { path: string }).path
            : null;
        const rel = pathFromField || queryPath;
        if (!rel) {
          return reply.status(400).send({ error: "path is required (form field or query)" });
        }
        writeThemeBinaryFile(access, rel, buffer);
        return getThemeDetail(access);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.get(
    "/themes/:themeId/files/*",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Themes"],
        summary: "Read a theme text file",
        hide: true,
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const access = resolveThemeAccess(userId, (request.params as { themeId: string }).themeId);
        const rel = (request.params as { "*": string })["*"] || "";
        const content = readThemeTextFile(access, rel);
        return reply
          .header("Content-Type", "text/plain; charset=utf-8")
          .send(content);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.put(
    "/themes/:themeId/files/*",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Write a theme text file",
        hide: true,
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const access = resolveThemeAccess(userId, (request.params as { themeId: string }).themeId);
        const rel = (request.params as { "*": string })["*"] || "";
        const body = request.body as { content?: string } | string;
        const content =
          typeof body === "string"
            ? body
            : typeof body?.content === "string"
              ? body.content
              : null;
        if (content === null) {
          return reply.status(400).send({ error: "content is required" });
        }
        if (Buffer.byteLength(content, "utf8") > THEME_FILE_MAX_BYTES) {
          return reply.status(413).send({
            error: `Theme file must be at most ${THEME_FILE_MAX_BYTES / (1024 * 1024)} MB`,
          });
        }
        writeThemeTextFile(access, rel, content);
        return getThemeDetail(access);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.delete(
    "/themes/:themeId/files/*",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Delete an optional theme file",
        hide: true,
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      try {
        requireThemeImport(userId);
        const access = resolveThemeAccess(userId, (request.params as { themeId: string }).themeId);
        const rel = (request.params as { "*": string })["*"] || "";
        deleteThemeFile(access, rel);
        return getThemeDetail(access);
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );

  app.post(
    "/themes/import",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler(THEME_IMPORT_RATE_LIMIT),
      ],
      schema: {
        tags: ["Themes"],
        summary: "Import or update a feed theme zip",
        consumes: ["multipart/form-data"],
      },
    },
    async (request, reply) => {
      const userId = request.userId as string;
      if (!getUserCanImportTheme(userId)) {
        return reply.status(403).send({
          error: "Theme import is not enabled for this account",
        });
      }
      try {
        const buf = await readMultipartZip(request);
        const result = importThemeZip(userId, buf);
        return reply.status(result.updated ? 200 : 201).send(result);
      } catch (err) {
        if (err instanceof ThemeImportError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/themes/:themeId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Themes"],
        summary: "Delete an imported feed theme (or server theme as admin)",
        params: {
          type: "object",
          required: ["themeId"],
          properties: { themeId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { themeId } = request.params as { themeId: string };
      const userId = request.userId as string;
      try {
        const row = repo.getThemeById(themeId);
        if (row?.scope === "server") {
          requireThemeImport(userId);
          deleteServerTheme(userId, themeId);
          return reply.status(204).send();
        }
        deleteThemeForUser(userId, themeId);
        return reply.status(204).send();
      } catch (err) {
        return sendThemeError(reply, err);
      }
    },
  );
}
