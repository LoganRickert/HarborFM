import type { FastifyInstance } from "fastify";
import { readFile, writeFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { reusableAssets, settings, users } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";
import { libraryDir, libraryAssetPath, pathRelativeToData } from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { INITIAL_ASSETS_PATH, type InitialAsset } from "./utils.js";

export function writeSetting(key: string, value: string): void {
  const now = sqlNow();
  drizzleDb
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    })
    .run();
}

export async function importPixabayAssetsIntoLibrary(
  ownerUserId: string,
  log: FastifyInstance["log"],
): Promise<void> {
  if (!existsSync(INITIAL_ASSETS_PATH)) {
    log.info("initial-assets.json not found, skipping Pixabay import");
    return;
  }
  const raw = await readFile(INITIAL_ASSETS_PATH, "utf8");
  const list = raw.trim() ? (JSON.parse(raw) as unknown) : [];
  const assets = Array.isArray(list) ? (list as InitialAsset[]) : [];
  if (assets.length === 0) return;

  const dir = libraryDir(ownerUserId);
  let totalBytes = 0;
  for (const asset of assets) {
    const downloadUrl =
      typeof asset.download === "string" ? asset.download : "";
    const name = typeof asset.name === "string" ? asset.name : "Untitled";
    const tag = typeof asset.tag === "string" ? asset.tag : null;
    const copyright =
      typeof asset.copyright === "string" ? asset.copyright : null;
    const license = typeof asset.license === "string" ? asset.license : null;
    const source = typeof asset.source === "string" ? asset.source : null;
    if (!downloadUrl) continue;
    const assetId = nanoid();
    const destPath = libraryAssetPath(ownerUserId, assetId, "mp3");
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        log.warn(
          { url: downloadUrl, status: res.status },
          "Pixabay asset download failed",
        );
        continue;
      }
      const buf = await res.arrayBuffer();
      await writeFile(destPath, new Uint8Array(buf));
      const bytesWritten = statSync(destPath).size;
      totalBytes += bytesWritten;
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
        log.warn(
          { err, path: destPath },
          "Waveform generation failed for Pixabay asset",
        );
      }
      drizzleDb.insert(reusableAssets).values({
        id: assetId,
        ownerUserId,
        name,
        tag,
        audioPath: pathRelativeToData(destPath),
        durationSec,
        globalAsset: true,
        copyright,
        license,
        sourceUrl: source,
      }).run();
    } catch (err) {
      log.warn({ err, url: downloadUrl }, "Pixabay asset import failed");
    }

    // Rate limit to avoid overwhelming the server.
    await new Promise((r) => setTimeout(r, 250));
  }
  if (totalBytes > 0) {
    drizzleDb
      .update(users)
      .set({
        diskBytesUsed: sql`COALESCE(${users.diskBytesUsed}, 0) + ${totalBytes}`,
      })
      .where(eq(users.id, ownerUserId))
      .run();
  }
}
