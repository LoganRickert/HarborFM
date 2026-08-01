import type { FastifyInstance } from "fastify";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  canAccessEpisode,
  canEditSegments,
  getPodcastRole,
  canEditEpisodeOrPodcastMetadata,
} from "../../services/access.js";
import { assertSafeId } from "../../services/paths.js";
import {
  archiveEpisode,
  backupEpisode,
  listEpisodeBackups,
  restoreEpisode,
  restoreEpisodeBackup,
  ArchiveColdStorageError,
} from "./archiveEpisode.js";
import * as episodeRepo from "../episodes/repo.js";
import { episodeRowWithFilename } from "../episodes/utils.js";
import * as archiveRepo from "./repo.js";

export async function registerArchiveEpisodeRoutes(app: FastifyInstance) {
  app.post(
    "/episodes/:id/archive",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Archive"],
        summary: "Archive episode project",
        description:
          "Zip the episode project, upload to the show archive destination, verify, then delete local project files. Feed-serving files are kept.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, id);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      try {
        const result = await archiveEpisode(id);
        const row = episodeRepo.getById(id);
        return {
          ...result,
          episode: row ? episodeRowWithFilename(row) : null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status =
          /not configured|already archived|before archiving/i.test(msg)
            ? 400
            : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  app.post(
    "/episodes/:id/backup",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Archive"],
        summary: "Backup episode project",
        description:
          "Zip the episode project, upload to the show archive destination, and verify. Local project files stay in place; the episode is not marked archived. Pass dated=true to append a timestamp to the zip filename.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            dated: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, id);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const body = (request.body ?? {}) as { dated?: boolean };
      try {
        const result = await backupEpisode(id, { dated: Boolean(body.dated) });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status =
          /not configured|before backing up|Restore the project before backing/i.test(
            msg,
          )
            ? 400
            : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  app.get(
    "/episodes/:id/backups",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Archive"],
        summary: "List episode backups",
        description:
          "List backup zip files for this episode on the show archive destination.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, id);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      try {
        const backups = await listEpisodeBackups(id);
        return { backups };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = /not configured/i.test(msg) ? 400 : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  app.post(
    "/episodes/:id/backups/restore",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Archive"],
        summary: "Restore episode from a backup zip",
        description:
          "Download the selected backup zip and restore project files without overwriting episode metadata. Replaces local segments/uploads.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["filename"],
          additionalProperties: false,
          properties: {
            filename: { type: "string", minLength: 1, maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, id);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const { filename } = request.body as { filename: string };
      try {
        const result = await restoreEpisodeBackup(
          id,
          filename,
          request.userId,
        );
        const row = episodeRepo.getById(id);
        return {
          warning: result.warning ?? null,
          episode: row ? episodeRowWithFilename(row) : null,
        };
      } catch (e) {
        if (e instanceof ArchiveColdStorageError) {
          return reply.status(409).send({
            error: e.message,
            code: e.code,
          });
        }
        const msg = e instanceof Error ? e.message : String(e);
        const status =
          /not configured|not found|Invalid backup|before restoring/i.test(msg)
            ? 400
            : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  app.post(
    "/episodes/:id/restore",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Archive"],
        summary: "Restore archived episode project",
        description:
          "Download the archive zip and restore project files without overwriting episode metadata.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, id);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      try {
        const result = await restoreEpisode(id, request.userId);
        const row = episodeRepo.getById(id);
        return {
          warning: result.warning ?? null,
          episode: row ? episodeRowWithFilename(row) : null,
        };
      } catch (e) {
        if (e instanceof ArchiveColdStorageError) {
          return reply.status(409).send({
            error: e.message,
            code: e.code,
          });
        }
        const msg = e instanceof Error ? e.message : String(e);
        const status =
          /not archived|not configured|Episode not found/i.test(msg)
            ? 400
            : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  app.get(
    "/podcasts/:id/archive-configured",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Archive"],
        summary: "Whether archive settings exist",
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
      return { configured: Boolean(archiveRepo.getByPodcastId(podcastId)) };
    },
  );
}
