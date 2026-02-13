import {
  existsSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { db } from "../db/index.js";
import { SITEMAP_FILENAME, SITEMAP_INDEX_FILENAME } from "../config.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  getDataDir,
  sitemapDir,
  sitemapIndexDir,
} from "./paths.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function loc(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** Format date for sitemap lastmod (YYYY-MM-DD). */
function toLastmod(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
}

function renderUrlEntry(entry: SitemapUrlEntry): string {
  let out = `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
`;
  if (entry.lastmod)
    out += `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
`;
  if (entry.changefreq)
    out += `    <changefreq>${entry.changefreq}</changefreq>
`;
  if (entry.priority != null)
    out += `    <priority>${Math.min(1, Math.max(0, entry.priority)).toFixed(1)}</priority>
`;
  out += `  </url>
`;
  return out;
}

export interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

/**
 * Sitemap index (sitemap.xml at root) listing static sitemap + one sitemap per podcast.
 * Each entry can include lastmod (YYYY-MM-DD).
 */
export function generateSitemapIndex(entries: SitemapIndexEntry[]): string {
  let out = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (const entry of entries) {
    out += `  <sitemap>
    <loc>${escapeXml(entry.loc)}</loc>
`;
    if (entry.lastmod)
      out += `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
`;
    out += `  </sitemap>
`;
  }
  out += "</sitemapindex>";
  return out;
}

/**
 * Static sitemap: root, feed home, login, register, privacy, terms, contact. Per-podcast feed pages are in per-podcast sitemaps.
 */
export function generateStaticSitemapXml(baseUrl: string): string {
  const now = toLastmod(new Date());
  const entries: SitemapUrlEntry[] = [
    {
      loc: loc(baseUrl, "/"),
      lastmod: now,
      changefreq: "weekly",
      priority: 1.0,
    },
    {
      loc: loc(baseUrl, "/feed"),
      lastmod: now,
      changefreq: "weekly",
      priority: 0.9,
    },
    {
      loc: loc(baseUrl, "/login"),
      lastmod: now,
      changefreq: "monthly",
      priority: 0.5,
    },
    {
      loc: loc(baseUrl, "/register"),
      lastmod: now,
      changefreq: "monthly",
      priority: 0.5,
    },
    {
      loc: loc(baseUrl, "/privacy"),
      lastmod: now,
      changefreq: "yearly",
      priority: 0.3,
    },
    {
      loc: loc(baseUrl, "/terms"),
      lastmod: now,
      changefreq: "yearly",
      priority: 0.3,
    },
    {
      loc: loc(baseUrl, "/contact"),
      lastmod: now,
      changefreq: "monthly",
      priority: 0.3,
    },
  ];
  let out = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (const entry of entries) {
    out += renderUrlEntry(entry);
  }
  out += "</urlset>";
  return out;
}

/**
 * Per-podcast sitemap: feed page + each published episode page.
 */
export function generatePodcastSitemapXml(
  podcastId: string,
  baseUrl: string,
): string {
  const podcast = db
    .prepare("SELECT id, slug, updated_at FROM podcasts WHERE id = ?")
    .get(podcastId) as
    | { id: string; slug: string; updated_at: string }
    | undefined;
  if (!podcast) throw new Error("Podcast not found");
  const slugEnc = encodeURIComponent(podcast.slug);
  const feedLastmod = podcast.updated_at
    ? toLastmod(new Date(podcast.updated_at))
    : toLastmod(new Date());
  const entries: SitemapUrlEntry[] = [
    {
      loc: loc(baseUrl, `/feed/${slugEnc}`),
      lastmod: feedLastmod,
      changefreq: "weekly",
      priority: 0.8,
    },
  ];

  const episodes = db
    .prepare(
      `SELECT slug, publish_at, updated_at FROM episodes WHERE podcast_id = ? AND status = 'published'
       AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))
       ORDER BY publish_at DESC, created_at DESC`,
    )
    .all(podcastId) as {
    slug: string | null;
    publish_at: string | null;
    updated_at: string;
  }[];

  for (const ep of episodes) {
    const epSlug = ep.slug ?? "";
    if (!epSlug) continue;
    const lastmod = ep.publish_at
      ? toLastmod(new Date(ep.publish_at))
      : ep.updated_at
        ? toLastmod(new Date(ep.updated_at))
        : toLastmod(new Date());
    entries.push({
      loc: loc(baseUrl, `/feed/${slugEnc}/${encodeURIComponent(epSlug)}`),
      lastmod,
      changefreq: "monthly",
      priority: 0.6,
    });
  }

  let out = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (const entry of entries) {
    out += renderUrlEntry(entry);
  }
  out += "</urlset>";
  return out;
}

/** Write sitemap XML to data/sitemap/:podcastId/sitemap.xml. Path is asserted under sitemap dir. */
export function writeSitemapToFile(podcastId: string, xml: string): void {
  const dir = sitemapDir(podcastId);
  const path = join(dir, SITEMAP_FILENAME);
  assertResolvedPathUnder(path, dir);
  writeFileSync(path, xml, "utf8");
}

/**
 * Return cached sitemap XML if the file exists and is newer than maxAgeMs.
 * Otherwise return null (caller should generate and save).
 * Paths are asserted under sitemap dir.
 */
export function getCachedSitemapIfFresh(
  podcastId: string,
  maxAgeMs: number,
): string | null {
  const dir = sitemapDir(podcastId);
  const path = join(dir, SITEMAP_FILENAME);
  assertResolvedPathUnder(path, dir);
  if (!existsSync(path)) return null;
  try {
    const safePath = assertPathUnder(path, dir);
    const stat = statSync(safePath);
    const age = Date.now() - stat.mtimeMs;
    if (age >= maxAgeMs) return null;
    return readFileSync(safePath, "utf8");
  } catch {
    return null;
  }
}

/** Write sitemap index XML to data/sitemap/index.xml. Path is asserted under sitemap index dir. */
export function writeSitemapIndexToFile(xml: string): void {
  const dir = sitemapIndexDir();
  const path = join(dir, SITEMAP_INDEX_FILENAME);
  assertResolvedPathUnder(path, dir);
  writeFileSync(path, xml, "utf8");
}

/**
 * Return cached sitemap index XML if the file exists and is newer than maxAgeMs.
 * Otherwise return null (caller should generate and save).
 */
export function getCachedSitemapIndexIfFresh(maxAgeMs: number): string | null {
  const dir = sitemapIndexDir();
  const path = join(dir, SITEMAP_INDEX_FILENAME);
  assertResolvedPathUnder(path, dir);
  if (!existsSync(path)) return null;
  try {
    const safePath = assertPathUnder(path, dir);
    const stat = statSync(safePath);
    const age = Date.now() - stat.mtimeMs;
    if (age >= maxAgeMs) return null;
    return readFileSync(safePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Delete all sitemap cache files (index + per-podcast sitemaps). Admin-only.
 * Asserts every path is under the sitemap directory before deletion.
 */
export function clearSitemapCache(): void {
  const dataDir = getDataDir();
  const sitemapRoot = sitemapIndexDir();
  assertResolvedPathUnder(sitemapRoot, dataDir);
  if (!existsSync(sitemapRoot)) return;

  function removeDirRecursively(dir: string, allowedBase: string): void {
    const safeDir = assertPathUnder(dir, allowedBase);
    for (const entry of readdirSync(safeDir)) {
      const full = join(safeDir, entry);
      const safeFull = assertPathUnder(full, allowedBase);
      const stat = statSync(safeFull);
      if (stat.isFile()) {
        unlinkSync(safeFull);
      } else if (stat.isDirectory()) {
        removeDirRecursively(safeFull, allowedBase);
        rmdirSync(safeFull);
      }
    }
  }

  for (const entry of readdirSync(sitemapRoot)) {
    const full = join(sitemapRoot, entry);
    const safeFull = assertPathUnder(full, sitemapRoot);
    const stat = statSync(safeFull);
    if (stat.isFile()) {
      unlinkSync(safeFull);
    } else if (stat.isDirectory()) {
      removeDirRecursively(safeFull, sitemapRoot);
      rmdirSync(safeFull);
    }
  }
}
