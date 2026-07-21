/**
 * Dev helper: copy all packages from harborfm-themes/ into DATA_DIR/themes/server/
 * and upsert feed_themes rows (scope=server) so they appear in Themes / Page Customizations.
 *
 * Re-run after editing gallery themes; no zip/import required.
 *
 * Usage (from repo root):
 *   pnpm themes:sync
 *   pnpm --filter server run themes:sync
 *
 * Env:
 *   GALLERY_THEMES_DIR  Override path to harborfm-themes (default: ../harborfm-themes from server/)
 *   DATA_DIR            HarborFM data directory (same as the server)
 */
import "dotenv/config";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  feedThemeManifestSchema,
  feedThemePackageIdSchema,
} from "@harborfm/shared";
import { getServerThemeDir, getServerThemesRoot } from "../modules/themes/paths.js";
import * as repo from "../modules/themes/repo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(SERVER_ROOT, "..");

const SKIP_DIRS = new Set([
  "scripts",
  "dist",
  "stock-photos",
  "node_modules",
  ".git",
  ".github",
]);

function resolveGalleryRoot(): string {
  const fromEnv = process.env.GALLERY_THEMES_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(REPO_ROOT, "harborfm-themes");
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

function listGalleryPackages(galleryRoot: string): Array<{
  id: string;
  name: string;
  version: string;
  src: string;
}> {
  if (!existsSync(galleryRoot)) {
    throw new Error(`Gallery themes directory not found: ${galleryRoot}`);
  }
  const out: Array<{ id: string; name: string; version: string; src: string }> = [];
  for (const entry of readdirSync(galleryRoot)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const src = join(galleryRoot, entry);
    if (!statSync(src).isDirectory()) continue;
    const idCheck = feedThemePackageIdSchema.safeParse(entry);
    if (!idCheck.success) continue;
    const manifestPath = join(src, "theme.json");
    if (!existsSync(manifestPath)) continue;
    const parsed = feedThemeManifestSchema.safeParse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );
    if (!parsed.success) {
      console.warn(`skip ${entry}: invalid theme.json`);
      continue;
    }
    if (parsed.data.id !== entry) {
      console.warn(`skip ${entry}: folder name must match theme.json id (${parsed.data.id})`);
      continue;
    }
    out.push({
      id: parsed.data.id,
      name: parsed.data.name,
      version: parsed.data.version,
      src,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function syncOne(pkg: { id: string; name: string; version: string; src: string }): void {
  const dest = getServerThemeDir(pkg.id);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(pkg.src, dest, { recursive: true });
  repo.upsertServerTheme({
    id: pkg.id,
    packageId: pkg.id,
    name: pkg.name,
    version: pkg.version,
  });
  // Keep byte_size roughly accurate for the Themes list.
  repo.updateTheme(pkg.id, {
    name: pkg.name,
    version: pkg.version,
    byteSize: dirByteSize(dest),
  });
}

function main(): void {
  const galleryRoot = resolveGalleryRoot();
  const packages = listGalleryPackages(galleryRoot);
  if (packages.length === 0) {
    throw new Error(`No theme packages found under ${galleryRoot}`);
  }

  mkdirSync(getServerThemesRoot(), { recursive: true });

  console.log(`Gallery: ${galleryRoot}`);
  console.log(`Server themes: ${getServerThemesRoot()}`);
  console.log(`Syncing ${packages.length} package(s)…`);

  for (const pkg of packages) {
    syncOne(pkg);
    console.log(`  ${pkg.id}@${pkg.version} (${pkg.name})`);
  }

  console.log("Done. Assign a theme in Page Customizations (server themes).");
  console.log("Hard-refresh the feed if a podcast already uses one of these ids.");
}

main();
