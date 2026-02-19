import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { getPodcastRole, canEditEpisodeOrPodcastMetadata } from "../../services/access.js";
import { getDecryptedConfigFromEnc } from "../../services/export-config.js";
import { buildConfigEnc, mergeAndEncryptConfig, type ExportMode } from "../../services/export-config.js";
import {
  exportCreateSchema,
  exportUpdateSchema,
  type ExportCreate,
} from "@harborfm/shared";
import { exportDto, getExport, runTest } from "./utils.js";
import * as repo from "./repo.js";
import { sqlNow } from "../../db/utils.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  app.post(
    "/podcasts/:id/exports",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Exports"],
        summary: "Create export",
        description:
          "Add a delivery destination (S3, FTP, SFTP, WebDAV, IPFS, SMB) for a podcast.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          description: "Export config (mode, name, credentials)",
        },
        response: {
          201: { description: "Created export" },
          400: { description: "Validation failed" },
          404: { description: "Podcast not found" },
          500: { description: "Failed to fetch created export" },
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const parsed = exportCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const expId = nanoid();
      const data = parsed.data as ExportCreate;
      const mode = (
        "mode" in data ? (data as { mode: string }).mode : "S3"
      ) as ExportMode;
      const name = (data as { name: string }).name;
      const publicBaseUrl: string | null =
        ((data as Record<string, unknown>).public_base_url ?? null) as string | null;
      const configEnc: string = buildConfigEnc(
        mode,
        data as unknown as Record<string, unknown>,
      );

      repo.insertExport({
        id: expId,
        podcastId,
        name,
        publicBaseUrl,
        mode,
        configEnc,
      });
      const row = repo.getById(expId);
      if (!row)
        return reply.status(500).send({ error: "Failed to fetch created export" });
      return reply.status(201).send(exportDto(row));
    },
  );

  app.get(
    "/podcasts/:id/exports",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Exports"],
        summary: "List exports",
        description: "List delivery destinations for a podcast.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "List of exports" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const rows = repo.listByPodcastId(podcastId);
      return { exports: rows.map((r) => exportDto(r)) };
    },
  );

  app.delete(
    "/exports/:exportId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Exports"],
        summary: "Delete export",
        description: "Remove a delivery destination.",
        params: {
          type: "object",
          properties: { exportId: { type: "string" } },
          required: ["exportId"],
        },
        response: {
          204: { description: "Deleted" },
          404: { description: "Export not found" },
        },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: "Export not found" });
      repo.deleteExport(exportId);
      return reply.status(204).send();
    },
  );

  app.patch(
    "/exports/:exportId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Exports"],
        summary: "Update export",
        description: "Update export config or credentials.",
        params: {
          type: "object",
          properties: { exportId: { type: "string" } },
          required: ["exportId"],
        },
        body: { type: "object", description: "Partial export config" },
        response: {
          200: { description: "Updated export" },
          400: { description: "Validation failed" },
          404: { description: "Export not found" },
          500: { description: "Failed to fetch updated export" },
        },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: "Export not found" });

      const parsed = exportUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const data = parsed.data as Record<string, unknown>;

      const wantsAccessKey = data.access_key_id !== undefined;
      const wantsSecretKey = data.secret_access_key !== undefined;
      if (wantsAccessKey !== wantsSecretKey) {
        return reply
          .status(400)
          .send({
            error:
              "Provide both access_key_id and secret_access_key when updating credentials",
          });
      }

      const configKeys = [
        "bucket",
        "prefix",
        "region",
        "endpoint_url",
        "access_key_id",
        "secret_access_key",
        "host",
        "port",
        "username",
        "password",
        "path",
        "secure",
        "private_key",
        "url",
        "api_url",
        "api_key",
        "gateway_url",
        "share",
        "domain",
      ];
      const hasConfigUpdate = configKeys.some((k) => data[k] !== undefined);
      const newMode = data.mode as string | undefined;
      const modeChanged = newMode != null && newMode !== (exp.mode as string);

      const set: Record<string, unknown> = {
        updatedAt: sqlNow(),
      };
      if (data.name !== undefined) set.name = data.name;
      if (data.public_base_url !== undefined)
        set.publicBaseUrl = data.public_base_url;
      if (newMode !== undefined) set.mode = newMode;
      if (modeChanged && newMode != null) {
        try {
          set.configEnc = buildConfigEnc(newMode as ExportMode, data);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return reply.status(400).send({ error: msg });
        }
      } else if (hasConfigUpdate) {
        try {
          set.configEnc = mergeAndEncryptConfig(exp, data);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return reply.status(400).send({ error: msg });
        }
      }

      const hasAny =
        data.name !== undefined ||
        data.public_base_url !== undefined ||
        newMode !== undefined ||
        hasConfigUpdate;
      if (!hasAny) {
        return reply.status(400).send({ error: "No fields to update" });
      }

      repo.updateExport(exportId, set);

      const row = repo.getById(exportId);
      if (!row)
        return reply.status(500).send({ error: "Failed to fetch updated export" });
      return reply.send(exportDto(row));
    },
  );

  app.post(
    "/exports/:exportId/test",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Exports"],
        summary: "Test export connection",
        description: "Verify credentials and connectivity for a destination.",
        params: {
          type: "object",
          properties: { exportId: { type: "string" } },
          required: ["exportId"],
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Test failed" },
          404: { description: "Export not found" },
        },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: "Export not found" });
      const mode = (exp.mode as string) || "S3";
      try {
        const { config } = getDecryptedConfigFromEnc(exp);
        const result = await runTest(mode, config);
        if (!result.ok && result.error) {
          request.log.warn(
            { exportId, mode, error: result.error },
            "Export test failed",
          );
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(400).send({ ok: false, error: msg });
      }
    },
  );
}
