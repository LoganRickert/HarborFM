import type { FastifyInstance } from "fastify";
import {
  archiveSettingsUpsertSchema,
  archiveSettingsUpdateSchema,
  type ArchiveSettingsUpsert,
} from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  getPodcastRole,
  canEditEpisodeOrPodcastMetadata,
} from "../../services/access.js";
import type { ExportMode } from "../../services/export-config.js";
import { runTest } from "../exports/utils.js";
import {
  archiveSettingsDto,
  buildArchiveConfigEnc,
  getDecryptedArchiveConfig,
  mergeArchiveConfig,
} from "./utils.js";
import * as repo from "./repo.js";

export async function registerArchiveSettingsRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:id/archive-settings",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Archive"],
        summary: "Get archive settings",
        description:
          "Get the single archive destination for a podcast, if configured.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const row = repo.getByPodcastId(podcastId);
      if (!row) {
        return { configured: false, settings: null };
      }
      return { configured: true, settings: archiveSettingsDto(row) };
    },
  );

  app.put(
    "/podcasts/:id/archive-settings",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Archive"],
        summary: "Upsert archive settings",
        description:
          "Create or replace the single archive destination for a podcast.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const existing = repo.getByPodcastId(podcastId);
      const body = request.body as Record<string, unknown>;

      if (existing) {
        const parsed = archiveSettingsUpdateSchema.safeParse(body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
        }
        const data = parsed.data as Record<string, unknown>;
        const set: { name?: string; mode?: string; configEnc?: string } = {};
        if (data.name !== undefined) set.name = data.name as string;
        if (data.mode !== undefined) set.mode = data.mode as string;
        const configKeys = [
          "bucket",
          "prefix",
          "region",
          "endpointUrl",
          "endpoint_url",
          "accessKeyId",
          "access_key_id",
          "secretAccessKey",
          "secret_access_key",
          "host",
          "port",
          "username",
          "password",
          "path",
          "secure",
          "privateKey",
          "private_key",
          "url",
          "apiUrl",
          "api_url",
          "apiKey",
          "api_key",
          "gatewayUrl",
          "gateway_url",
          "share",
          "domain",
        ];
        const hasConfig = configKeys.some((k) => data[k] !== undefined);
        const modeChanged =
          data.mode != null && data.mode !== (existing.mode as string);
        try {
          if (modeChanged && data.mode != null) {
            // Mode change requires a full create payload with credentials
            const full = archiveSettingsUpsertSchema.safeParse(body);
            if (!full.success) {
              return reply.status(400).send({
                error:
                  "When changing destination type, provide full connection details",
                details: full.error.flatten(),
              });
            }
            set.configEnc = buildArchiveConfigEnc(
              data.mode as ExportMode,
              full.data as unknown as Record<string, unknown>,
            );
          } else if (hasConfig) {
            set.configEnc = mergeArchiveConfig(existing, data);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return reply.status(400).send({ error: msg });
        }
        if (
          set.name === undefined &&
          set.mode === undefined &&
          set.configEnc === undefined
        ) {
          return reply.status(400).send({ error: "No fields to update" });
        }
        repo.updateSettings(podcastId, set);
        const row = repo.getByPodcastId(podcastId);
        if (!row) {
          return reply.status(500).send({ error: "Failed to fetch settings" });
        }
        return { configured: true, settings: archiveSettingsDto(row) };
      }

      const parsed = archiveSettingsUpsertSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const data = parsed.data as ArchiveSettingsUpsert;
      const mode = (
        "mode" in data ? (data as { mode: string }).mode : "S3"
      ) as ExportMode;
      const name = (data as { name: string }).name;
      let configEnc: string;
      try {
        configEnc = buildArchiveConfigEnc(
          mode,
          data as unknown as Record<string, unknown>,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(400).send({ error: msg });
      }
      repo.upsertSettings({ podcastId, name, mode, configEnc });
      const row = repo.getByPodcastId(podcastId);
      if (!row) {
        return reply.status(500).send({ error: "Failed to fetch settings" });
      }
      return reply
        .status(201)
        .send({ configured: true, settings: archiveSettingsDto(row) });
    },
  );

  app.delete(
    "/podcasts/:id/archive-settings",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Archive"],
        summary: "Delete archive settings",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      repo.deleteSettings(podcastId);
      return reply.status(204).send();
    },
  );

  app.post(
    "/podcasts/:id/archive-settings/test",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Archive"],
        summary: "Test archive destination",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const row = repo.getByPodcastId(podcastId);
      if (!row) {
        return reply
          .status(400)
          .send({ ok: false, error: "Archive settings not configured" });
      }
      try {
        const { config } = getDecryptedArchiveConfig(row);
        const result = await runTest(row.mode || "S3", config);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(400).send({ ok: false, error: msg });
      }
    },
  );
}
