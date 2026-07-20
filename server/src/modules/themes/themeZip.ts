import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import AdmZip from "adm-zip";
import { feedThemeManifestSchema } from "@harborfm/shared";
import { getServerThemeDir, userThemeDirPath } from "./paths.js";
import * as repo from "./repo.js";

const CACHE_DIR = join(tmpdir(), "harborfm-theme-zips");

export type ThemeZipResult = {
  zipPath: string;
  filename: string;
  fromCache: boolean;
};

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function safeSeg(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "0";
}

function walkFiles(dir: string, prefix = ""): Array<{ relativePath: string; absolutePath: string }> {
  const out: Array<{ relativePath: string; absolutePath: string }> = [];
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const st = statSync(absolutePath);
    if (st.isDirectory()) {
      out.push(...walkFiles(absolutePath, relativePath));
    } else if (st.isFile()) {
      out.push({ relativePath, absolutePath });
    }
  }
  return out;
}

function readManifestMeta(dir: string): { name: string; version: string; packageId: string } {
  const fallback = { name: "theme", version: "0", packageId: "theme" };
  const manifestPath = join(dir, "theme.json");
  if (!existsSync(manifestPath)) return fallback;
  try {
    const parsed = feedThemeManifestSchema.safeParse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );
    if (!parsed.success) return fallback;
    return {
      name: parsed.data.name,
      version: parsed.data.version,
      packageId: parsed.data.id,
    };
  } catch {
    return fallback;
  }
}

function buildZipToPath(sourceDir: string, outPath: string): void {
  const zip = new AdmZip();
  for (const file of walkFiles(sourceDir)) {
    zip.addFile(file.relativePath, readFileSync(file.absolutePath));
  }
  const tmpOut = `${outPath}.building`;
  writeFileSync(tmpOut, zip.toBuffer());
  renameSync(tmpOut, outPath);
}

/**
 * Build (or reuse /tmp cache) a zip of a theme directory.
 * Cache key: id-version[-contentKey].zip
 */
export function getOrBuildThemeZip(opts: {
  sourceDir: string;
  /** Stable id used in cache filename (server package id or user theme row id). */
  id: string;
  version: string;
  /** Extra bust token (e.g. updatedAt) when version alone may not change. */
  contentKey?: string;
  /** Download filename stem (defaults to id). */
  downloadStem?: string;
}): ThemeZipResult {
  if (!existsSync(opts.sourceDir) || !existsSync(join(opts.sourceDir, "theme.json"))) {
    throw new Error("Theme files not found");
  }
  ensureCacheDir();
  const idSeg = safeSeg(opts.id);
  const versionSeg = safeSeg(opts.version);
  const contentSeg = opts.contentKey ? `-${safeSeg(opts.contentKey)}` : "";
  const cacheName = `${idSeg}-${versionSeg}${contentSeg}.zip`;
  const zipPath = join(CACHE_DIR, cacheName);
  const stem = safeSeg(opts.downloadStem || opts.id);
  const filename = `${stem}-${versionSeg}-theme.zip`;

  if (existsSync(zipPath)) {
    try {
      statSync(zipPath);
      return { zipPath, filename, fromCache: true };
    } catch {
      // rebuild
    }
  }

  buildZipToPath(opts.sourceDir, zipPath);
  return { zipPath, filename, fromCache: false };
}

export function getOrBuildServerThemeZip(builtinId: string): ThemeZipResult {
  const dir = getServerThemeDir(builtinId);
  const meta = readManifestMeta(dir);
  const serverRow = repo.getServerThemeById(builtinId);
  if (!serverRow && !existsSync(join(dir, "theme.json"))) {
    throw new Error("Built-in theme not found");
  }
  return getOrBuildThemeZip({
    sourceDir: dir,
    id: builtinId,
    version: meta.version || serverRow?.version || "0",
    downloadStem: meta.packageId || builtinId,
  });
}

export function getOrBuildUserThemeZip(userId: string, themeId: string): ThemeZipResult {
  const row = repo.getThemeById(themeId);
  if (!row || row.scope !== "user" || row.ownerUserId !== userId) {
    throw new Error("Theme not found");
  }
  const dir = userThemeDirPath(userId, themeId);
  const meta = readManifestMeta(dir);
  return getOrBuildThemeZip({
    sourceDir: dir,
    id: row.id,
    version: meta.version || row.version || "0",
    contentKey: row.updatedAt,
    downloadStem: meta.packageId || row.packageId,
  });
}

export function openThemeZipStream(zipPath: string) {
  return createReadStream(zipPath);
}

/** Best-effort cleanup of a single cache file (e.g. after theme delete). */
export function clearThemeZipCacheForId(themeId: string): void {
  if (!existsSync(CACHE_DIR)) return;
  const prefix = `${safeSeg(themeId)}-`;
  for (const name of readdirSync(CACHE_DIR)) {
    if (!name.startsWith(prefix) || !name.endsWith(".zip")) continue;
    try {
      unlinkSync(join(CACHE_DIR, name));
    } catch {
      // ignore
    }
  }
}
