import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  API_PREFIX,
  APP_NAME,
  PUBLIC_DIR as CONFIG_PUBLIC_DIR,
} from "../config.js";
import { getPodcastByHost } from "./dns/custom-domain-resolver.js";
import * as repo from "../modules/public/repo.js";
import { publicPodcastDto } from "../modules/public/utils.js";
import { readSettings } from "../modules/settings/index.js";

const SHORT_NAME_MAX = 12;

function shortNameFromTitle(title: string): string {
  const t = title.trim();
  if (!t) return "Podcast";
  if (t.length <= SHORT_NAME_MAX) return t;
  return t.slice(0, SHORT_NAME_MAX).trimEnd();
}

function defaultAppManifest(): Record<string, unknown> {
  return {
    name: APP_NAME,
    short_name: shortNameFromTitle(APP_NAME),
    description:
      "Create and manage your podcast with ease. Record, edit, and publish episodes.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0e12",
    theme_color: "#00d4aa",
    orientation: "any",
    icons: [
      {
        src: "/favicon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}

function requestHost(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-host"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().split(":")[0];
  }
  const hostHeader = request.headers.host;
  if (typeof hostHeader === "string" && hostHeader.trim()) {
    return hostHeader.split(",")[0].trim().split(":")[0];
  }
  return (request.hostname ?? "").split(":")[0];
}

function requestOrigin(request: FastifyRequest): string {
  const protoHeader = request.headers["x-forwarded-proto"];
  const proto =
    (typeof protoHeader === "string"
      ? protoHeader.split(",")[0]
      : request.protocol) ?? "http";
  const hostHeader =
    request.headers["x-forwarded-host"] ??
    request.headers.host ??
    request.hostname;
  const host =
    (typeof hostHeader === "string"
      ? hostHeader.split(",")[0]
      : request.hostname) ?? request.hostname;
  return `${proto}://${host}`;
}

function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, origin).href;
}

function podcastCoverUrl(
  origin: string,
  dto: Record<string, unknown>,
): string | null {
  if (dto.artwork_url) {
    return absoluteUrl(origin, String(dto.artwork_url));
  }
  if (dto.artwork_filename && dto.id) {
    return absoluteUrl(
      origin,
      `/${API_PREFIX}/public/artwork/${String(dto.id)}/${encodeURIComponent(String(dto.artwork_filename))}`,
    );
  }
  return null;
}

function iconTypeForUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".svg")) return "image/svg+xml";
  return "image/png";
}

function buildPodcastManifest(
  request: FastifyRequest,
  podcastRow: NonNullable<ReturnType<typeof repo.getPodcastBySlug>>,
): Record<string, unknown> {
  const origin = requestOrigin(request);
  const dto = publicPodcastDto(podcastRow) as Record<string, unknown>;
  const title = String(podcastRow.title ?? "").trim() || "Podcast";
  const defaults = defaultAppManifest();
  const description =
    String(podcastRow.description ?? "").trim() ||
    String(defaults.description);
  const cover = podcastCoverUrl(origin, dto);
  const iconSrc = cover ?? absoluteUrl(origin, "/favicon.png");
  const iconType = cover ? iconTypeForUrl(cover) : "image/png";

  return {
    name: title,
    short_name: shortNameFromTitle(title),
    description,
    start_url: "/",
    display: "standalone",
    background_color: defaults.background_color,
    theme_color: defaults.theme_color,
    orientation: "any",
    icons: [
      {
        src: iconSrc,
        sizes: "192x192",
        type: iconType,
        purpose: "any",
      },
      {
        src: iconSrc,
        sizes: "512x512",
        type: iconType,
        purpose: "any",
      },
    ],
  };
}

function loadStaticAppManifest(): Record<string, unknown> {
  const defaults = defaultAppManifest();
  const path = join(CONFIG_PUBLIC_DIR, "manifest.webmanifest");
  if (existsSync(path)) {
    try {
      const fromDisk = JSON.parse(
        readFileSync(path, "utf8"),
      ) as Record<string, unknown>;
      return {
        ...defaults,
        ...fromDisk,
        // Always follow APP_NAME so white-label env wins over a baked static file.
        name: APP_NAME,
        short_name: shortNameFromTitle(APP_NAME),
      };
    } catch {
      /* fall through */
    }
  }
  return defaults;
}

/**
 * Host-aware web app manifest: podcast branding on linked/managed domains,
 * APP_NAME branding on the app host.
 */
export async function registerPwaManifestRoute(app: FastifyInstance) {
  app.get("/manifest.webmanifest", async (request, reply) => {
    let body: Record<string, unknown> = loadStaticAppManifest();

    if (readSettings().public_feeds_enabled) {
      const hostMatch = getPodcastByHost(requestHost(request));
      if (hostMatch) {
        const podcastRow = repo.getPodcastBySlug(hostMatch.slug);
        if (
          podcastRow &&
          !(
            podcastRow.publicFeedDisabled === 1 &&
            podcastRow.subscriberOnlyFeedEnabled !== 1
          )
        ) {
          body = buildPodcastManifest(request, podcastRow);
        }
      }
    }

    return reply
      .header("Content-Type", "application/manifest+json; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(body);
  });
}
