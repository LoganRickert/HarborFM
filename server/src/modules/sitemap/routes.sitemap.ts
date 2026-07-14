import type { FastifyInstance } from "fastify";
import { readSettings } from "../settings/index.js";
import { assertSafeId } from "../../services/paths.js";
import {
  generateSitemapIndex,
  generateStaticSitemapXml,
  generatePodcastSitemapXml,
  getCachedSitemapIfFresh,
  getCachedSitemapIndexIfFresh,
  writeSitemapToFile,
  writeSitemapIndexToFile,
} from "../../services/sitemap.js";
import { API_PREFIX, RSS_CACHE_MAX_AGE_MS } from "../../config.js";
import { getPodcastByHost } from "../../services/dns/custom-domain-resolver.js";
import {
  getBaseUrl,
  getRequestOrigin,
  requestHost,
  assertSafeSlug,
  SAFE_SLUG,
} from "./utils.js";
import * as repo from "./repo.js";

function sendXml(reply: { header: (k: string, v: string) => unknown; send: (b: string) => unknown }, xml: string) {
  reply.header("Content-Type", "application/xml; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=3600");
  return reply.send(xml);
}

function sitemapApiBase(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${API_PREFIX}`;
}

/** Stale caches may omit /api from child sitemap locs. */
function isUsableSitemapIndexCache(xml: string): boolean {
  return xml.includes(`/${API_PREFIX}/sitemap/`);
}

export async function registerSitemapRoutes(app: FastifyInstance) {
  app.get(
    "/sitemap.xml",
    {
      schema: {
        tags: ["Sitemap"],
        summary: "Sitemap index",
        description:
          "Returns sitemap index XML on the app host. On linked/managed custom domains, returns a single-podcast sitemap for that host. Public, no auth.",
        security: [],
        response: {
          200: { description: "Sitemap XML" },
          404: { description: "Not found" },
          500: { description: "Failed to generate sitemap" },
        },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      const host = requestHost(request);
      const customMatch = getPodcastByHost(host);

      // Linked/managed domain: only that podcast's public pages (/, /episode-slug).
      // Do not use the shared per-podcast cache (those files use /feed/... URLs).
      if (customMatch) {
        if (!settings.public_feeds_enabled) {
          return reply.status(404).send({ error: "Not found" });
        }
        try {
          assertSafeId(customMatch.id, "podcastId");
        } catch {
          return reply.status(404).send({ error: "Not found" });
        }
        try {
          const baseUrl = getRequestOrigin(request);
          const xml = generatePodcastSitemapXml(customMatch.id, baseUrl, {
            customDomain: true,
          });
          return sendXml(reply, xml);
        } catch {
          return reply.status(500).send({ error: "Failed to generate sitemap" });
        }
      }

      const cached = getCachedSitemapIndexIfFresh(RSS_CACHE_MAX_AGE_MS);
      if (cached && isUsableSitemapIndexCache(cached)) {
        return sendXml(reply, cached);
      }
      const apiBase = sitemapApiBase(getBaseUrl(request));
      const lastmod = new Date().toISOString().slice(0, 10);
      const entries: { loc: string; lastmod: string }[] = [
        { loc: `${apiBase}/sitemap/static.xml`, lastmod },
      ];
      if (settings.public_feeds_enabled) {
        const rows = repo.listPublicPodcastSlugs();
        for (const row of rows) {
          if (SAFE_SLUG.test(row.slug)) {
            entries.push({
              loc: `${apiBase}/sitemap/podcast/${encodeURIComponent(row.slug)}.xml`,
              lastmod,
            });
          }
        }
      }
      const xml = generateSitemapIndex(entries);
      writeSitemapIndexToFile(xml);
      return sendXml(reply, xml);
    },
  );

  app.get(
    "/sitemap/static.xml",
    {
      schema: {
        tags: ["Sitemap"],
        summary: "Static sitemap",
        description: "Returns static pages sitemap XML. Public, no auth.",
        security: [],
        response: { 200: { description: "Sitemap XML" } },
      },
    },
    async (request, reply) => {
      const baseUrl = getBaseUrl(request);
      const xml = generateStaticSitemapXml(baseUrl);
      return sendXml(reply, xml);
    },
  );

  app.get(
    "/sitemap/podcast/:slug.xml",
    {
      schema: {
        tags: ["Sitemap"],
        summary: "Podcast sitemap",
        description:
          "Returns sitemap XML for a podcast feed. Public when public feeds enabled.",
        security: [],
        params: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: ["slug"],
        },
        response: {
          200: { description: "Sitemap XML" },
          404: { description: "Not found" },
          500: { description: "Failed to generate sitemap" },
        },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      if (!settings.public_feeds_enabled) {
        return reply.status(404).send({ error: "Not found" });
      }
      const { slug } = request.params as { slug: string };
      try {
        assertSafeSlug(slug);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      const podcastId = repo.getPodcastIdBySlug(slug);
      if (!podcastId) return reply.status(404).send({ error: "Not found" });
      try {
        assertSafeId(podcastId, "podcastId");
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      const baseUrl = getBaseUrl(request);
      try {
        const cached = getCachedSitemapIfFresh(
          podcastId,
          RSS_CACHE_MAX_AGE_MS,
        );
        if (cached) {
          return sendXml(reply, cached);
        }
        const xml = generatePodcastSitemapXml(podcastId, baseUrl);
        writeSitemapToFile(podcastId, xml);
        return sendXml(reply, xml);
      } catch (_err) {
        return reply.status(500).send({ error: "Failed to generate sitemap" });
      }
    },
  );
}
