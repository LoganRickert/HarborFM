import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  feedThemeManifestSchema,
  feedThemePackageIdSchema,
  type FeedBuiltinThemeListItem,
} from "@harborfm/shared";
import { getBuiltinThemesRoot } from "./paths.js";
import * as repo from "./repo.js";

const BUILTIN_BLURBS: Record<string, string> = {
  fluid: "Full-bleed single-page feed with a strong accent strip.",
  folio: "Multi-page show site with home, episodes, about, and more.",
};

type DiskBuiltin = {
  /** Folder name under server/themes; also used as feed_themes.id */
  id: string;
  packageId: string;
  name: string;
  version: string;
};

/** Scan bundled theme directories on disk (any folder with a valid theme.json). */
export function listDiskBuiltinThemes(): DiskBuiltin[] {
  const root = getBuiltinThemesRoot();
  if (!existsSync(root)) return [];
  const items: DiskBuiltin[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const idCheck = feedThemePackageIdSchema.safeParse(entry);
    if (!idCheck.success) continue;
    const manifestPath = join(dir, "theme.json");
    if (!existsSync(manifestPath)) continue;
    let packageId = entry;
    let name = entry;
    let version = "0";
    try {
      const parsed = feedThemeManifestSchema.safeParse(
        JSON.parse(readFileSync(manifestPath, "utf8")),
      );
      if (!parsed.success) continue;
      packageId = parsed.data.id;
      name = parsed.data.name;
      version = parsed.data.version;
      // Folder name must match package id so asset paths stay predictable.
      if (packageId !== entry) continue;
    } catch {
      continue;
    }
    items.push({ id: entry, packageId, name, version });
  }
  return items;
}

/**
 * Upsert server-wide feed_themes rows from disk packages.
 * Call on startup so newly added server/themes/* folders become selectable.
 */
export function syncServerThemesFromDisk(): { upserted: number; removed: number } {
  const disk = listDiskBuiltinThemes();
  for (const theme of disk) {
    repo.upsertServerTheme({
      id: theme.id,
      packageId: theme.packageId,
      name: theme.name,
      version: theme.version,
    });
  }
  const removed = repo.deleteServerThemesNotIn(disk.map((t) => t.id));
  return { upserted: disk.length, removed };
}

export function listBuiltinThemes(): FeedBuiltinThemeListItem[] {
  // Prefer DB (source of truth after sync); fall back to disk if sync has not run yet.
  const fromDb = repo.listServerThemes();
  if (fromDb.length > 0) {
    return fromDb.map((theme) => ({
      id: theme.id,
      name: theme.name,
      version: theme.version,
      description: BUILTIN_BLURBS[theme.id] ?? "Built-in page theme.",
    }));
  }
  return listDiskBuiltinThemes().map((theme) => ({
    id: theme.id,
    name: theme.name,
    version: theme.version,
    description: BUILTIN_BLURBS[theme.id] ?? "Built-in page theme.",
  }));
}

export function isServerWidePackageId(packageId: string): boolean {
  return repo.isServerWidePackageId(packageId);
}

export function isServerWideThemeId(themeId: string): boolean {
  return repo.isServerWideThemeId(themeId);
}
