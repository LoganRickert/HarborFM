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
import { RSS_CACHE_MAX_AGE_MS } from "../../config.js";
import { getBaseUrl, assertSafeSlug, SAFE_SLUG } from "./utils.js";
import * as repo from "./repo.js";

export async function registerSitemapRoutes(app: FastifyInstance) {
  app.get(
    "/sitemap.xml",
    {
      schema: {
        tags: ["Sitemap"],
        summary: "Sitemap index",
        description: "Returns sitemap index XML. Public, no auth.",
        security: [],
        response: { 200: { description: "Sitemap index XML" } },
      },
    },
    async (request, reply) => {
      const cached = getCachedSitemapIndexIfFresh(RSS_CACHE_MAX_AGE_MS);
      if (cached) {
        return reply
          .header("Content-Type", "application/xml; charset=utf-8")
          .header("Cache-Control", "public, max-age=3600")
          .send(cached);
      }
      const baseUrl = getBaseUrl(request);
      const settings = readSettings();
      const lastmod = new Date().toISOString().slice(0, 10);
      const entries: { loc: string; lastmod: string }[] = [
        { loc: `${baseUrl}/sitemap/static.xml`, lastmod },
      ];
      if (settings.public_feeds_enabled) {
        const rows = repo.listPublicPodcastSlugs();
        for (const row of rows) {
          if (SAFE_SLUG.test(row.slug)) {
            entries.push({
              loc: `${baseUrl}/sitemap/podcast/${encodeURIComponent(row.slug)}.xml`,
              lastmod,
            });
          }
        }
      }
      const xml = generateSitemapIndex(entries);
      writeSitemapIndexToFile(xml);
      return reply
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .send(xml);
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
      return reply
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .send(xml);
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
          return reply
            .header("Content-Type", "application/xml; charset=utf-8")
            .header("Cache-Control", "public, max-age=3600")
            .send(cached);
        }
        const xml = generatePodcastSitemapXml(podcastId, baseUrl);
        writeSitemapToFile(podcastId, xml);
        return reply
          .header("Content-Type", "application/xml; charset=utf-8")
          .header("Cache-Control", "public, max-age=3600")
          .send(xml);
      } catch (_err) {
        return reply.status(500).send({ error: "Failed to generate sitemap" });
      }
    },
  );
}
