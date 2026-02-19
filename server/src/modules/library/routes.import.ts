import type { FastifyInstance } from "fastify";
import { writeFile } from "fs/promises";
import { statSync } from "fs";
import { nanoid } from "nanoid";
import { libraryAddByUrlBodySchema } from "@harborfm/shared";
import {
  requireAuth,
  requireAdmin,
  requireNotReadOnly,
} from "../../plugins/auth.js";
import { broadcastToUser } from "../../services/episodeBroadcast.js";
import {
  libraryDir,
  libraryAssetPath,
  pathRelativeToData,
} from "../../services/paths.js";
import { assertUrlNotPrivate } from "../../utils/ssrf.js";
import * as audioService from "../../services/audio.js";
import {
  fetchPixabayHtml,
  extractPixabayLdJson,
  pixabayLdToAsset,
} from "./utils.js";
import * as repo from "./repo.js";

export async function registerImportRoutes(app: FastifyInstance) {
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

        const normalizedSource = assetMeta.source;
        const existing = repo.findBySourceUrl(normalizedSource);
        if (existing) {
          return reply
            .status(409)
            .send({ error: "This asset is already in the library" });
        }

        const assetId = nanoid();
        const dir = libraryDir(request.userId as string);
        const destPath = libraryAssetPath(request.userId as string, assetId, "mp3");
        await assertUrlNotPrivate(downloadUrl);
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
        repo.insertAsset({
          id: assetId,
          ownerUserId: request.userId as string,
          name: assetMeta.name,
          tag: assetMeta.tag,
          audioPath: pathRelativeToData(destPath),
          durationSec,
          globalAsset: false,
          copyright: assetMeta.copyright ?? null,
          license: assetMeta.license ?? null,
          sourceUrl: normalizedSource,
        });
        repo.addUserDiskBytes(request.userId as string, bytesWritten);
        const row = repo.getById(assetId);
        broadcastToUser(request.userId as string, { type: "libraryAdded" });
        return reply.status(201).send(row as Record<string, unknown>);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Import failed";
        request.log.warn({ err, url }, "Pixabay import failed");
        return reply.status(400).send({ error: msg });
      }
    },
  );
}
