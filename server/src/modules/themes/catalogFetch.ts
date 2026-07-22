import {
  FEED_THEME_ZIP_MAX_BYTES,
  themeCatalogDocumentSchema,
  type ThemeCatalogDocument,
} from "@harborfm/shared";
import {
  THEME_CATALOG_CACHE_TTL_MS,
  THEME_CATALOG_FETCH_TIMEOUT_MS,
  THEME_CATALOG_MAX_BYTES,
  THEME_CATALOG_USER_AGENT,
} from "../../config.js";
import { assertUrlNotPrivate } from "../../utils/ssrf.js";
import { ThemeImportError } from "./importTheme.js";

type CatalogCacheEntry = {
  expiresAt: number;
  document: ThemeCatalogDocument;
};

const catalogCache = new Map<string, CatalogCacheEntry>();

function cacheKey(url: string): string {
  return url.trim();
}

async function fetchBytes(
  url: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; finalUrl: string }> {
  await assertUrlNotPrivate(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THEME_CATALOG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/json, application/zip, application/octet-stream, */*",
        "User-Agent": THEME_CATALOG_USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new ThemeImportError(
        `Failed to fetch catalog resource (${res.status})`,
        502,
      );
    }
    const finalUrl = res.url || url;
    // Re-check after redirects (SSRF).
    await assertUrlNotPrivate(finalUrl);

    const reader = res.body?.getReader();
    if (!reader) {
      const ab = await res.arrayBuffer();
      if (ab.byteLength > maxBytes) {
        throw new ThemeImportError("Remote file is too large", 413);
      }
      return { buffer: Buffer.from(ab), finalUrl };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      total += buf.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new ThemeImportError("Remote file is too large", 413);
      }
      chunks.push(buf);
    }
    return { buffer: Buffer.concat(chunks), finalUrl };
  } catch (err) {
    if (err instanceof ThemeImportError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ThemeImportError("Timed out fetching catalog resource", 504);
    }
    const message =
      err instanceof Error ? err.message : "Failed to fetch catalog resource";
    if (
      message.includes("private") ||
      message.includes("not allowed") ||
      message.includes("Invalid URL")
    ) {
      throw new ThemeImportError(message, 400);
    }
    throw new ThemeImportError(message, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchThemeCatalogDocument(
  url: string,
  opts?: { bypassCache?: boolean },
): Promise<ThemeCatalogDocument> {
  const key = cacheKey(url);
  if (!opts?.bypassCache) {
    const hit = catalogCache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.document;
    }
  }

  const { buffer } = await fetchBytes(url, THEME_CATALOG_MAX_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ThemeImportError("Catalog URL did not return valid JSON", 400);
  }

  // Accept catalogs that omit `name` by defaulting (older published catalogs).
  const withName =
    json &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    (!(json as { name?: unknown }).name ||
      typeof (json as { name?: unknown }).name !== "string")
      ? { ...(json as Record<string, unknown>), name: "Theme catalog" }
      : json;

  const parsed = themeCatalogDocumentSchema.safeParse(withName);
  if (!parsed.success) {
    throw new ThemeImportError(
      parsed.error.issues[0]?.message ?? "Invalid catalog.json",
      400,
    );
  }

  catalogCache.set(key, {
    expiresAt: Date.now() + THEME_CATALOG_CACHE_TTL_MS,
    document: parsed.data,
  });
  return parsed.data;
}

export async function fetchThemeZipFromUrl(url: string): Promise<Buffer> {
  const { buffer } = await fetchBytes(url, FEED_THEME_ZIP_MAX_BYTES);
  return buffer;
}

export function clearThemeCatalogCache(): void {
  catalogCache.clear();
}
