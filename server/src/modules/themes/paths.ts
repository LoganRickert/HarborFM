import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  assertResolvedPathUnder,
  assertSafeId,
  ensureDir,
  getDataDir,
} from "../../services/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Bundled first-party themes (Fluid). Relative to this package when running from src or dist. */
export function getBuiltinThemesRoot(): string {
  // From server/src/modules/themes or server/dist/modules/themes up to server/themes
  return join(__dirname, "..", "..", "..", "themes");
}

export function getBuiltinThemeDir(builtinId: string): string {
  assertSafeId(builtinId, "builtinThemeId");
  return join(getBuiltinThemesRoot(), builtinId);
}

export function userThemesRoot(userId: string): string {
  assertSafeId(userId, "userId");
  const dir = join(getDataDir(), "themes", userId);
  ensureDir(dir);
  return dir;
}

export function userThemeDir(userId: string, themeId: string): string {
  assertSafeId(userId, "userId");
  assertSafeId(themeId, "themeId");
  const dir = join(userThemesRoot(userId), themeId);
  ensureDir(dir);
  return dir;
}

/** Absolute theme root path without creating. */
export function userThemeDirPath(userId: string, themeId: string): string {
  assertSafeId(userId, "userId");
  assertSafeId(themeId, "themeId");
  return join(getDataDir(), "themes", userId, themeId);
}

export function assertThemeAssetPath(themeRoot: string, relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("..") || cleaned.startsWith("/")) {
    throw new Error("Invalid theme asset path");
  }
  const full = join(themeRoot, cleaned);
  assertResolvedPathUnder(full, themeRoot);
  return full;
}
