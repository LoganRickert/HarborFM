import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, extname, join, relative, sep } from "path";
import { tmpdir } from "os";
import { nanoid } from "nanoid";
import AdmZip from "adm-zip";
import {
  FEED_THEME_ZIP_MAX_BYTES,
  feedThemeManifestSchema,
  feedThemeTemplateBasenameSchema,
  type FeedThemeManifest,
} from "@harborfm/shared";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { drizzleDb } from "../../db/drizzle.js";
import { isServerWidePackageId } from "./builtins.js";
import { sanitizeThemeText, textContainsBlockedConstructs } from "./sanitize.js";
import { getServerThemeDir, userThemeDir, userThemeDirPath } from "./paths.js";
import {
  assertThemePagesValid,
  assertThemePreviewValid,
  readThemeManifest,
} from "./themePages.js";
import { clearThemeZipCacheForId } from "./themeZip.js";
import * as repo from "./repo.js";

export type ImportThemeZipOptions = {
  /** Default `user`. Server scope is for admin catalog installs / updates. */
  scope?: "user" | "server";
  /** Written into theme.json so Server Themes can check for updates. */
  catalogUrl?: string;
  /**
   * When scope is server and the package already exists, overwrite disk + DB.
   * Rejected when existing theme.json has `allowOverride: false`.
   */
  allowServerOverwrite?: boolean;
};

/** Server-wide package ids become a personal copy; keep a clear display name. */
function personalThemeName(packageId: string, name: string): string {
  if (!isServerWidePackageId(packageId)) return name;
  if (/\(yours\)\s*$/i.test(name.trim())) return name.trim();
  return `${name.trim()} (yours)`;
}

export class ThemeImportError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ThemeImportError";
    this.statusCode = statusCode;
  }
}

const ALLOWED_EXT = new Set([
  ".liquid",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

const FONT_EXT = new Set([".woff2", ".ttf"]);

const TEXT_EXT = new Set([".liquid", ".css", ".json", ".svg"]);

function normalizeZipEntryName(name: string): string | null {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/")) return null;
  if (n.includes("\0")) return null;
  // Strip a single top-level directory if the zip wraps everything
  const parts = n.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;
  return parts.join("/");
}

/** macOS / Windows / editor noise that often rides along in zips. */
function isJunkZipPath(name: string): boolean {
  const parts = name.split("/");
  for (const part of parts) {
    if (
      part === "__MACOSX" ||
      part === ".DS_Store" ||
      part === "Thumbs.db" ||
      part === "desktop.ini" ||
      part.startsWith("._")
    ) {
      return true;
    }
  }
  return false;
}

/** Keep only theme package files; ignore everything else quietly. */
function isAllowedThemePath(name: string): boolean {
  if (name === "theme.json") return true;
  const ext = extname(name).toLowerCase();
  if (name.startsWith("fonts/")) {
    const rest = name.slice("fonts/".length);
    return FONT_EXT.has(ext) && !!rest && !rest.endsWith("/") && !rest.includes("/");
  }
  if (!ALLOWED_EXT.has(ext)) return false;
  if (name.startsWith("css/") || name.startsWith("images/")) {
    const rest = name.includes("/") ? name.slice(name.indexOf("/") + 1) : "";
    return !!rest && !rest.endsWith("/");
  }
  if (name.startsWith("templates/")) {
    const rest = name.slice("templates/".length);
    return !!rest && !rest.includes("/") && rest.toLowerCase().endsWith(".liquid");
  }
  return false;
}

function stripOptionalRoot(entries: Map<string, Buffer>): Map<string, Buffer> {
  const keys = [...entries.keys()];
  if (keys.length === 0) return entries;
  if (entries.has("theme.json")) return entries;
  const firstSegs = keys.map((k) => k.split("/")[0]);
  const unique = new Set(firstSegs);
  if (unique.size !== 1) return entries;
  const root = firstSegs[0]!;
  const out = new Map<string, Buffer>();
  for (const [k, v] of entries) {
    const rest = k.slice(root.length + 1);
    if (rest) out.set(rest, v);
  }
  return out.has("theme.json") ? out : entries;
}

function dirByteSize(dir: string): number {
  let total = 0;
  const walk = (p: string) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  if (existsSync(dir)) walk(dir);
  return total;
}

function writeTree(destRoot: string, files: Map<string, Buffer>): void {
  for (const [rel, buf] of files) {
    const full = join(destRoot, ...rel.split("/"));
    const parent = dirname(full);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    // Ensure written path stays under destRoot
    const relCheck = relative(destRoot, full);
    if (relCheck.startsWith("..") || relCheck.includes(`..${sep}`)) {
      throw new ThemeImportError("Invalid path in theme package");
    }
    writeFileSync(full, buf);
  }
}

function applyCatalogToManifest(
  manifest: FeedThemeManifest,
  catalogUrl: string | undefined,
): FeedThemeManifest {
  if (!catalogUrl?.trim()) return manifest;
  const next = { ...manifest, catalog: catalogUrl.trim() };
  const parsed = feedThemeManifestSchema.safeParse(next);
  if (!parsed.success) {
    throw new ThemeImportError(
      parsed.error.issues[0]?.message ?? "Invalid catalog URL for theme.json",
    );
  }
  return parsed.data;
}

/**
 * Import or upsert a theme zip. Default scope is the user's personal themes.
 * Pass `scope: "server"` for admin catalog installs (package id = folder id).
 */
export function importThemeZip(
  userId: string,
  zipBuffer: Buffer,
  options: ImportThemeZipOptions = {},
): {
  id: string;
  packageId: string;
  name: string;
  version: string;
  byteSize: number;
  updated: boolean;
  fromBuiltin: boolean;
  scope: "user" | "server";
} {
  const scope = options.scope ?? "user";
  if (zipBuffer.byteLength > FEED_THEME_ZIP_MAX_BYTES) {
    throw new ThemeImportError(
      `Theme zip must be at most ${FEED_THEME_ZIP_MAX_BYTES / (1024 * 1024)} MB`,
      413,
    );
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new ThemeImportError("Invalid zip file");
  }

  const raw = new Map<string, Buffer>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = normalizeZipEntryName(entry.entryName);
    if (!name || isJunkZipPath(name)) continue;
    raw.set(name, entry.getData());
  }

  const stripped = stripOptionalRoot(raw);
  const files = new Map<string, Buffer>();
  for (const [name, buf] of stripped) {
    if (isAllowedThemePath(name)) files.set(name, buf);
  }
  const manifestBuf = files.get("theme.json");
  if (!manifestBuf) {
    throw new ThemeImportError("theme.json is required at the package root");
  }
  if (!files.has("templates/podcast.liquid")) {
    throw new ThemeImportError("A podcast template is required (templates/podcast)");
  }
  if (!files.has("templates/episode.liquid")) {
    throw new ThemeImportError("An episode template is required (templates/episode)");
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestBuf.toString("utf8"));
  } catch {
    throw new ThemeImportError("theme.json must be valid JSON");
  }
  const parsed = feedThemeManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    throw new ThemeImportError(
      parsed.error.issues[0]?.message ?? "Invalid theme.json",
    );
  }
  const manifest = applyCatalogToManifest(parsed.data, options.catalogUrl);

  const templateBasenames: string[] = [];
  for (const key of files.keys()) {
    if (!key.startsWith("templates/") || !key.endsWith(".liquid")) continue;
    const base = key.slice("templates/".length, -".liquid".length);
    const baseCheck = feedThemeTemplateBasenameSchema.safeParse(base);
    if (!baseCheck.success) {
      throw new ThemeImportError(
        baseCheck.error.issues[0]?.message ??
          `Invalid template name: ${key}`,
      );
    }
    templateBasenames.push(base);
  }
  try {
    assertThemePagesValid(manifest, templateBasenames);
  } catch (err) {
    throw new ThemeImportError(typeof err === "string" ? err : "Invalid theme pages");
  }
  try {
    assertThemePreviewValid(manifest, (rel) => files.has(rel));
  } catch (err) {
    throw new ThemeImportError(typeof err === "string" ? err : "Invalid theme preview");
  }

  // Sanitize text files and reject dangerous constructs
  const sanitized = new Map<string, Buffer>();
  for (const [name, buf] of files) {
    const ext = extname(name).toLowerCase();
    if (TEXT_EXT.has(ext)) {
      const text = buf.toString("utf8");
      const blocked = textContainsBlockedConstructs(text);
      if (blocked) {
        throw new ThemeImportError(`${blocked} (${name})`);
      }
      sanitized.set(name, Buffer.from(sanitizeThemeText(text), "utf8"));
    } else {
      sanitized.set(name, buf);
    }
  }
  // Ensure written theme.json includes catalog (and any other manifest edits).
  sanitized.set(
    "theme.json",
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  );

  if (scope === "server") {
    return importServerThemeZip(manifest, sanitized, {
      allowOverwrite: options.allowServerOverwrite === true,
    });
  }

  const existing = repo.getThemeByOwnerAndPackage(userId, manifest.id);
  const staging = join(tmpdir(), `hfm-theme-${nanoid()}`);
  mkdirSync(staging, { recursive: true });
  try {
    writeTree(staging, sanitized);
    const newBytes = dirByteSize(staging);
    const oldBytes = existing?.byteSize ?? 0;
    const delta = newBytes - oldBytes;
    if (delta > 0 && wouldExceedStorageLimit(drizzleDb, userId, delta)) {
      throw new ThemeImportError("Storage limit exceeded", 403);
    }

    const themeId = existing?.id ?? nanoid();
    const dest = userThemeDir(userId, themeId);
    const displayName = personalThemeName(manifest.id, manifest.name);
    // Replace contents
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    writeTree(dest, sanitized);

    if (existing) {
      if (oldBytes > 0) repo.subtractUserDiskBytes(userId, oldBytes);
      repo.addUserDiskBytes(userId, newBytes);
      repo.updateTheme(themeId, {
        name: displayName,
        version: manifest.version,
        byteSize: newBytes,
      });
    } else {
      repo.addUserDiskBytes(userId, newBytes);
      repo.insertTheme({
        id: themeId,
        ownerUserId: userId,
        scope: "user",
        packageId: manifest.id,
        name: displayName,
        version: manifest.version,
        byteSize: newBytes,
      });
    }

    clearThemeZipCacheForId(themeId);
    return {
      id: themeId,
      packageId: manifest.id,
      name: displayName,
      version: manifest.version,
      byteSize: newBytes,
      updated: !!existing,
      fromBuiltin: isServerWidePackageId(manifest.id),
      scope: "user",
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function importServerThemeZip(
  manifest: FeedThemeManifest,
  sanitized: Map<string, Buffer>,
  opts: { allowOverwrite: boolean },
): {
  id: string;
  packageId: string;
  name: string;
  version: string;
  byteSize: number;
  updated: boolean;
  fromBuiltin: boolean;
  scope: "server";
} {
  const packageId = manifest.id;
  const dest = getServerThemeDir(packageId);
  const existingRow =
    repo.getServerThemeById(packageId) ?? repo.getServerThemeByPackageId(packageId);
  const destExists = existsSync(dest);

  if ((existingRow || destExists) && !opts.allowOverwrite) {
    throw new ThemeImportError(
      `Server theme already exists: ${packageId}`,
      409,
    );
  }

  if (opts.allowOverwrite && destExists) {
    const existingManifest = readThemeManifest(dest);
    if (existingManifest?.allowOverride === false) {
      throw new ThemeImportError(
        "This server theme was edited and cannot be overwritten from a catalog. Set allowOverride or replace it manually.",
        409,
      );
    }
  }

  const staging = join(tmpdir(), `hfm-theme-server-${nanoid()}`);
  mkdirSync(staging, { recursive: true });
  try {
    writeTree(staging, sanitized);
    const newBytes = dirByteSize(staging);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    writeTree(dest, sanitized);

    repo.upsertServerTheme({
      id: packageId,
      packageId,
      name: manifest.name,
      version: manifest.version,
    });
    clearThemeZipCacheForId(packageId);

    return {
      id: packageId,
      packageId,
      name: manifest.name,
      version: manifest.version,
      byteSize: newBytes,
      updated: Boolean(existingRow || destExists),
      fromBuiltin: false,
      scope: "server",
    };
  } catch (err) {
    if (!opts.allowOverwrite) {
      rmSync(dest, { recursive: true, force: true });
    }
    throw err;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function deleteThemeForUser(userId: string, themeId: string): void {
  const row = repo.getThemeById(themeId);
  if (!row || row.scope !== "user" || row.ownerUserId !== userId) {
    throw new ThemeImportError("Theme not found", 404);
  }
  const dir = userThemeDirPath(userId, themeId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (row.byteSize > 0) repo.subtractUserDiskBytes(userId, row.byteSize);
  repo.clearPodcastsUsingTheme(themeId);
  repo.deleteTheme(themeId);
  clearThemeZipCacheForId(themeId);
}
