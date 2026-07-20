import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Liquid } from "liquidjs";
import { FEED_DEFAULT_THEME } from "@harborfm/shared";
import { getServerThemeDir, userThemeDirPath } from "./paths.js";
import { getServerThemeById, getThemeById } from "./repo.js";
import { resolveAccent } from "./accent.js";
import { sanitizeThemeText } from "./sanitize.js";

export const HARBORFM_BLOCKS = [
  "site_header",
  "show_header",
  "episodes",
  "player",
  "reviews",
  "cast",
  "funding",
  "links",
  "podroll",
  "search",
  "breadcrumbs",
] as const;

export type HarborfmBlock = (typeof HARBORFM_BLOCKS)[number];

export type ThemeResolveResult =
  | { ok: true; kind: "builtin"; id: string; root: string; assetBase: string }
  | { ok: true; kind: "custom"; id: string; root: string; ownerUserId: string; assetBase: string }
  | { ok: false; reason: string };

/** True for the React SPA feed only. */
export function isBuiltinFeedTheme(id: string): boolean {
  return (id || "").trim() === FEED_DEFAULT_THEME;
}

/** True for a server-wide packaged theme row (scope=server). */
export function isLiquidBuiltinTheme(id: string): boolean {
  return !!getServerThemeById((id || "").trim());
}

/** Packaged page theme (server-wide or user copy), not the default SPA feed. */
export function isLiquidFeedTheme(id: string | null | undefined): boolean {
  const t = (id || FEED_DEFAULT_THEME).trim();
  return !!t && t !== FEED_DEFAULT_THEME;
}

/** Resolve theme package root for page rendering. Falls back with ok:false. */
export function resolveThemePackage(
  feedTheme: string | null | undefined,
  podcastOwnerUserId: string,
  /** API path segment or prefix; leading slash optional (e.g. "api" or "/api"). */
  apiPrefix = "/api",
): ThemeResolveResult {
  const prefix = `/${String(apiPrefix || "api").replace(/^\/+/, "")}`;
  const id = (feedTheme || FEED_DEFAULT_THEME).trim() || FEED_DEFAULT_THEME;
  if (id === FEED_DEFAULT_THEME) {
    return { ok: false, reason: "default" };
  }
  const serverTheme = getServerThemeById(id);
  if (serverTheme) {
    const root = getServerThemeDir(serverTheme.id);
    if (!existsSync(join(root, "theme.json"))) {
      return { ok: false, reason: `${id} package missing` };
    }
    return {
      ok: true,
      kind: "builtin",
      id: serverTheme.id,
      root,
      assetBase: `${prefix}/public/themes/builtin/${serverTheme.id}/assets`,
    };
  }
  const row = getThemeById(id);
  if (!row || row.scope !== "user" || row.ownerUserId !== podcastOwnerUserId) {
    return { ok: false, reason: "theme not found" };
  }
  const root = userThemeDirPath(row.ownerUserId, row.id);
  if (!existsSync(join(root, "theme.json"))) {
    return { ok: false, reason: "theme files missing" };
  }
  return {
    ok: true,
    kind: "custom",
    id: row.id,
    root,
    ownerUserId: row.ownerUserId,
    assetBase: `${prefix}/public/themes/${row.id}/assets`,
  };
}

function harborfmMount(block: string): string {
  return `<div data-harborfm-block="${block}"></div>`;
}

function createEngine(themeRoot: string): Liquid {
  const templatesDir = join(themeRoot, "templates");
  const engine = new Liquid({
    root: [templatesDir, themeRoot],
    extname: ".liquid",
    cache: false,
    strictFilters: false,
    strictVariables: false,
    ownPropertyOnly: true,
  });

  // Optional Liquid filters (themes should prefer {% render 'harborfm/…' %}).
  for (const block of HARBORFM_BLOCKS) {
    engine.registerFilter(`harborfm_${block}`, () => harborfmMount(block));
  }

  // Use {% render 'harborfm/episodes' %} for a virtual mount point.
  return engine;
}

/** Inject virtual HarborFM partials from {% render 'harborfm/…' %}. */
function expandHarborfmRenders(source: string): string {
  return source.replace(
    /\{%-?\s*render\s+['"]harborfm\/([a-z_]+)['"]\s*-?%\}/gi,
    (_m, block: string) => harborfmMount(block.toLowerCase()),
  );
}

export type LiquidPodcastContext = {
  podcast: Record<string, unknown>;
  episodes?: Array<Record<string, unknown>>;
  episode?: Record<string, unknown>;
  accentId: string | null | undefined;
  show: {
    author: boolean;
    podcast_description: boolean;
    episode_description: boolean;
    funding: boolean;
    reviews_podcast: boolean;
    reviews_episode: boolean;
    podroll: boolean;
    cast: boolean;
    links: boolean;
  };
  urls: {
    podcast: string;
    home?: string;
    episode?: string;
    theme_asset_base: string;
    /** template basename → public path for extra pages */
    pages?: Record<string, string>;
  };
  site: { name: string };
  /** Logical page role: podcast (home), episode, or custom page basename */
  page: string;
};

export async function renderLiquidPage(
  themeRoot: string,
  templateBasename: string,
  ctx: LiquidPodcastContext,
): Promise<{ html: string; cssHrefs: string[] }> {
  const templateName = `${templateBasename}.liquid`;
  const templatePath = join(themeRoot, "templates", templateName);
  if (!existsSync(templatePath)) {
    throw new Error(`Missing template ${templateName}`);
  }
  let source = readFileSync(templatePath, "utf8");
  source = sanitizeThemeText(expandHarborfmRenders(source));

  const accent = resolveAccent(ctx.accentId);
  const engine = createEngine(themeRoot);
  const html = await engine.parseAndRender(source, {
    podcast: ctx.podcast,
    episodes: ctx.episodes ?? [],
    episode: ctx.episode ?? null,
    accent,
    show: ctx.show,
    urls: {
      ...ctx.urls,
      home: ctx.urls.home ?? ctx.urls.podcast,
      pages: ctx.urls.pages ?? {},
    },
    site: ctx.site,
    page: ctx.page,
  });

  let cacheBust = "";
  try {
    const manifestPath = join(themeRoot, "theme.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        version?: string;
      };
      if (manifest.version) {
        cacheBust = `?v=${encodeURIComponent(String(manifest.version))}`;
      }
    }
  } catch {
    // ignore invalid theme.json for cache busting
  }

  const cssDir = join(themeRoot, "css");
  const cssHrefs: string[] = [];
  if (existsSync(cssDir)) {
    for (const name of readdirSync(cssDir).sort()) {
      if (name.toLowerCase().endsWith(".css")) {
        cssHrefs.push(
          `${ctx.urls.theme_asset_base}/css/${encodeURIComponent(name)}${cacheBust}`,
        );
      }
    }
  }

  return { html: sanitizeThemeText(html), cssHrefs };
}
