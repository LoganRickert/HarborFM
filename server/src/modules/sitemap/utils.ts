import type { FastifyRequest } from "fastify";
import { readSettings } from "../settings/index.js";

/** Request host without port (prefers X-Forwarded-Host). */
export function requestHost(request: FastifyRequest): string {
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

/** Origin of the incoming request (scheme + host), for custom-domain SEO URLs. */
export function getRequestOrigin(request: FastifyRequest): string {
  const protoHeader = request.headers["x-forwarded-proto"];
  const proto =
    (typeof protoHeader === "string"
      ? protoHeader.split(",")[0].trim()
      : request.protocol) || "http";
  const host =
    (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ||
    (request.headers.host as string | undefined)?.split(",")[0]?.trim() ||
    request.hostname ||
    "localhost";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

/** App canonical base URL from settings.hostname, falling back to request origin. */
export function getBaseUrl(request: FastifyRequest): string {
  const settings = readSettings();
  const hostname = (settings.hostname ?? "").trim();
  if (hostname) {
    const url = hostname.startsWith("http") ? hostname : `https://${hostname}`;
    return url.replace(/\/+$/, "");
  }
  return getRequestOrigin(request);
}

/** Only allow slug characters that are safe for path and URL (no path traversal). */
export const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

export function assertSafeSlug(slug: string): void {
  if (!SAFE_SLUG.test(slug)) {
    throw new Error("Invalid slug: disallowed characters");
  }
}
