import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import {
  feedThemeManifestSchema,
  feedThemePackageIdSchema,
  type FeedBuiltinThemeListItem,
} from "@harborfm/shared";
import {
  getServerThemeDir,
  getServerThemesRoot,
  getShippedThemesRoot,
} from "./paths.js";
import { readThemeManifest } from "./themePages.js";
import * as repo from "./repo.js";

const BUILTIN_BLURBS: Record<string, string> = {
  fluid: "Full-bleed single-page feed with a strong accent strip.",
  folio: "Multi-page show site with home, episodes, about, and more.",
};

type DiskBuiltin = {
  /** Folder name under themes/server; also used as feed_themes.id */
  id: string;
  packageId: string;
  name: string;
  version: string;
};

function readValidThemeFromDir(root: string, entry: string): DiskBuiltin | null {
  const dir = join(root, entry);
  if (!statSync(dir).isDirectory()) return null;
  const idCheck = feedThemePackageIdSchema.safeParse(entry);
  if (!idCheck.success) return null;
  const manifestPath = join(dir, "theme.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = feedThemeManifestSchema.safeParse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );
    if (!parsed.success) return null;
    // Folder name must match package id so asset paths stay predictable.
    if (parsed.data.id !== entry) return null;
    return {
      id: entry,
      packageId: parsed.data.id,
      name: parsed.data.name,
      version: parsed.data.version,
    };
  } catch {
    return null;
  }
}

/** Scan a themes root for valid packages (folder name = theme.json id). */
function listThemesInRoot(root: string): DiskBuiltin[] {
  if (!existsSync(root)) return [];
  const items: DiskBuiltin[] = [];
  for (const entry of readdirSync(root)) {
    const theme = readValidThemeFromDir(root, entry);
    if (theme) items.push(theme);
  }
  return items;
}

/**
 * Copy each shipped package into `{DATA_DIR}/themes/server/{id}` when missing,
 * or when the data copy still allows override and the shipped version differs.
 * Does not overwrite when theme.json has `allowOverride: false` (set after admin edits).
 */
export function seedShippedThemesIntoDataDir(): {
  seeded: number;
  updated: number;
} {
  const shippedRoot = getShippedThemesRoot();
  const shipped = listThemesInRoot(shippedRoot);
  let seeded = 0;
  let updated = 0;
  for (const theme of shipped) {
    const dest = getServerThemeDir(theme.id);
    const destManifestPath = join(dest, "theme.json");
    const src = join(shippedRoot, theme.id);

    if (existsSync(destManifestPath)) {
      const existing = readThemeManifest(dest);
      if (existing?.allowOverride === false) continue;
      if (existing?.version === theme.version) continue;
    }

    const isUpdate = existsSync(destManifestPath);
    try {
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
      if (isUpdate) updated += 1;
      else seeded += 1;
    } catch (err) {
      rmSync(dest, { recursive: true, force: true });
      throw err;
    }
  }
  return { seeded, updated };
}

/** Scan persistent server theme directories on disk. */
export function listDiskBuiltinThemes(): DiskBuiltin[] {
  return listThemesInRoot(getServerThemesRoot());
}

/**
 * Seed shipped themes into DATA_DIR if needed, then upsert server-wide feed_themes rows.
 * Call on startup so data-backed packages become selectable.
 */
export function syncServerThemesFromDisk(): { upserted: number; removed: number } {
  seedShippedThemesIntoDataDir();
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
      description: BUILTIN_BLURBS[theme.id] ?? "Server page theme.",
    }));
  }
  return listDiskBuiltinThemes().map((theme) => ({
    id: theme.id,
    name: theme.name,
    version: theme.version,
    description: BUILTIN_BLURBS[theme.id] ?? "Server page theme.",
  }));
}

export function isServerWidePackageId(packageId: string): boolean {
  return repo.isServerWidePackageId(packageId);
}

export function isServerWideThemeId(themeId: string): boolean {
  return repo.isServerWideThemeId(themeId);
}
