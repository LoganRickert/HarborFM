import type { FastifyInstance } from "fastify";
import { existsSync, statSync, unlinkSync } from "fs";
import { nanoid } from "nanoid";
import { libraryUpdateSchema } from "@harborfm/shared";
import { drizzleDb } from "../../db/index.js";
import {
  requireAuth,
  requireNotReadOnly,
} from "../../plugins/auth.js";
import { isAdmin, canReadLibraryAsset } from "../../services/access.js";
import { broadcastToUser } from "../../services/episodeBroadcast.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import {
  libraryDir,
  libraryAssetPath,
  assertPathUnder,
  pathRelativeToData,
  resolveDataPath,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import {
  FileTooLargeError,
  streamToFileWithLimit,
  extensionFromAudioMimetype,
} from "../../services/uploads.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { LIBRARY_UPLOAD_MAX_BYTES } from "../../config.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import {
  ALLOWED_MIME,
  libraryWaveformPath,
  sendLibraryWaveform,
  sendLibraryStream,
} from "./utils.js";
import * as repo from "./repo.js";
import { updateSegmentsDurationForReusableAsset } from "../segments/repo.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  app.get(
    "/library",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Library"],
        summary: "List library assets",
        description: "List reusable audio assets (yours and global).",
        response: { 200: { description: "List of assets" } },
      },
    },
    async (request) => {
      const rows = repo.listForUser(request.userId as string);
      return { assets: rows };
    },
  );

  app.post(
    "/library",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Library"],
        summary: "Upload library asset",
        description:
          "Upload audio file (multipart). WAV, MP3, WebM. Max 50MB. Requires read-write access.",
        response: {
          201: { description: "Created asset" },
          400: { description: "No file or invalid type" },
          403: { description: "Storage limit" },
          413: { description: "File too large" },
          500: { description: "Upload or process failed" },
        },
      },
    },
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = data.mimetype || "";
      if (!ALLOWED_MIME.includes(mimetype) && !mimetype.startsWith("audio/")) {
        return reply
          .status(400)
          .send({ error: "Invalid file type. Use WAV, MP3, or WebM." });
      }
      const name =
        (data.fields?.name as { value?: string })?.value?.trim() ||
        data.filename?.replace(/\.[^.]+$/, "") ||
        "Untitled";
      const tag =
        (data.fields?.tag as { value?: string })?.value?.trim() || null;
      const copyright =
        (data.fields?.copyright as { value?: string })?.value?.trim() || null;
      const license =
        (data.fields?.license as { value?: string })?.value?.trim() || null;
      const id = nanoid();
      const ext = extensionFromAudioMimetype(mimetype);
      const destPath = libraryAssetPath(request.userId as string, id, ext);
      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(
          data.file,
          destPath,
          LIBRARY_UPLOAD_MAX_BYTES,
        );
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: "File too large" });
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Upload failed" });
      }

      if (wouldExceedStorageLimit(drizzleDb, request.userId as string, bytesWritten)) {
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

      const dir = libraryDir(request.userId as string);
      let finalPath = destPath;
      try {
        const normalized = await audioService.normalizeUploadToMp3OrWav(
          destPath,
          ext,
          dir,
        );
        finalPath = normalized.path;
        bytesWritten = statSync(finalPath).size;
      } catch (err) {
        request.log.error(err);
        return reply
          .status(500)
          .send({ error: "Failed to process audio file" });
      }

      try {
        await audioService.generateWaveformFile(finalPath, dir);
      } catch (err) {
        request.log.warn(
          { err, finalPath },
          "Waveform generation failed (upload succeeded)",
        );
      }

      let durationSec = 0;
      try {
        const probe = await audioService.probeAudio(finalPath, dir);
        durationSec = probe.durationSec;
      } catch {
        // keep 0
      }

      repo.insertAsset({
        id,
        ownerUserId: request.userId as string,
        name,
        tag: tag ?? null,
        audioPath: pathRelativeToData(finalPath),
        durationSec,
        copyright: copyright ?? null,
        license: license ?? null,
      });
      repo.addUserDiskBytes(request.userId as string, bytesWritten);

      const row = repo.getById(id);
      broadcastToUser(request.userId as string, { type: "libraryAdded" });
      return reply.status(201).send(row as Record<string, unknown>);
    },
  );

  app.patch(
    "/library/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Library"],
        summary: "Update library asset",
        description: "Update asset metadata. Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: { name: { type: "string" }, tag: { type: "string" } },
        },
        response: {
          200: { description: "Updated asset" },
          400: { description: "Validation failed" },
          403: { description: "Cannot edit global asset" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parse = libraryUpdateSchema.safeParse(request.body);
      if (!parse.success) {
        const msg =
          parse.error.issues.map((issue) => issue.message).join("; ") ||
          "Invalid body";
        return reply.status(400).send({ error: msg });
      }
      const body = parse.data;
      const asset = repo.getByIdForMeta(id);
      if (!asset) return reply.status(404).send({ error: "Asset not found" });

      const userIsAdmin = isAdmin(request.userId as string);
      const isOwner = asset.ownerUserId === request.userId;
      if (!isOwner && !userIsAdmin) {
        return reply
          .status(403)
          .send({
            error: "Only the owner or an administrator can edit this asset.",
          });
      }

      const set: Record<string, string | number | boolean | null> = {};
      if (body.name !== undefined) set.name = body.name.trim();
      if (body.tag !== undefined)
        set.tag = body.tag === null ? null : body.tag.trim() || null;
      if (userIsAdmin && body.globalAsset !== undefined)
        set.globalAsset = Boolean(body.globalAsset);
      if (body.copyright !== undefined)
        set.copyright =
          body.copyright === null ? null : body.copyright.trim() || null;
      if (body.license !== undefined)
        set.license =
          body.license === null ? null : body.license.trim() || null;

      if (Object.keys(set).length === 0) {
        return reply.status(400).send({ error: "No fields to update" });
      }

      if (isOwner) {
        repo.updateAssetByIdAndOwner(id, request.userId as string, set);
      } else {
        repo.updateAsset(id, set);
      }

      const row = repo.getById(id);
      return reply.send(row as Record<string, unknown>);
    },
  );

  app.put(
    "/library/:id/audio",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "libraryReplaceAudio",
          windowMs: 60000,
          max: 1,
        }),
      ],
      schema: {
        tags: ["Library"],
        summary: "Replace library asset audio",
        description:
          "Replace the audio file for a library asset. Multipart upload. Rate limited to once per minute per user.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Updated asset" },
          400: { description: "No file or invalid type" },
          403: { description: "Storage limit or not allowed" },
          404: { description: "Not found" },
          429: { description: "Rate limited" },
          500: { description: "Upload or process failed" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Asset not found" });

      const userIsAdmin = isAdmin(request.userId as string);
      const isOwner = row.ownerUserId === request.userId;
      if (!isOwner && !userIsAdmin) {
        return reply.status(403).send({
          error: "Only the owner or an administrator can replace this asset's audio.",
        });
      }

      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = data.mimetype || "";
      if (!ALLOWED_MIME.includes(mimetype) && !mimetype.startsWith("audio/")) {
        return reply
          .status(400)
          .send({ error: "Invalid file type. Use WAV, MP3, or WebM." });
      }

      const ownerId = row.ownerUserId;
      const ext = extensionFromAudioMimetype(mimetype);
      const destPath = libraryAssetPath(ownerId, id, ext);
      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(
          data.file,
          destPath,
          LIBRARY_UPLOAD_MAX_BYTES,
        );
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: "File too large" });
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Upload failed" });
      }

      const oldPath = row.audioPath ? resolveDataPath(row.audioPath) : "";
      let oldBytes = 0;
      if (oldPath && existsSync(oldPath)) {
        try {
          oldBytes = statSync(oldPath).size;
        } catch {
          oldBytes = 0;
        }
      }
      const delta = bytesWritten - oldBytes;
      if (wouldExceedStorageLimit(drizzleDb, ownerId, delta)) {
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

      const dir = libraryDir(ownerId);
      let finalPath = destPath;
      try {
        const normalized = await audioService.normalizeUploadToMp3OrWav(
          destPath,
          ext,
          dir,
        );
        finalPath = normalized.path;
        bytesWritten = statSync(finalPath).size;
      } catch (err) {
        request.log.error(err);
        try {
          unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        return reply
          .status(500)
          .send({ error: "Failed to process audio file" });
      }

      try {
        await audioService.generateWaveformFile(finalPath, dir);
      } catch (err) {
        request.log.warn(
          { err, finalPath },
          "Waveform generation failed (replace succeeded)",
        );
      }

      let durationSec = 0;
      try {
        const probe = await audioService.probeAudio(finalPath, dir);
        durationSec = probe.durationSec;
      } catch {
        // keep 0
      }

      if (oldPath && existsSync(oldPath)) {
        const base = libraryDir(ownerId);
        assertPathUnder(oldPath, base);
        try {
          unlinkSync(oldPath);
        } catch (e) {
          request.log.warn({ err: e, oldPath }, "Could not delete old audio file");
        }
        const oldWaveformPath = libraryWaveformPath(oldPath);
        if (existsSync(oldWaveformPath)) {
          try {
            assertPathUnder(oldWaveformPath, base);
            unlinkSync(oldWaveformPath);
          } catch {
            /* ignore */
          }
        }
      }

      const set: Record<string, string | number> = {
        audioPath: pathRelativeToData(finalPath),
        durationSec,
      };
      if (isOwner) {
        repo.updateAssetByIdAndOwner(id, request.userId as string, set);
      } else {
        repo.updateAsset(id, set);
      }

      if (oldBytes > 0) {
        repo.subtractUserDiskBytes(ownerId, oldBytes);
      }
      repo.addUserDiskBytes(ownerId, bytesWritten);

      updateSegmentsDurationForReusableAsset(id, durationSec);

      const updated = repo.getById(id);
      return reply.send(updated as Record<string, unknown>);
    },
  );

  app.delete(
    "/library/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Library"],
        summary: "Delete library asset",
        description: "Permanently delete an asset. Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          204: { description: "Deleted" },
          403: { description: "Cannot delete global asset" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const userIsAdmin = isAdmin(request.userId as string);
      const isOwner = row.ownerUserId === request.userId;
      if (!isOwner && !userIsAdmin) {
        return reply
          .status(403)
          .send({
            error: "Only the owner or an administrator can delete this asset.",
          });
      }
      const pathRaw = row.audioPath;
      const path = pathRaw ? resolveDataPath(pathRaw) : "";
      const ownerId = row.ownerUserId;
      let bytesFreed = 0;
      if (path && existsSync(path)) {
        const base = libraryDir(ownerId);
        assertPathUnder(path, base);
        try {
          bytesFreed = statSync(path).size;
        } catch {
          bytesFreed = 0;
        }
        unlinkSync(path);
      }
      repo.deleteAsset(id);

      if (bytesFreed > 0) {
        repo.subtractUserDiskBytes(ownerId, bytesFreed);
      }

      return reply.status(204).send();
    },
  );

  app.get(
    "/library/:id/waveform",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Library"],
        summary: "Get asset waveform",
        description: "Returns waveform JSON for a library asset.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Waveform JSON" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!canReadLibraryAsset(request.userId as string, id))
        return reply.status(404).send({ error: "Asset not found" });
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audioPath ? resolveDataPath(row.audioPath) : "";
      if (!path || !existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const base = libraryDir(row.ownerUserId);
      return sendLibraryWaveform(reply, path, base);
    },
  );

  app.get(
    "/library/:id/stream",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Library"],
        summary: "Stream library asset",
        description:
          "Stream audio file for a library asset. Supports range requests.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Audio stream" },
          206: { description: "Partial content" },
          404: { description: "Not found" },
          500: { description: "Send error" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!canReadLibraryAsset(request.userId as string, id))
        return reply.status(404).send({ error: "Asset not found" });
      const row = repo.getById(id);
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audioPath ? resolveDataPath(row.audioPath) : "";
      if (!path || !existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const base = libraryDir(row.ownerUserId);
      const safePath = assertPathUnder(path, base);
      const contentType = contentTypeFromAudioPath(path);
      return sendLibraryStream(request, reply, safePath, contentType);
    },
  );
}
