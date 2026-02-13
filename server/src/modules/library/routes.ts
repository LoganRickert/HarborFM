import type { FastifyInstance, FastifyReply } from "fastify";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync, unlinkSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, basename } from "path";
import send from "@fastify/send";
import { nanoid } from "nanoid";
import { libraryUpdateSchema, libraryAddByUrlBodySchema } from "@harborfm/shared";
import { db } from "../../db/index.js";
import {
  requireAuth,
  requireAdmin,
  requireNotReadOnly,
} from "../../plugins/auth.js";
import { isAdmin, canReadLibraryAsset } from "../../services/access.js";
import { libraryDir, libraryAssetPath, assertPathUnder } from "../../services/paths.js";
import { normalizeHostname } from "../../utils/url.js";
import * as audioService from "../../services/audio.js";
import {
  FileTooLargeError,
  streamToFileWithLimit,
  extensionFromAudioMimetype,
} from "../../services/uploads.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { LIBRARY_UPLOAD_MAX_BYTES, WAVEFORM_EXTENSION } from "../../config.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";

const ALLOWED_MIME = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/webm",
  "audio/ogg",
];

function libraryWaveformPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
}

function sendLibraryWaveform(
  reply: FastifyReply,
  audioPath: string,
  baseDir: string,
): FastifyReply {
  const wavPath = libraryWaveformPath(audioPath);
  if (!existsSync(wavPath))
    return reply.status(404).send({ error: "Waveform not found" });
  assertPathUnder(wavPath, baseDir);
  const json = readFileSync(wavPath, "utf-8");
  reply
    .header("Content-Type", "application/json")
    .header("Cache-Control", "private, max-age=3600");
  return reply.send(json);
}

function fetchPixabayHtml(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.origin !== "https://pixabay.com") {
    throw new Error("URL must be from https://pixabay.com");
  }
  const args = [
    "-q",
    "-O",
    "-",
    "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "--header=Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "--header=Accept-Language: en-US,en;q=0.9",
    "--header=Cache-Control: no-cache",
    "--header=Pragma: no-cache",
    "--header=Upgrade-Insecure-Requests: 1",
    "--compression=auto",
    url,
  ];
  try {
    return execFileSync("wget", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? (e as { status?: number }).status
        : undefined;
    if (status !== undefined)
      throw new Error(`Failed to fetch page (exit ${status})`);
    throw e;
  }
}

function extractPixabayLdJson(html: string): {
  name?: string;
  contentUrl?: string;
  creator?: { name?: string };
  datePublished?: string;
} {
  const regex =
    /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(regex)];
  for (const m of matches) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as {
        "@type"?: string;
        contentUrl?: string;
        name?: string;
        creator?: { name?: string };
        datePublished?: string;
      };
      if (data["@type"] === "AudioObject" && data.contentUrl) return data;
    } catch {
      // skip invalid JSON
    }
  }
  throw new Error("No AudioObject ld+json with contentUrl found in page");
}

function pixabayLdToAsset(
  ld: {
    name?: string;
    contentUrl?: string;
    creator?: { name?: string };
    datePublished?: string;
  },
  sourceUrl: string,
): {
  name: string;
  tag: string;
  copyright: string;
  license: string;
  download: string;
  source: string;
} {
  const year = ld.datePublished ? new Date(ld.datePublished).getFullYear() : "";
  const creatorName =
    ld.creator && typeof ld.creator === "object" ? ld.creator.name : "";
  const copyright = [creatorName, year].filter(Boolean).join(" ") || "Pixabay";
  return {
    name: ld.name ?? "Untitled",
    tag: "Bumper",
    copyright,
    license: "Pixabay Content License",
    download: (ld.contentUrl ?? "").split("?")[0],
    source: normalizeHostname(sourceUrl),
  };
}

export async function libraryRoutes(app: FastifyInstance) {
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
      const rows = db
        .prepare(
          `SELECT id, owner_user_id, name, tag, duration_sec, created_at,
                COALESCE(global_asset, 0) AS global_asset, copyright, license
         FROM reusable_assets
         WHERE owner_user_id = ? OR global_asset = 1
         ORDER BY name`,
        )
        .all(request.userId) as Record<string, unknown>[];
      return { assets: rows };
    },
  );

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
      const rows = db
        .prepare(
          `SELECT id, owner_user_id, name, tag, duration_sec, created_at,
                COALESCE(global_asset, 0) AS global_asset, copyright, license
         FROM reusable_assets
         WHERE owner_user_id = ? ORDER BY name`,
        )
        .all(userId) as Record<string, unknown>[];
      return { assets: rows };
    },
  );

  app.post(
    "/library/import-pixabay",
    {
      preHandler: [requireAuth, requireAdmin, requireNotReadOnly],
      schema: {
        tags: ["Library"],
        summary: "Import from Pixabay",
        description:
          "Import an audio asset from a Pixabay page URL. Admin only.",
        body: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
        response: {
          201: { description: "Imported asset" },
          400: { description: "Invalid URL or import failed" },
          409: { description: "Already in library" },
          502: { description: "Download failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = libraryAddByUrlBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const url = parsed.data.url;
      try {
        const html = fetchPixabayHtml(url);
        const ld = extractPixabayLdJson(html);
        const assetMeta = pixabayLdToAsset(ld, url);
        const downloadUrl = assetMeta.download;
        if (!downloadUrl)
          return reply.status(400).send({ error: "No download URL in page" });

        const normalizedSource = normalizeHostname(assetMeta.source);
        const existing = db
          .prepare(`SELECT id FROM reusable_assets WHERE source_url = ?`)
          .get(normalizedSource) as { id: string } | undefined;
        if (existing) {
          return reply
            .status(409)
            .send({ error: "This asset is already in the library" });
        }

        const assetId = nanoid();
        const dir = libraryDir(request.userId);
        const destPath = libraryAssetPath(request.userId, assetId, "mp3");
        const res = await fetch(downloadUrl);
        if (!res.ok) {
          return reply
            .status(502)
            .send({ error: `Download failed (${res.status})` });
        }
        const buf = await res.arrayBuffer();
        await writeFile(destPath, new Uint8Array(buf));
        const bytesWritten = statSync(destPath).size;
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
          request.log.warn(
            { err, path: destPath },
            "Waveform generation failed for Pixabay import",
          );
        }
        db.prepare(
          `INSERT INTO reusable_assets (id, owner_user_id, name, tag, audio_path, duration_sec, global_asset, copyright, license, source_url)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        ).run(
          assetId,
          request.userId,
          assetMeta.name,
          assetMeta.tag,
          destPath,
          durationSec,
          assetMeta.copyright,
          assetMeta.license,
          normalizedSource,
        );
        db.prepare(
          `UPDATE users SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ? WHERE id = ?`,
        ).run(bytesWritten, request.userId);
        const row = db
          .prepare("SELECT * FROM reusable_assets WHERE id = ?")
          .get(assetId) as Record<string, unknown>;
        return reply.status(201).send(row);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Import failed";
        request.log.warn({ err, url }, "Pixabay import failed");
        return reply.status(400).send({ error: msg });
      }
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
      const destPath = libraryAssetPath(request.userId, id, ext);
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

      if (wouldExceedStorageLimit(db, request.userId, bytesWritten)) {
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

      const dir = libraryDir(request.userId);
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

      db.prepare(
        `INSERT INTO reusable_assets (id, owner_user_id, name, tag, audio_path, duration_sec, copyright, license)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        request.userId,
        name,
        tag,
        finalPath,
        durationSec,
        copyright,
        license,
      );

      // Track disk usage (best-effort)
      db.prepare(
        `UPDATE users
         SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ?
         WHERE id = ?`,
      ).run(bytesWritten, request.userId);

      const row = db
        .prepare("SELECT * FROM reusable_assets WHERE id = ?")
        .get(id) as Record<string, unknown>;
      return reply.status(201).send(row);
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
      const asset = db
        .prepare(
          "SELECT id, owner_user_id, name, tag, COALESCE(global_asset, 0) AS global_asset, copyright, license FROM reusable_assets WHERE id = ?",
        )
        .get(id) as { owner_user_id: string; global_asset: number } | undefined;
      if (!asset) return reply.status(404).send({ error: "Asset not found" });

      const userIsAdmin = isAdmin(request.userId);
      const isOwner = asset.owner_user_id === request.userId;
      if (!isOwner && !userIsAdmin) {
        return reply
          .status(403)
          .send({
            error: "Only the owner or an administrator can edit this asset.",
          });
      }

      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.name !== undefined) {
        updates.push("name = ?");
        values.push(body.name.trim());
      }
      if (body.tag !== undefined) {
        updates.push("tag = ?");
        values.push(body.tag === null ? null : body.tag.trim() || null);
      }
      if (userIsAdmin && body.global_asset !== undefined) {
        updates.push("global_asset = ?");
        values.push(body.global_asset ? 1 : 0);
      }
      if (body.copyright !== undefined) {
        updates.push("copyright = ?");
        values.push(
          body.copyright === null ? null : body.copyright.trim() || null,
        );
      }
      if (body.license !== undefined) {
        updates.push("license = ?");
        values.push(body.license === null ? null : body.license.trim() || null);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: "No fields to update" });
      }

      values.push(id);
      if (isOwner) {
        values.push(request.userId);
        db.prepare(
          `UPDATE reusable_assets SET ${updates.join(", ")} WHERE id = ? AND owner_user_id = ?`,
        ).run(...values);
      } else {
        db.prepare(
          `UPDATE reusable_assets SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...values);
      }
      const row = db
        .prepare(
          `SELECT id, owner_user_id, name, tag, duration_sec, created_at, COALESCE(global_asset, 0) AS global_asset, copyright, license
         FROM reusable_assets WHERE id = ?`,
        )
        .get(id) as Record<string, unknown>;
      return reply.send(row);
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
      const row = db
        .prepare("SELECT * FROM reusable_assets WHERE id = ?")
        .get(id) as
        | (Record<string, unknown> & {
            owner_user_id: string;
            global_asset?: number;
          })
        | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const userIsAdmin = isAdmin(request.userId);
      const isOwner = row.owner_user_id === request.userId;
      if (!isOwner && !userIsAdmin) {
        return reply
          .status(403)
          .send({
            error: "Only the owner or an administrator can delete this asset.",
          });
      }
      const { unlinkSync } = await import("fs");
      const path = row.audio_path as string;
      const ownerId = row.owner_user_id;
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
      db.prepare("DELETE FROM reusable_assets WHERE id = ?").run(id);

      if (bytesFreed > 0) {
        db.prepare(
          `UPDATE users
         SET disk_bytes_used =
           CASE
             WHEN COALESCE(disk_bytes_used, 0) - ? < 0 THEN 0
             ELSE COALESCE(disk_bytes_used, 0) - ?
           END
         WHERE id = ?`,
        ).run(bytesFreed, bytesFreed, ownerId);
      }

      return reply.status(204).send();
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
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.name !== undefined) {
        updates.push("name = ?");
        values.push(body.name.trim());
      }
      if (body.tag !== undefined) {
        updates.push("tag = ?");
        values.push(body.tag === null ? null : body.tag.trim() || null);
      }
      if (body.global_asset !== undefined) {
        updates.push("global_asset = ?");
        values.push(body.global_asset ? 1 : 0);
      }
      if (body.copyright !== undefined) {
        updates.push("copyright = ?");
        values.push(
          body.copyright === null ? null : body.copyright.trim() || null,
        );
      }
      if (body.license !== undefined) {
        updates.push("license = ?");
        values.push(body.license === null ? null : body.license.trim() || null);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: "No fields to update" });
      }

      values.push(id);
      values.push(userId);
      db.prepare(
        `UPDATE reusable_assets SET ${updates.join(", ")} WHERE id = ? AND owner_user_id = ?`,
      ).run(...values);
      const row = db
        .prepare(
          `SELECT id, owner_user_id, name, tag, duration_sec, created_at, COALESCE(global_asset, 0) AS global_asset, copyright, license
         FROM reusable_assets WHERE id = ? AND owner_user_id = ?`,
        )
        .get(id, userId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      return reply.send(row);
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
      const row = db
        .prepare(
          "SELECT * FROM reusable_assets WHERE id = ? AND owner_user_id = ?",
        )
        .get(id, userId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const { unlinkSync } = await import("fs");
      const path = row.audio_path as string;
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
      db.prepare("DELETE FROM reusable_assets WHERE id = ?").run(id);

      if (bytesFreed > 0) {
        db.prepare(
          `UPDATE users
         SET disk_bytes_used =
           CASE
             WHEN COALESCE(disk_bytes_used, 0) - ? < 0 THEN 0
             ELSE COALESCE(disk_bytes_used, 0) - ?
           END
         WHERE id = ?`,
        ).run(bytesFreed, bytesFreed, userId);
      }

      return reply.status(204).send();
    },
  );

  async function sendLibraryStream(
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
    safePath: string,
    contentType: string,
  ) {
    const result = await send(request.raw, basename(safePath), {
      root: dirname(safePath),
      contentType: false,
      acceptRanges: true,
      cacheControl: false,
    });

    if (result.type === "error") {
      const err = result.metadata.error as Error & { status?: number };
      return reply
        .status((err.status ?? 500) as 404 | 500)
        .send({ error: err.message ?? "Internal Server Error" });
    }

    reply.code(result.statusCode as 200 | 206 | 404 | 500);
    const headers = result.headers as Record<string, string>;
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) reply.header(key, value);
    }
    reply.header("Content-Type", contentType);
    return reply.send(result.stream);
  }

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
      if (!canReadLibraryAsset(request.userId, id))
        return reply.status(404).send({ error: "Asset not found" });
      const row = db
        .prepare("SELECT * FROM reusable_assets WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audio_path as string;
      if (!path || !existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const base = libraryDir(row.owner_user_id as string);
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
      if (!canReadLibraryAsset(request.userId, id))
        return reply.status(404).send({ error: "Asset not found" });
      const row = db
        .prepare("SELECT * FROM reusable_assets WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audio_path as string;
      const ownerUserId = row.owner_user_id as string;
      if (!path || !existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const base = libraryDir(ownerUserId);
      const safePath = assertPathUnder(path, base);
      const contentType = contentTypeFromAudioPath(path);
      return sendLibraryStream(request, reply, safePath, contentType);
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
      const row = db
        .prepare(
          "SELECT * FROM reusable_assets WHERE id = ? AND owner_user_id = ?",
        )
        .get(id, userId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audio_path as string;
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
      const row = db
        .prepare(
          "SELECT * FROM reusable_assets WHERE id = ? AND owner_user_id = ?",
        )
        .get(id, userId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Asset not found" });
      const path = row.audio_path as string;
      if (!path || !existsSync(path))
        return reply.status(404).send({ error: "File not found" });
      const base = libraryDir(userId);
      const safePath = assertPathUnder(path, base);
      const contentType = contentTypeFromAudioPath(path);
      return sendLibraryStream(request, reply, safePath, contentType);
    },
  );
}
