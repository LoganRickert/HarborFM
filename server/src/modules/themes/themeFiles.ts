import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, extname, join, relative, sep } from "path";
import { nanoid } from "nanoid";
import {
  feedThemeManifestSchema,
  feedThemePagePublicPathSchema,
  feedThemeTemplateBasenameSchema,
  type FeedThemeManifest,
} from "@harborfm/shared";
import { eq } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { users } from "../../db/schema.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import {
  assertThemeAssetPath,
  getBuiltinThemeDir,
  userThemeDir,
  userThemeDirPath,
} from "./paths.js";
import { assertThemePagesValid, listTemplateBasenames, readThemeManifest } from "./themePages.js";
import { sanitizeThemeText, textContainsBlockedConstructs } from "./sanitize.js";
import { clearThemeZipCacheForId } from "./themeZip.js";
import { ThemeImportError } from "./importTheme.js";
import * as repo from "./repo.js";

const ALLOWED_EXT = new Set([
  ".liquid",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

const TEXT_EXT = new Set([".liquid", ".css", ".json"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const REQUIRED_PATHS = new Set([
  "theme.json",
  "templates/podcast.liquid",
  "templates/episode.liquid",
]);

export type ThemeAccess = {
  row: repo.FeedThemeRow;
  root: string;
  canWrite: boolean;
  isAdmin: boolean;
};

export type ThemeFileInfo = {
  path: string;
  byteSize: number;
  kind: "text" | "image" | "other";
};

function isAdminUser(userId: string): boolean {
  const row = drizzleDb
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.role === "admin";
}

export function normalizeThemeRelPath(raw: string): string | null {
  const n = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.includes("\0") || n.includes("..")) return null;
  const parts = n.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;
  return parts.join("/");
}

export function isAllowedThemePath(name: string): boolean {
  if (name === "theme.json") return true;
  const ext = extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return false;
  if (name.startsWith("css/") || name.startsWith("images/")) {
    const rest = name.includes("/") ? name.slice(name.indexOf("/") + 1) : "";
    return !!rest && !rest.endsWith("/") && !rest.includes("/");
  }
  if (name.startsWith("templates/")) {
    const rest = name.slice("templates/".length);
    return !!rest && !rest.includes("/") && rest.toLowerCase().endsWith(".liquid");
  }
  return false;
}

export function isTextThemePath(name: string): boolean {
  return TEXT_EXT.has(extname(name).toLowerCase());
}

export function isImageThemePath(name: string): boolean {
  return IMAGE_EXT.has(extname(name).toLowerCase());
}

export function isRequiredThemePath(name: string): boolean {
  return REQUIRED_PATHS.has(name);
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

function walkRelativeFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const st = statSync(absolutePath);
    if (st.isDirectory()) {
      out.push(...walkRelativeFiles(absolutePath, relativePath));
    } else if (st.isFile()) {
      out.push(relativePath.replace(/\\/g, "/"));
    }
  }
  return out;
}

function assertPathUnderRoot(root: string, full: string): void {
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new ThemeImportError("Invalid theme path", 400);
  }
}

function safeAssetPath(root: string, relPath: string): string {
  try {
    return assertThemeAssetPath(root, relPath);
  } catch {
    throw new ThemeImportError("Invalid theme path", 400);
  }
}

function writeUtf8UnderRoot(root: string, relPath: string, text: string): void {
  const full = safeAssetPath(root, relPath);
  const parent = dirname(full);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  assertPathUnderRoot(root, full);
  writeFileSync(full, text, "utf8");
}

function writeBufferUnderRoot(root: string, relPath: string, buf: Buffer): void {
  const full = safeAssetPath(root, relPath);
  const parent = dirname(full);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  assertPathUnderRoot(root, full);
  writeFileSync(full, buf);
}

function sanitizeOrThrow(relPath: string, text: string): string {
  const blocked = textContainsBlockedConstructs(text);
  if (blocked) {
    throw new ThemeImportError(`${blocked} (${relPath})`);
  }
  return sanitizeThemeText(text);
}

function syncDbFromDisk(access: ThemeAccess): void {
  const manifest = readThemeManifest(access.root);
  if (!manifest) {
    throw new ThemeImportError("theme.json is missing or invalid", 400);
  }
  const bytes = dirByteSize(access.root);
  if (access.row.scope === "server") {
    repo.upsertServerTheme({
      id: access.row.id,
      packageId: manifest.id,
      name: manifest.name,
      version: manifest.version,
    });
  } else {
    const oldBytes = access.row.byteSize;
    const ownerId = access.row.ownerUserId;
    if (!ownerId) {
      throw new ThemeImportError("Theme has no owner", 500);
    }
    const delta = bytes - oldBytes;
    if (delta > 0 && wouldExceedStorageLimit(drizzleDb, ownerId, delta)) {
      throw new ThemeImportError("Storage limit exceeded", 403);
    }
    if (oldBytes > 0) repo.subtractUserDiskBytes(ownerId, oldBytes);
    repo.addUserDiskBytes(ownerId, bytes);
    repo.updateTheme(access.row.id, {
      name: manifest.name,
      version: manifest.version,
      byteSize: bytes,
    });
  }
  clearThemeZipCacheForId(access.row.id);
  // Refresh row snapshot for callers that keep using access.row
  const refreshed = repo.getThemeById(access.row.id);
  if (refreshed) {
    access.row = refreshed;
  }
}

/**
 * Resolve theme root + auth for editor APIs.
 * Owners may edit their user themes. Admins may edit server themes.
 */
export function resolveThemeAccess(userId: string, themeId: string): ThemeAccess {
  const row = repo.getThemeById(themeId);
  if (!row) {
    throw new ThemeImportError("Theme not found", 404);
  }
  const admin = isAdminUser(userId);
  if (row.scope === "server") {
    if (!admin) {
      throw new ThemeImportError("Admin access required", 403);
    }
    const root = getBuiltinThemeDir(row.id);
    if (!existsSync(root)) {
      throw new ThemeImportError("Theme package not found on disk", 404);
    }
    return { row, root, canWrite: true, isAdmin: admin };
  }
  if (row.ownerUserId !== userId) {
    throw new ThemeImportError("Theme not found", 404);
  }
  const root = userThemeDirPath(userId, row.id);
  if (!existsSync(root)) {
    throw new ThemeImportError("Theme package not found on disk", 404);
  }
  return { row, root, canWrite: true, isAdmin: admin };
}

export function getThemeDetail(access: ThemeAccess): {
  id: string;
  packageId: string;
  name: string;
  version: string;
  scope: repo.FeedThemeScope;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
  index: string;
  pages: Record<string, string>;
  templates: string[];
  files: ThemeFileInfo[];
} {
  const manifest = readThemeManifest(access.root);
  const templates = listTemplateBasenames(access.root);
  const files = listThemeFiles(access.root);
  return {
    id: access.row.id,
    packageId: access.row.packageId,
    name: access.row.name,
    version: access.row.version,
    scope: access.row.scope,
    byteSize: access.row.byteSize,
    createdAt: access.row.createdAt,
    updatedAt: access.row.updatedAt,
    index: manifest?.index?.trim() || "podcast",
    pages: manifest?.pages ?? {},
    templates,
    files,
  };
}

export function listThemeFiles(root: string): ThemeFileInfo[] {
  const paths = walkRelativeFiles(root)
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => isAllowedThemePath(p))
    .sort();
  return paths.map((path) => {
    const full = join(root, ...path.split("/"));
    const st = existsSync(full) ? statSync(full) : null;
    let kind: ThemeFileInfo["kind"] = "other";
    if (isTextThemePath(path)) kind = "text";
    else if (isImageThemePath(path)) kind = "image";
    return {
      path,
      byteSize: st?.size ?? 0,
      kind,
    };
  });
}

export function readThemeTextFile(access: ThemeAccess, relRaw: string): string {
  const rel = normalizeThemeRelPath(relRaw);
  if (!rel || !isAllowedThemePath(rel) || !isTextThemePath(rel)) {
    throw new ThemeImportError("File not found", 404);
  }
  const full = safeAssetPath(access.root, rel);
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw new ThemeImportError("File not found", 404);
  }
  return readFileSync(full, "utf8");
}

export function writeThemeTextFile(
  access: ThemeAccess,
  relRaw: string,
  body: string,
): void {
  const rel = normalizeThemeRelPath(relRaw);
  if (!rel || !isAllowedThemePath(rel) || !isTextThemePath(rel)) {
    throw new ThemeImportError("Path not allowed", 400);
  }
  if (rel === "theme.json") {
    throw new ThemeImportError("Edit theme.json via metadata endpoints", 400);
  }
  const text = sanitizeOrThrow(rel, body);
  writeUtf8UnderRoot(access.root, rel, text);
  if (rel.startsWith("templates/")) {
    validateManifestAgainstDisk(access.root);
  }
  syncDbFromDisk(access);
}

export function writeThemeBinaryFile(
  access: ThemeAccess,
  relRaw: string,
  buf: Buffer,
): void {
  const rel = normalizeThemeRelPath(relRaw);
  if (!rel || !isAllowedThemePath(rel)) {
    throw new ThemeImportError("Path not allowed", 400);
  }
  if (rel === "theme.json") {
    throw new ThemeImportError("Edit theme.json via metadata endpoints", 400);
  }
  if (isTextThemePath(rel)) {
    writeThemeTextFile(access, rel, buf.toString("utf8"));
    return;
  }
  if (!isImageThemePath(rel)) {
    throw new ThemeImportError("Path not allowed", 400);
  }
  writeBufferUnderRoot(access.root, rel, buf);
  syncDbFromDisk(access);
}

export function createEmptyThemeFile(access: ThemeAccess, relRaw: string): void {
  const rel = normalizeThemeRelPath(relRaw);
  if (!rel || !isAllowedThemePath(rel)) {
    throw new ThemeImportError("Path not allowed", 400);
  }
  if (!(rel.startsWith("templates/") || rel.startsWith("css/"))) {
    throw new ThemeImportError("Only templates/ and css/ files can be created empty", 400);
  }
  if (rel.startsWith("templates/")) {
    const base = rel.slice("templates/".length, -".liquid".length);
    const check = feedThemeTemplateBasenameSchema.safeParse(base);
    if (!check.success) {
      throw new ThemeImportError(check.error.issues[0]?.message ?? "Invalid template name");
    }
  }
  const full = safeAssetPath(access.root, rel);
  if (existsSync(full)) {
    throw new ThemeImportError("File already exists", 409);
  }
  writeUtf8UnderRoot(access.root, rel, "");
  if (rel.startsWith("templates/")) {
    validateManifestAgainstDisk(access.root);
  }
  syncDbFromDisk(access);
}

export function deleteThemeFile(access: ThemeAccess, relRaw: string): void {
  const rel = normalizeThemeRelPath(relRaw);
  if (!rel || !isAllowedThemePath(rel)) {
    throw new ThemeImportError("File not found", 404);
  }
  if (isRequiredThemePath(rel)) {
    throw new ThemeImportError("This file is required and cannot be deleted", 400);
  }
  const full = safeAssetPath(access.root, rel);
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw new ThemeImportError("File not found", 404);
  }
  unlinkSync(full);
  if (rel.startsWith("templates/")) {
    validateManifestAgainstDisk(access.root);
  }
  syncDbFromDisk(access);
}

function validateManifestAgainstDisk(root: string): void {
  const manifest = readThemeManifest(root);
  if (!manifest) {
    throw new ThemeImportError("theme.json is missing or invalid", 400);
  }
  try {
    assertThemePagesValid(manifest, listTemplateBasenames(root));
  } catch (err) {
    throw new ThemeImportError(typeof err === "string" ? err : "Invalid theme pages");
  }
}

export function patchThemeMetadata(
  access: ThemeAccess,
  patch: {
    name?: string;
    version?: string;
    index?: string;
    pages?: Record<string, string> | null;
  },
): FeedThemeManifest {
  const current = readThemeManifest(access.root);
  if (!current) {
    throw new ThemeImportError("theme.json is missing or invalid", 400);
  }

  const next: FeedThemeManifest = {
    id: current.id,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    version: patch.version !== undefined ? patch.version.trim() : current.version,
    index: patch.index !== undefined ? patch.index.trim() : current.index,
    pages:
      patch.pages === null
        ? undefined
        : patch.pages !== undefined
          ? patch.pages
          : current.pages,
  };

  if (!next.name) throw new ThemeImportError("Name is required");
  if (!next.version) throw new ThemeImportError("Version is required");

  if (next.pages && Object.keys(next.pages).length === 0) {
    delete next.pages;
  }

  const parsed = feedThemeManifestSchema.safeParse(next);
  if (!parsed.success) {
    throw new ThemeImportError(parsed.error.issues[0]?.message ?? "Invalid theme metadata");
  }

  try {
    assertThemePagesValid(parsed.data, listTemplateBasenames(access.root));
  } catch (err) {
    throw new ThemeImportError(typeof err === "string" ? err : "Invalid theme pages");
  }

  // Validate any explicit page path values
  if (parsed.data.pages) {
    for (const [template, publicPath] of Object.entries(parsed.data.pages)) {
      const tCheck = feedThemeTemplateBasenameSchema.safeParse(template);
      if (!tCheck.success) {
        throw new ThemeImportError(tCheck.error.issues[0]?.message ?? "Invalid pages key");
      }
      const pCheck = feedThemePagePublicPathSchema.safeParse(publicPath);
      if (!pCheck.success) {
        throw new ThemeImportError(pCheck.error.issues[0]?.message ?? "Invalid page path");
      }
    }
  }

  writeUtf8UnderRoot(
    access.root,
    "theme.json",
    `${JSON.stringify(parsed.data, null, 2)}\n`,
  );
  syncDbFromDisk(access);
  return parsed.data;
}

/**
 * Promote a personal theme to a server-wide theme (admin).
 * Copies files to server/themes/{packageId}/, upserts server row, removes personal row.
 */
export function promoteThemeToServer(userId: string, themeId: string): { id: string } {
  if (!isAdminUser(userId)) {
    throw new ThemeImportError("Admin access required", 403);
  }
  const access = resolveThemeAccess(userId, themeId);
  if (access.row.scope !== "user") {
    throw new ThemeImportError("Theme is already a server theme", 400);
  }
  const manifest = readThemeManifest(access.root);
  if (!manifest) {
    throw new ThemeImportError("theme.json is missing or invalid", 400);
  }
  const packageId = manifest.id;
  if (packageId !== access.row.packageId) {
    throw new ThemeImportError("theme.json id does not match package id", 400);
  }

  const dest = getBuiltinThemeDir(packageId);
  if (existsSync(dest)) {
    throw new ThemeImportError(`Server theme folder already exists: ${packageId}`, 409);
  }
  const existingServer = repo.getServerThemeById(packageId) ?? repo.getServerThemeByPackageId(packageId);
  if (existingServer) {
    throw new ThemeImportError(`Server theme already registered: ${packageId}`, 409);
  }

  mkdirSync(dest, { recursive: true });
  try {
    cpSync(access.root, dest, { recursive: true });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err;
  }

  repo.upsertServerTheme({
    id: packageId,
    packageId,
    name: manifest.name,
    version: manifest.version,
  });

  const ownerId = access.row.ownerUserId!;
  const oldBytes = access.row.byteSize;
  if (existsSync(access.root)) {
    rmSync(access.root, { recursive: true, force: true });
  }
  if (oldBytes > 0) repo.subtractUserDiskBytes(ownerId, oldBytes);
  repo.clearPodcastsUsingTheme(access.row.id);
  repo.deleteTheme(access.row.id);
  clearThemeZipCacheForId(access.row.id);
  clearThemeZipCacheForId(packageId);

  return { id: packageId };
}

/**
 * Demote a server theme to a personal theme owned by the admin.
 */
export function demoteThemeToUser(userId: string, themeId: string): { id: string } {
  if (!isAdminUser(userId)) {
    throw new ThemeImportError("Admin access required", 403);
  }
  const access = resolveThemeAccess(userId, themeId);
  if (access.row.scope !== "server") {
    throw new ThemeImportError("Theme is not a server theme", 400);
  }
  const manifest = readThemeManifest(access.root);
  if (!manifest) {
    throw new ThemeImportError("theme.json is missing or invalid", 400);
  }

  const newId = nanoid();
  const dest = userThemeDir(userId, newId);
  try {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(access.root, dest, { recursive: true });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err;
  }

  const bytes = dirByteSize(dest);
  if (wouldExceedStorageLimit(drizzleDb, userId, bytes)) {
    rmSync(dest, { recursive: true, force: true });
    throw new ThemeImportError("Storage limit exceeded", 403);
  }

  repo.addUserDiskBytes(userId, bytes);
  repo.insertTheme({
    id: newId,
    ownerUserId: userId,
    scope: "user",
    packageId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    byteSize: bytes,
  });

  rmSync(access.root, { recursive: true, force: true });
  repo.clearPodcastsUsingTheme(access.row.id);
  repo.deleteTheme(access.row.id);
  clearThemeZipCacheForId(access.row.id);
  clearThemeZipCacheForId(newId);

  return { id: newId };
}

export function setThemeScope(
  userId: string,
  themeId: string,
  scope: "server" | "user",
): { id: string; scope: "server" | "user" } {
  const row = repo.getThemeById(themeId);
  if (!row) {
    throw new ThemeImportError("Theme not found", 404);
  }
  if (scope === "server") {
    if (row.scope === "server") return { id: row.id, scope: "server" };
    const result = promoteThemeToServer(userId, themeId);
    return { id: result.id, scope: "server" };
  }
  if (row.scope === "user") return { id: row.id, scope: "user" };
  const result = demoteThemeToUser(userId, themeId);
  return { id: result.id, scope: "user" };
}

/** Admin-only: delete a server theme from disk + DB. */
export function deleteServerTheme(userId: string, themeId: string): void {
  if (!isAdminUser(userId)) {
    throw new ThemeImportError("Admin access required", 403);
  }
  const row = repo.getServerThemeById(themeId);
  if (!row) {
    throw new ThemeImportError("Theme not found", 404);
  }
  const root = getBuiltinThemeDir(row.id);
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
  repo.clearPodcastsUsingTheme(row.id);
  repo.deleteTheme(row.id);
  clearThemeZipCacheForId(row.id);
}
