import type { FastifyInstance, FastifyRequest } from "fastify";
import { createReadStream, existsSync, statSync } from "fs";
import { extname, join } from "path";
import { feedThemePagePublicPathSchema } from "@harborfm/shared";
import { API_PREFIX } from "../../config.js";
import { assertPathUnder } from "../../services/paths.js";
import { getPodcastByHost } from "../../services/dns/custom-domain-resolver.js";
import { getServerThemeDir, userThemeDirPath } from "./paths.js";
import { getThemeById, isServerWideThemeId } from "./repo.js";
import {
  isLiquidFeedTheme,
  renderLiquidPage,
  resolveThemePackage,
  type ThemeResolveResult,
} from "./render.js";
import { resolveThemePages, themePageUrls } from "./themePages.js";
import { buildLiquidThemeContext } from "./liquidContext.js";
import * as publicRepo from "../public/repo.js";
import { readSettings } from "../settings/repo.js";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

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
    (!cleaned.startsWith("css/") &&
      !cleaned.startsWith("images/") &&
      !cleaned.startsWith("fonts/"))
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
        summary: "Serve builtin theme static assets (css/images/fonts)",
        hide: true,
      },
    },
    async (request, reply) => {
      const { builtinId } = request.params as { builtinId: string; "*": string };
      if (!isServerWideThemeId(builtinId)) {
        return reply.status(404).send({ error: "Not found" });
      }
      const assetPath = (request.params as { "*": string })["*"] || "";
      return serveThemeAsset(reply, getServerThemeDir(builtinId), assetPath);
    },
  );

  app.get(
    "/public/themes/:themeId/assets/*",
    {
      schema: {
        tags: ["Public"],
        summary: "Serve custom theme static assets (css/images/fonts)",
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
      const ctx = buildLiquidThemeContext({
        podcast: podcast as Parameters<typeof buildLiquidThemeContext>[0]["podcast"],
        slug,
        page: indexTemplate === "podcast" ? "podcast" : indexTemplate,
        urls,
        siteName: siteNameFromSettings(),
        includeEpisodes: true,
      });

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

      const ctx = buildLiquidThemeContext({
        podcast: podcast as Parameters<typeof buildLiquidThemeContext>[0]["podcast"],
        slug,
        page: "episode",
        urls,
        siteName: siteNameFromSettings(),
        includeEpisodes: false,
        reviewsEpisodeId: episode.id,
        episode: {
          id: episode.id,
          title: String(episode.title || ""),
          description: stripHtml(String(episode.description || "")),
          slug: episodeSlug,
          publish_at: episode.publishAt ?? null,
          artwork_url: episode.artworkUrl ?? null,
          duration_seconds: episode.audioDurationSec ?? null,
        },
      });

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
        const notFoundTemplate = pagesResolved.notFoundTemplate;
        if (!notFoundTemplate) {
          return reply.status(404).send({ error: "Not found" });
        }
        const ctx = buildLiquidThemeContext({
          podcast: podcast as Parameters<typeof buildLiquidThemeContext>[0]["podcast"],
          slug,
          page: notFoundTemplate,
          urls,
          siteName: siteNameFromSettings(),
          includeEpisodes: true,
        });
        try {
          const rendered = await renderLiquidPage(
            resolved.root,
            notFoundTemplate,
            ctx,
          );
          return reply.status(404).send({
            themeId: resolved.id,
            html: rendered.html,
            cssHrefs: rendered.cssHrefs,
            accent: podcast.feedAccent || "green",
            page: pageFile,
            template: notFoundTemplate,
            notFound: true,
          });
        } catch (err) {
          request.log.error({ err }, "theme-render not_found failed");
          return reply.status(404).send({ error: "Not found" });
        }
      }

      const ctx = buildLiquidThemeContext({
        podcast: podcast as Parameters<typeof buildLiquidThemeContext>[0]["podcast"],
        slug,
        page: templateBasename,
        urls,
        siteName: siteNameFromSettings(),
        includeEpisodes: true,
      });

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
