import type { FastifyInstance } from "fastify";
import { existsSync, statSync, unlinkSync } from "fs";
import { libraryUpdateSchema } from "@harborfm/shared";
import { requireAdmin } from "../../plugins/auth.js";
import {
  libraryDir,
  assertPathUnder,
  resolveDataPath,
} from "../../services/paths.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import { sendLibraryWaveform, sendLibraryStream } from "./utils.js";
import * as repo from "./repo.js";

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get(
    "/library/user/:userId",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Library"],
        summary: "List library by user (admin)",
        description: "List reusable assets for a user. Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
        response: { 200: { description: "List of assets" } },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
      const rows = repo.listByOwner(userId);
      return { assets: rows };
    },
  );

  app.patch(
    "/library/user/:userId/:id",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Library"],
        summary: "Update user asset (admin)",
        description: "Update asset metadata for any user. Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" }, id: { type: "string" } },
          required: ["userId", "id"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            tag: { type: "string" },
            global_asset: { type: "number" },
          },
        },
        response: {
          200: { description: "Updated asset" },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const parse = libraryUpdateSchema.safeParse(request.body);
      if (!parse.success) {
        const msg =
          parse.error.issues.map((issue) => issue.message).join("; ") ||
          "Invalid body";
        return reply.status(400).send({ error: msg });
      }
      const body = parse.data;
      const set: Record<string, string | number | boolean | null> = {};
      if (body.name !== undefined) set.name = body.name.trim();
      if (body.tag !== undefined)
        set.tag = body.tag === null ? null : body.tag.trim() || null;
      if (body.globalAsset !== undefined)
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

      repo.updateAssetByIdAndOwner(id, userId, set);
      const row = repo.getById(id);
      if (!row || row.ownerUserId !== userId)
        return reply.status(404).send({ error: "Asset not found" });
      return reply.send(row as Record<string, unknown>);
    },
  );

  app.delete(
    "/library/user/:userId/:id",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Library"],
        summary: "Delete user asset (admin)",
        description: "Permanently delete a user asset. Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" }, id: { type: "string" } },
          required: ["userId", "id"],
        },
        response: {
          204: { description: "Deleted" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const row = repo.getById(id);
      if (!row || row.ownerUserId !== userId)
        return reply.status(404).send({ error: "Asset not found" });
      const pathRaw = row.audioPath;
      const path = pathRaw ? resolveDataPath(pathRaw) : "";
      let bytesFreed = 0;
      if (path && existsSync(path)) {
        const base = libraryDir(userId);
        assertPathUnder(path, base);
        try {
          bytesFreed = statSync(path).size;
        } catch {
          bytesFreed = 0;
        }
        unlinkSync(path);
      }
      repo.deleteAssetByIdAndOwner(id, userId);

      if (bytesFreed > 0) {
        repo.subtractUserDiskBytes(userId, bytesFreed);
      }

      return reply.status(204).send();
    },
  );

  app.get(
    "/library/user/:userId/:id/waveform",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Library"],
        summary: "Get user asset waveform (admin)",
        description: "Returns waveform JSON for a user asset. Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" }, id: { type: "string" } },
          required: ["userId", "id"],
        },
        response: {
          200: { description: "Waveform JSON" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const row = repo.getById(id);
      if (!row || row.ownerUserId !== userId)
        return reply.status(404).send({ error: "Asset not found" });
      const path = row.audioPath ? resolveDataPath(row.audioPath) : "";
      if (!path || !existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      return sendLibraryWaveform(reply, path, libraryDir(userId));
    },
  );

  app.get(
    "/library/user/:userId/:id/stream",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Library"],
        summary: "Stream user asset (admin)",
        description: "Stream audio for a user asset. Admin only.",
        params: {
          type: "object",
          properties: { userId: { type: "string" }, id: { type: "string" } },
          required: ["userId", "id"],
        },
        response: {
          200: { description: "Audio stream" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const row = repo.getById(id);
      if (!row || row.ownerUserId !== userId)
        return reply.status(404).send({ error: "Asset not found" });
      const path = row.audioPath ? resolveDataPath(row.audioPath) : "";
      if (!path || !existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const base = libraryDir(userId);
      const safePath = assertPathUnder(path, base);
      const contentType = contentTypeFromAudioPath(path);
      return sendLibraryStream(request, reply, safePath, contentType);
    },
  );
}
