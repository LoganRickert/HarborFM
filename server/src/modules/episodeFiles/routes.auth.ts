import type { FastifyInstance } from "fastify";
import {
  createReadStream,
  existsSync,
  openSync,
  readSync,
  closeSync,
  unlinkSync,
} from "fs";
import { finished } from "node:stream/promises";
import { nanoid } from "nanoid";
import {
  episodeFilesCreateLinkBodySchema,
  episodeFilesEpisodeIdParamSchema,
  episodeFilesItemIdParamSchema,
  episodeFilesReorderBodySchema,
  episodeFilesUpdateBodySchema,
} from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  canAccessEpisode,
  canEditEpisodeOrPodcastMetadata,
} from "../../services/access.js";
import { drizzleDb } from "../../db/drizzle.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  assertSafeId,
  episodeFilePath,
  episodeFilesDir,
} from "../../services/paths.js";
import { FileTooLargeError, streamToFileWithLimit } from "../../services/uploads.js";
import { API_PREFIX } from "../../config.js";
import {
  EPISODE_FILE_MAX_BYTES,
  EPISODE_FILE_UNSUPPORTED_TYPE_MESSAGE,
  EPISODE_FILES_MAX_PER_EPISODE,
  extForKind,
  extensionFromFilename,
  kindFromExtension,
  mimeForKind,
  validateEpisodeFileMagic,
} from "../../utils/episodeFileMagic.js";
import { getUserCanUploadEpisodeFiles } from "./canUploadEpisodeFiles.js";
import * as repo from "./repo.js";

/** Drain an unused multipart file so the client can read the error response. */
async function discardMultipartFile(stream: NodeJS.ReadableStream): Promise<void> {
  stream.resume();
  try {
    await finished(stream);
  } catch {
    /* ignore truncated/aborted uploads */
  }
}

function studioDownloadUrl(episodeId: string, fileId: string): string {
  return `/${API_PREFIX}/episodes/${encodeURIComponent(episodeId)}/files/${encodeURIComponent(fileId)}/download`;
}

function requireCanUpload(userId: string, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) {
  if (!getUserCanUploadEpisodeFiles(userId)) {
    reply.status(403).send({ error: "Episode Files are not enabled for this account" });
    return false;
  }
  return true;
}

export async function registerEpisodeFilesAuthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/episodes/:id/files",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episode Files"],
        summary: "List episode files",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const parsed = episodeFilesEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      const items = repo.listEpisodeFiles(episodeId).map((row) =>
        repo.toDto(
          row,
          row.kind === "file" ? studioDownloadUrl(episodeId, row.id) : null,
        ),
      );
      return { items };
    },
  );

  app.post(
    "/episodes/:id/files/upload",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Files"],
        summary: "Upload an episode file",
        description:
          "Multipart upload: file + optional title + description. Max 50MB. Counts against owner storage.",
      },
    },
    async (request, reply) => {
      if (!requireCanUpload(request.userId, reply)) return;
      const parsed = episodeFilesEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = parsed.data;
      try {
        assertSafeId(episodeId, "id");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      if (repo.countEpisodeFiles(episodeId) >= EPISODE_FILES_MAX_PER_EPISODE) {
        return reply.status(400).send({
          error: `Maximum of ${EPISODE_FILES_MAX_PER_EPISODE} episode files reached`,
        });
      }

      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });

      const ext = extensionFromFilename(data.filename || "");
      const kind = kindFromExtension(ext);
      if (!kind) {
        await discardMultipartFile(data.file);
        return reply.status(400).send({
          error: EPISODE_FILE_UNSUPPORTED_TYPE_MESSAGE,
        });
      }

      const titleField = (data.fields?.title as { value?: string } | undefined)
        ?.value;
      const descField = (
        data.fields?.description as { value?: string } | undefined
      )?.value;
      const title =
        (typeof titleField === "string" && titleField.trim()) ||
        (data.filename || "Untitled").replace(/\.[^.]+$/, "") ||
        "Untitled";
      const description =
        typeof descField === "string" && descField.trim()
          ? descField.trim().slice(0, 2000)
          : null;

      const podcastMeta = repo.getEpisodePodcastId(episodeId);
      if (!podcastMeta) {
        await discardMultipartFile(data.file);
        return reply.status(404).send({ error: "Episode not found" });
      }
      const podcastId = podcastMeta.podcastId;
      const ownerId = repo.getOwnerUserIdForEpisode(episodeId);
      if (!ownerId) {
        await discardMultipartFile(data.file);
        return reply.status(404).send({ error: "Episode not found" });
      }

      const storageName = `${nanoid()}.${extForKind(kind)}`;
      const dir = episodeFilesDir(podcastId, episodeId);
      const destPath = episodeFilePath(podcastId, episodeId, storageName);
      assertResolvedPathUnder(destPath, dir);

      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(
          data.file,
          destPath,
          EPISODE_FILE_MAX_BYTES,
        );
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(413).send({ error: "File too large (max 50MB)" });
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Upload failed" });
      }

      const headLen = Math.min(bytesWritten, 65536);
      const head = Buffer.alloc(headLen);
      const fd = openSync(destPath, "r");
      try {
        readSync(fd, head, 0, headLen, 0);
      } finally {
        closeSync(fd);
      }
      const magicErr = validateEpisodeFileMagic(kind, head);
      if (magicErr) {
        try {
          unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        return reply.status(400).send({ error: magicErr });
      }

      if (wouldExceedStorageLimit(drizzleDb, ownerId, bytesWritten)) {
        try {
          unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        return reply.status(403).send({
          error:
            "You have reached your storage limit. Delete some content to free space.",
        });
      }

      const row = repo.insertFileItem({
        episodeId,
        title: title.slice(0, 200),
        description,
        storageName,
        mimeType: mimeForKind(kind),
        byteSize: bytesWritten,
        originalFilename: (data.filename || storageName).slice(0, 255),
      });
      repo.addUserDiskBytes(ownerId, bytesWritten);

      return reply.status(201).send(
        repo.toDto(row, studioDownloadUrl(episodeId, row.id)),
      );
    },
  );

  app.post(
    "/episodes/:id/files/link",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Files"],
        summary: "Add an episode file link",
      },
    },
    async (request, reply) => {
      if (!requireCanUpload(request.userId, reply)) return;
      const paramsParsed = episodeFilesEpisodeIdParamSchema.safeParse(
        request.params,
      );
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = episodeFilesCreateLinkBodySchema.safeParse(
        request.body,
      );
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      if (repo.countEpisodeFiles(episodeId) >= EPISODE_FILES_MAX_PER_EPISODE) {
        return reply.status(400).send({
          error: `Maximum of ${EPISODE_FILES_MAX_PER_EPISODE} episode files reached`,
        });
      }
      const row = repo.insertLinkItem({
        episodeId,
        title: bodyParsed.data.title,
        description: bodyParsed.data.description ?? null,
        url: bodyParsed.data.url,
      });
      return reply.status(201).send(repo.toDto(row, null));
    },
  );

  app.patch(
    "/episodes/:id/files/:fileId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Files"],
        summary: "Update episode file title/description/url",
      },
    },
    async (request, reply) => {
      if (!requireCanUpload(request.userId, reply)) return;
      const paramsParsed = episodeFilesItemIdParamSchema.safeParse(
        request.params,
      );
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = episodeFilesUpdateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId, fileId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const existing = repo.getEpisodeFile(episodeId, fileId);
      if (!existing) return reply.status(404).send({ error: "File not found" });
      if (bodyParsed.data.url !== undefined && existing.kind !== "link") {
        return reply.status(400).send({
          error: "URL can only be updated for link items",
        });
      }
      const row = repo.updateEpisodeFile(episodeId, fileId, bodyParsed.data);
      if (!row) return reply.status(404).send({ error: "File not found" });
      return repo.toDto(
        row,
        row.kind === "file" ? studioDownloadUrl(episodeId, row.id) : null,
      );
    },
  );

  app.put(
    "/episodes/:id/files/reorder",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Files"],
        summary: "Reorder episode files",
      },
    },
    async (request, reply) => {
      if (!requireCanUpload(request.userId, reply)) return;
      const paramsParsed = episodeFilesEpisodeIdParamSchema.safeParse(
        request.params,
      );
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = episodeFilesReorderBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      try {
        repo.reorderEpisodeFiles(episodeId, bodyParsed.data.itemIds);
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Reorder failed",
        });
      }
      const items = repo.listEpisodeFiles(episodeId).map((row) =>
        repo.toDto(
          row,
          row.kind === "file" ? studioDownloadUrl(episodeId, row.id) : null,
        ),
      );
      return { items };
    },
  );

  app.delete(
    "/episodes/:id/files/:fileId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Files"],
        summary: "Delete an episode file",
      },
    },
    async (request, reply) => {
      if (!requireCanUpload(request.userId, reply)) return;
      const paramsParsed = episodeFilesItemIdParamSchema.safeParse(
        request.params,
      );
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId, fileId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const podcastMeta = repo.getEpisodePodcastId(episodeId);
      if (!podcastMeta)
        return reply.status(404).send({ error: "Episode not found" });
      const deleted = repo.deleteEpisodeFile(episodeId, fileId);
      if (!deleted) return reply.status(404).send({ error: "File not found" });

      if (deleted.kind === "file" && deleted.storageName && deleted.byteSize) {
        const ownerId = repo.getOwnerUserIdForEpisode(episodeId);
        const path = episodeFilePath(
          podcastMeta.podcastId,
          episodeId,
          deleted.storageName,
        );
        try {
          if (existsSync(path)) {
            assertPathUnder(path, episodeFilesDir(podcastMeta.podcastId, episodeId));
            unlinkSync(path);
          }
        } catch {
          /* best-effort */
        }
        if (ownerId) repo.subtractUserDiskBytes(ownerId, deleted.byteSize);
      }
      return reply.status(204).send();
    },
  );

  app.get(
    "/episodes/:id/files/:fileId/download",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episode Files"],
        summary: "Download an episode file (studio)",
      },
    },
    async (request, reply) => {
      const paramsParsed = episodeFilesItemIdParamSchema.safeParse(
        request.params,
      );
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId, fileId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      const row = repo.getEpisodeFile(episodeId, fileId);
      if (!row || row.kind !== "file" || !row.storageName) {
        return reply.status(404).send({ error: "File not found" });
      }
      const podcastMeta = repo.getEpisodePodcastId(episodeId);
      if (!podcastMeta)
        return reply.status(404).send({ error: "Episode not found" });
      const path = episodeFilePath(
        podcastMeta.podcastId,
        episodeId,
        row.storageName,
      );
      try {
        assertPathUnder(path, episodeFilesDir(podcastMeta.podcastId, episodeId));
      } catch {
        return reply.status(404).send({ error: "File not found" });
      }
      if (!existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const filename = row.originalFilename || row.storageName;
      reply.header(
        "Content-Type",
        row.mimeType || "application/octet-stream",
      );
      reply.header(
        "Content-Disposition",
        `inline; filename="${filename.replace(/"/g, "")}"`,
      );
      return reply.send(createReadStream(path));
    },
  );
}
