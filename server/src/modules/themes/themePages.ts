import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  feedThemeManifestSchema,
  feedThemePagePublicPathSchema,
  feedThemeTemplateBasenameSchema,
  type FeedThemeManifest,
} from "@harborfm/shared";

export const RESERVED_THEME_TEMPLATES = new Set(["episode"]);

/** Private Liquid partials (leading underscore) are never public pages. */
export function isThemePartialTemplate(basename: string): boolean {
  return basename.startsWith("_");
}

export type ThemePageEntry = {
  /** Template basename without .liquid */
  template: string;
  /** Public path filename ending in .html */
  publicPath: string;
};

export type ThemePagesResolution = {
  indexTemplate: string;
  /** Extra pages (excludes index and episode). */
  pages: ThemePageEntry[];
  /** Map of template basename → public path for Liquid urls.pages */
  pagesByTemplate: Record<string, string>;
  /** Map of public path → template basename */
  templateByPublicPath: Record<string, string>;
};

export function listTemplateBasenames(themeRoot: string): string[] {
  const templatesDir = join(themeRoot, "templates");
  if (!existsSync(templatesDir)) return [];
  return readdirSync(templatesDir)
    .filter((name) => name.toLowerCase().endsWith(".liquid"))
    .map((name) => name.slice(0, -".liquid".length))
    .filter((base) => feedThemeTemplateBasenameSchema.safeParse(base).success)
    .sort();
}

export function readThemeManifest(themeRoot: string): FeedThemeManifest | null {
  const manifestPath = join(themeRoot, "theme.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    const parsed = feedThemeManifestSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Resolve index template and public .html pages from a theme package on disk.
 * Index template is home-only (not also exposed as .html) unless it is a
 * non-default page that is also listed under pages (not applicable: index is
 * excluded from pages list).
 */
export function resolveThemePages(themeRoot: string): ThemePagesResolution {
  const manifest = readThemeManifest(themeRoot);
  const basenames = listTemplateBasenames(themeRoot);
  const basenameSet = new Set(basenames);

  const indexTemplate = manifest?.index?.trim() || "podcast";
  if (!basenameSet.has(indexTemplate)) {
    // Fall back to podcast if index is missing (corrupt package); caller may 404.
    const fallback = basenameSet.has("podcast") ? "podcast" : basenames[0] || "podcast";
    return {
      indexTemplate: fallback,
      pages: [],
      pagesByTemplate: {},
      templateByPublicPath: {},
    };
  }

  const overrides = manifest?.pages ?? {};
  const pages: ThemePageEntry[] = [];
  const pagesByTemplate: Record<string, string> = {};
  const templateByPublicPath: Record<string, string> = {};

  for (const template of basenames) {
    if (template === indexTemplate) continue;
    if (RESERVED_THEME_TEMPLATES.has(template)) continue;
    if (isThemePartialTemplate(template)) continue;

    const overridden = overrides[template];
    const publicPath = overridden ?? `${template}.html`;
    const pathCheck = feedThemePagePublicPathSchema.safeParse(publicPath);
    if (!pathCheck.success) continue;

    if (templateByPublicPath[publicPath]) {
      // Prefer first in sorted order; skip duplicate
      continue;
    }

    pages.push({ template, publicPath });
    pagesByTemplate[template] = publicPath;
    templateByPublicPath[publicPath] = template;
  }

  return { indexTemplate, pages, pagesByTemplate, templateByPublicPath };
}

/**
 * Validate manifest index/pages against the set of liquid templates in a package.
 * Throws a string message on failure (for ThemeImportError).
 */
export function assertThemePagesValid(
  manifest: FeedThemeManifest,
  templateBasenames: Iterable<string>,
): void {
  const basenameSet = new Set(templateBasenames);
  const indexTemplate = manifest.index?.trim() || "podcast";

  if (!basenameSet.has(indexTemplate)) {
    throw `index template "${indexTemplate}" not found in templates/`;
  }
  if (RESERVED_THEME_TEMPLATES.has(indexTemplate)) {
    throw `index cannot be "${indexTemplate}"`;
  }

  if (isThemePartialTemplate(indexTemplate)) {
    throw `index cannot be a partial template "${indexTemplate}"`;
  }

  const overrides = manifest.pages ?? {};
  for (const [template, publicPath] of Object.entries(overrides)) {
    if (!basenameSet.has(template)) {
      throw `pages key "${template}" has no matching template`;
    }
    if (template === indexTemplate) {
      throw `pages cannot override the index template "${template}"`;
    }
    if (RESERVED_THEME_TEMPLATES.has(template)) {
      throw `pages cannot expose reserved template "${template}"`;
    }
    if (isThemePartialTemplate(template)) {
      throw `pages cannot expose partial template "${template}"`;
    }
    const pathCheck = feedThemePagePublicPathSchema.safeParse(publicPath);
    if (!pathCheck.success) {
      throw pathCheck.error.issues[0]?.message ?? `Invalid page path for "${template}"`;
    }
  }

  const usedPublicPaths = new Set<string>();
  for (const template of basenameSet) {
    if (template === indexTemplate) continue;
    if (RESERVED_THEME_TEMPLATES.has(template)) continue;
    if (isThemePartialTemplate(template)) continue;
    const publicPath = overrides[template] ?? `${template}.html`;
    if (usedPublicPaths.has(publicPath)) {
      throw `Duplicate page path "${publicPath}"`;
    }
    usedPublicPaths.add(publicPath);
  }
}

/** Build public URL paths for theme pages given feed base (e.g. /feed/slug or ""). */
export function themePageUrls(
  pagesByTemplate: Record<string, string>,
  feedBase: string,
): Record<string, string> {
  const base = feedBase.replace(/\/$/, "");
  const out: Record<string, string> = {};
  for (const [template, publicPath] of Object.entries(pagesByTemplate)) {
    out[template] = base ? `${base}/${publicPath}` : `/${publicPath}`;
  }
  return out;
}
