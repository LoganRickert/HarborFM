import type { FastifyRequest } from "fastify";
import { readSettings } from "../settings/repo.js";
import { API_PREFIX } from "../../config.js";

/**
 * Absolute API base for workers (includes /api, no trailing slash).
 * Prefers Settings hostname when set.
 */
export function workerApiBaseFromRequest(request: FastifyRequest): string {
  const settings = readSettings();
  const host = (settings.hostname || "").trim().replace(/\/+$/, "");
  const prefix = `/${API_PREFIX.replace(/^\/+/, "")}`;
  if (host) {
    const withProto = /^https?:\/\//i.test(host) ? host : `https://${host}`;
    return `${withProto.replace(/\/+$/, "")}${prefix}`;
  }
  const proto =
    (request.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() ||
    request.protocol ||
    "http";
  const hostname =
    (request.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim() ||
    request.hostname;
  return `${proto}://${hostname}${prefix}`;
}
