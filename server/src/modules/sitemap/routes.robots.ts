import type { FastifyInstance } from "fastify";
import { API_PREFIX } from "../../config.js";
import { getPodcastByHost } from "../../services/dns/custom-domain-resolver.js";
import { getBaseUrl, getRequestOrigin, requestHost } from "./utils.js";

const ROBOTS_DISALLOW = [
  "/setup",
  "/login",
  "/register",
  "/reset-password",
  "/api/docs",
  "/podcasts",
  "/library",
  "/messages",
  "/users",
  "/settings",
  "/profile",
];

/**
 * Build robots.txt body. Sitemap always uses an absolute URL for the active host
 * (custom domain origin, or app settings hostname on the primary host).
 */
export function buildRobotsTxt(sitemapUrl: string): string {
  const lines = ["User-agent: *", ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`), "", `Sitemap: ${sitemapUrl}`, ""];
  return lines.join("\n");
}

export async function registerRobotsRoute(app: FastifyInstance) {
  app.get(
    "/robots.txt",
    {
      schema: {
        tags: ["Sitemap"],
        summary: "robots.txt",
        description:
          "Returns robots.txt. On linked/managed domains the Sitemap directive points at that domain's API sitemap.",
        security: [],
        response: { 200: { description: "robots.txt" } },
      },
    },
    async (request, reply) => {
      const host = requestHost(request);
      const customMatch = getPodcastByHost(host);
      const origin = customMatch ? getRequestOrigin(request) : getBaseUrl(request);
      const sitemapUrl = `${origin.replace(/\/+$/, "")}/${API_PREFIX}/sitemap.xml`;
      const body = buildRobotsTxt(sitemapUrl);
      return reply
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .send(body);
    },
  );
}
