import type { FastifyRequest } from "fastify";
import { readSettings } from "../settings/index.js";

export function getBaseUrl(request: FastifyRequest): string {
  const settings = readSettings();
  const hostname = (settings.hostname ?? "").trim();
  if (hostname) {
    const url = hostname.startsWith("http") ? hostname : `https://${hostname}`;
    return url.replace(/\/+$/, "");
  }
  const proto =
    request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const host =
    (request.headers["x-forwarded-host"] as string) ||
    request.hostname ||
    "localhost";
  return `${proto}://${host}`;
}

/** Only allow slug characters that are safe for path and URL (no path traversal). */
export const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

export function assertSafeSlug(slug: string): void {
  if (!SAFE_SLUG.test(slug)) {
    throw new Error("Invalid slug: disallowed characters");
  }
}
