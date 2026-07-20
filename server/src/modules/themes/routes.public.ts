import type { FastifyInstance, FastifyRequest } from "fastify";
import { createReadStream, existsSync, statSync } from "fs";
import { extname, join } from "path";
import { feedThemePagePublicPathSchema } from "@harborfm/shared";
import { API_PREFIX } from "../../config.js";
import { assertPathUnder } from "../../services/paths.js";
import { getPodcastByHost } from "../../services/dns/custom-domain-resolver.js";
import { getBuiltinThemeDir, userThemeDirPath } from "./paths.js";
import { getThemeById, isServerWideThemeId } from "./repo.js";
import {
  isLiquidFeedTheme,
  renderLiquidPage,
  resolveThemePackage,
  type LiquidPodcastContext,
  type ThemeResolveResult,
} from "./render.js";
import { resolveThemePages, themePageUrls } from "./themePages.js";
import * as publicRepo from "../public/repo.js";
import { readSettings } from "../settings/repo.js";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function asBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  return v === true || v === 1 || v === "1";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function serveThemeAsset(
  reply: import("fastify").FastifyReply,
  themeRoot: string,
  assetPath: string,
) {
  const cleaned = assetPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (
    !cleaned ||
    cleaned.includes("..") ||
    (!cleaned.startsWith("css/") && !cleaned.startsWith("images/"))
  ) {
    return reply.status(404).send({ error: "Not found" });
  }
  const full = join(themeRoot, cleaned);
  try {
    assertPathUnder(full, themeRoot);
  } catch {
    return reply.status(404).send({ error: "Not found" });
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    return reply.status(404).send({ error: "Not found" });
  }
  const ext = extname(full).toLowerCase();
  const type = MIME[ext];
  if (!type) {
    return reply.status(404).send({ error: "Not found" });
  }
  reply.header("Content-Type", type);
  reply.header("Cache-Control", "public, max-age=3600");
  return reply.send(createReadStream(full));
}

const PODCAST_LINK_KEYS = [
  "applePodcastsUrl",
  "spotifyUrl",
  "amazonMusicUrl",
  "podcastIndexUrl",
  "listenNotesUrl",
  "castboxUrl",
  "xUrl",
  "facebookUrl",
  "instagramUrl",
  "tiktokUrl",
  "youtubeUrl",
  "discordUrl",
] as const;

function podcastHasLinks(row: Record<string, unknown>): boolean {
  return PODCAST_LINK_KEYS.some((key) => {
    const url = row[key];
    return typeof url === "string" && url.trim().length > 0;
  });
}

function podcastShowFlags(row: Record<string, unknown>) {
  return {
    author: asBool(row.feedShowAuthor, true),
    podcast_description: asBool(row.feedShowPodcastDescription, true),
    episode_description: asBool(row.feedShowEpisodeDescription, true),
    funding: asBool(row.feedShowFunding, true),
    reviews_podcast: asBool(row.feedShowReviewsPodcast, true),
    reviews_episode: asBool(row.feedShowReviewsEpisode, true),
    podroll: asBool(row.feedShowPodroll, true),
    cast: asBool(row.feedShowCast, true),
    links: podcastHasLinks(row),
  };
}

function requestHost(request: FastifyRequest): string {
  return (
    (request.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim() ||
    request.hostname ||
    ""
  );
}

/** True when this request Host is the podcast's managed/linked domain. */
function isCustomDomainRequest(request: FastifyRequest, podcastSlug: string): boolean {
  const match = getPodcastByHost(requestHost(request));
  return Boolean(match && match.slug === podcastSlug);
}

function feedBasePath(podcastSlug: string, customDomain: boolean): string {
  return customDomain ? "" : `/feed/${encodeURIComponent(podcastSlug)}`;
}

function siteNameFromSettings(): string {
  const settings = readSettings();
  return typeof settings.white_label === "string" && settings.white_label.trim()
    ? settings.white_label.trim()
    : "HarborFM";
}

function podcastArtworkUrl(podcast: {
  id: string;
  artworkUrl?: string | null;
  artworkPath?: string | null;
}): string | null {
  if (podcast.artworkUrl) return podcast.artworkUrl;
  if (podcast.artworkPath) {
    return `/${API_PREFIX}/public/artwork/${podcast.id}/${encodeURIComponent(
      podcast.artworkPath.split(/[/\\]/).pop() || "artwork",
    )}`;
  }
  return null;
}

function buildPodcastLiquidFields(
  podcast: {
    id: string;
    title?: string | null;
    description?: string | null;
    authorName?: string | null;
    artworkUrl?: string | null;
    artworkPath?: string | null;
  },
  slug: string,
) {
  return {
    title: String(podcast.title || ""),
    description: stripHtml(String(podcast.description || "")),
    author_name: String(podcast.authorName || ""),
    artwork_url: podcastArtworkUrl(podcast),
    rss_url: `/${API_PREFIX}/public/podcasts/${encodeURIComponent(slug)}/rss`,
    slug,
  };
}

function buildUrlContext(
  themeRoot: string,
  resolved: Extract<ThemeResolveResult, { ok: true }>,
  slug: string,
  customDomain: boolean,
  episodeSlug?: string,
) {
  const pagesResolved = resolveThemePages(themeRoot);
  const feedBase = feedBasePath(slug, customDomain);
  const home = feedBase || "/";
  const pages = themePageUrls(pagesResolved.pagesByTemplate, feedBase);
  return {
    pagesResolved,
    urls: {
      podcast: home,
      home,
      ...(episodeSlug
        ? {
            episode: customDomain
              ? `/${encodeURIComponent(episodeSlug)}`
              : `/feed/${encodeURIComponent(slug)}/${encodeURIComponent(episodeSlug)}`,
          }
        : {}),
      theme_asset_base: resolved.assetBase,
      pages,
    },
  };
}

export async function themePublicRoutes(app: FastifyInstance) {
  app.get(
    "/public/themes/builtin/:builtinId/assets/*",
    {
      schema: {
        tags: ["Public"],
        summary: "Serve builtin theme static assets (css/images)",
        hide: true,
      },
    },
    async (request, reply) => {
      const { builtinId } = request.params as { builtinId: string; "*": string };
      if (!isServerWideThemeId(builtinId)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const assetPath = (request.params as { "*": string })["*"] || "";
      return serveThemeAsset(reply, getBuiltinThemeDir(builtinId), assetPath);
    },
  );

  app.get(
    "/public/themes/:themeId/assets/*",
    {
      schema: {
        tags: ["Public"],
        summary: "Serve custom theme static assets (css/images)",
        hide: true,
      },
    },
    async (request, reply) => {
      const { themeId } = request.params as { themeId: string; "*": string };
      if (themeId === "builtin") {
        return reply.status(404).send({ error: "Not found" });
      }
      const row = getThemeById(themeId);
      if (!row || row.scope !== "user" || !row.ownerUserId) {
        return reply.status(404).send({ error: "Not found" });
      }
      const root = userThemeDirPath(row.ownerUserId, row.id);
      const assetPath = (request.params as { "*": string })["*"] || "";
      return serveThemeAsset(reply, root, assetPath);
    },
  );

  app.get(
    "/public/podcasts/:slug/theme-render",
    {
      schema: {
        tags: ["Public"],
        summary: "Render podcast page HTML for the podcast theme",
        params: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const podcast = publicRepo.getPodcastBySlug(slug);
      if (!podcast) return reply.status(404).send({ error: "Not found" });
      const feedTheme = String(podcast.feedTheme || "default");
      if (!isLiquidFeedTheme(feedTheme)) {
        return reply.status(400).send({ error: "Podcast does not use a custom page theme" });
      }
      const resolved = resolveThemePackage(
        feedTheme,
        podcast.ownerUserId,
        API_PREFIX,
      );
      if (!resolved.ok) {
        return reply.status(404).send({ error: "Theme not available" });
      }

      const customDomain = isCustomDomainRequest(request, slug);
      const { pagesResolved, urls } = buildUrlContext(
        resolved.root,
        resolved,
        slug,
        customDomain,
      );
      const indexTemplate = pagesResolved.indexTemplate;

      const { rows: episodeRows } = publicRepo.listPublishedEpisodes(podcast.id, {
        limit: 50,
        offset: 0,
        sort: "newest",
        searchPattern: null,
        includeSubscriberOnly: false,
        includeScheduledEpisodes: false,
      });

      const episodes = episodeRows.map((ep) => ({
        id: ep.id,
        title: String(ep.title || ""),
        description: stripHtml(String(ep.description || "")),
        slug: String(ep.slug || ""),
        publish_at: ep.publishAt ?? null,
        artwork_url: ep.artworkUrl ?? null,
        duration_seconds: ep.audioDurationSec ?? null,
      }));

      const show = podcastShowFlags(podcast as unknown as Record<string, unknown>);
      const ctx: LiquidPodcastContext = {
        podcast: buildPodcastLiquidFields(podcast, slug),
        episodes,
        accentId: podcast.feedAccent,
        show,
        urls,
        site: { name: siteNameFromSettings() },
        page: indexTemplate === "podcast" ? "podcast" : indexTemplate,
      };

      try {
        const rendered = await renderLiquidPage(resolved.root, indexTemplate, ctx);
        return {
          themeId: resolved.id,
          html: rendered.html,
          cssHrefs: rendered.cssHrefs,
          accent: podcast.feedAccent || "green",
          indexTemplate,
        };
      } catch (err) {
        request.log.error({ err }, "theme-render podcast failed");
        return reply.status(500).send({ error: "Failed to render theme" });
      }
    },
  );

  app.get(
    "/public/podcasts/:slug/episodes/:episodeSlug/theme-render",
    {
      schema: {
        tags: ["Public"],
        summary: "Render episode page HTML for the podcast theme",
        params: {
          type: "object",
          required: ["slug", "episodeSlug"],
          properties: {
            slug: { type: "string" },
            episodeSlug: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { slug, episodeSlug } = request.params as {
        slug: string;
        episodeSlug: string;
      };
      const podcast = publicRepo.getPodcastBySlug(slug);
      if (!podcast) return reply.status(404).send({ error: "Not found" });
      const feedTheme = String(podcast.feedTheme || "default");
      if (!isLiquidFeedTheme(feedTheme)) {
        return reply.status(400).send({ error: "Podcast does not use a custom page theme" });
      }
      const resolved = resolveThemePackage(
        feedTheme,
        podcast.ownerUserId,
        API_PREFIX,
      );
      if (!resolved.ok) {
        return reply.status(404).send({ error: "Theme not available" });
      }

      const episode = publicRepo.getPublishedEpisodeBySlug(podcast.id, episodeSlug);
      if (!episode) return reply.status(404).send({ error: "Not found" });

      const customDomain = isCustomDomainRequest(request, slug);
      const { urls } = buildUrlContext(
        resolved.root,
        resolved,
        slug,
        customDomain,
        episodeSlug,
      );

      const show = podcastShowFlags(podcast as unknown as Record<string, unknown>);
      const ctx: LiquidPodcastContext = {
        podcast: buildPodcastLiquidFields(podcast, slug),
        episode: {
          id: episode.id,
          title: String(episode.title || ""),
          description: stripHtml(String(episode.description || "")),
          slug: episodeSlug,
          publish_at: episode.publishAt ?? null,
          artwork_url: episode.artworkUrl ?? null,
          duration_seconds: episode.audioDurationSec ?? null,
        },
        accentId: podcast.feedAccent,
        show,
        urls,
        site: { name: siteNameFromSettings() },
        page: "episode",
      };

      try {
        const rendered = await renderLiquidPage(resolved.root, "episode", ctx);
        return {
          themeId: resolved.id,
          html: rendered.html,
          cssHrefs: rendered.cssHrefs,
          accent: podcast.feedAccent || "green",
        };
      } catch (err) {
        request.log.error({ err }, "theme-render episode failed");
        return reply.status(500).send({ error: "Failed to render theme" });
      }
    },
  );

  app.get(
    "/public/podcasts/:slug/theme-render/pages/:pageFile",
    {
      schema: {
        tags: ["Public"],
        summary: "Render a theme extra page (.html) for the podcast theme",
        params: {
          type: "object",
          required: ["slug", "pageFile"],
          properties: {
            slug: { type: "string" },
            pageFile: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { slug, pageFile: rawPageFile } = request.params as {
        slug: string;
        pageFile: string;
      };
      const pageFile = decodeURIComponent(rawPageFile).toLowerCase();
      const pathCheck = feedThemePagePublicPathSchema.safeParse(pageFile);
      if (!pathCheck.success) {
        return reply.status(404).send({ error: "Not found" });
      }

      const podcast = publicRepo.getPodcastBySlug(slug);
      if (!podcast) return reply.status(404).send({ error: "Not found" });
      const feedTheme = String(podcast.feedTheme || "default");
      if (!isLiquidFeedTheme(feedTheme)) {
        return reply.status(400).send({ error: "Podcast does not use a custom page theme" });
      }
      const resolved = resolveThemePackage(
        feedTheme,
        podcast.ownerUserId,
        API_PREFIX,
      );
      if (!resolved.ok) {
        return reply.status(404).send({ error: "Theme not available" });
      }

      const customDomain = isCustomDomainRequest(request, slug);
      const { pagesResolved, urls } = buildUrlContext(
        resolved.root,
        resolved,
        slug,
        customDomain,
      );
      const templateBasename = pagesResolved.templateByPublicPath[pageFile];
      if (!templateBasename) {
        return reply.status(404).send({ error: "Not found" });
      }

      const { rows: episodeRows } = publicRepo.listPublishedEpisodes(podcast.id, {
        limit: 50,
        offset: 0,
        sort: "newest",
        searchPattern: null,
        includeSubscriberOnly: false,
        includeScheduledEpisodes: false,
      });

      const episodes = episodeRows.map((ep) => ({
        id: ep.id,
        title: String(ep.title || ""),
        description: stripHtml(String(ep.description || "")),
        slug: String(ep.slug || ""),
        publish_at: ep.publishAt ?? null,
        artwork_url: ep.artworkUrl ?? null,
        duration_seconds: ep.audioDurationSec ?? null,
      }));

      const show = podcastShowFlags(podcast as unknown as Record<string, unknown>);
      const ctx: LiquidPodcastContext = {
        podcast: buildPodcastLiquidFields(podcast, slug),
        episodes,
        accentId: podcast.feedAccent,
        show,
        urls,
        site: { name: siteNameFromSettings() },
        page: templateBasename,
      };

      try {
        const rendered = await renderLiquidPage(resolved.root, templateBasename, ctx);
        return {
          themeId: resolved.id,
          html: rendered.html,
          cssHrefs: rendered.cssHrefs,
          accent: podcast.feedAccent || "green",
          page: pageFile,
          template: templateBasename,
        };
      } catch (err) {
        request.log.error({ err }, "theme-render page failed");
        return reply.status(500).send({ error: "Failed to render theme" });
      }
    },
  );
}
