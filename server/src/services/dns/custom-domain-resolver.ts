import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { podcasts } from "../../db/schema.js";
import { readSettings } from "../../modules/settings/index.js";
import { DOMAIN } from "../../config.js";
import type { AppSettings } from "../../modules/settings/index.js";

/**
 * Get the canonical feed URL for a podcast when it has an active custom domain.
 * Returns https://{domain}/ or null. Uses same "active" logic as getPodcastByHost.
 */
export function getCanonicalFeedUrl(
  row: {
    linkDomain?: string | null;
    managedDomain?: string | null;
    managedSubDomain?: string | null;
  },
  settings: AppSettings,
): string | null {
  const link = row.linkDomain?.trim();
  if (link && settings.dns_allow_linking_domain) {
    return `https://${link}/`;
  }
  const managed = row.managedDomain?.trim();
  if (managed && settings.dns_default_allow_domain) {
    return `https://${managed}/`;
  }
  const sub = row.managedSubDomain?.trim();
  const defaultDomain = (settings.dns_default_domain ?? "").trim();
  if (sub && defaultDomain && settings.dns_default_allow_sub_domain) {
    return `https://${sub}.${defaultDomain}/`;
  }
  return null;
}

/** Origin (no trailing slash) from getCanonicalFeedUrl, or null. */
export function getCanonicalOrigin(
  row: {
    linkDomain?: string | null;
    managedDomain?: string | null;
    managedSubDomain?: string | null;
  },
  settings: AppSettings,
): string | null {
  const feed = getCanonicalFeedUrl(row, settings);
  if (!feed) return null;
  try {
    return new URL(feed).origin;
  } catch {
    return null;
  }
}

/**
 * Public origin for subscriber-facing links: linked/managed domain when set, else fallback.
 * Trailing slash stripped.
 */
export function resolvePodcastPublicOrigin(
  podcastId: string,
  fallbackOrigin: string,
): string {
  const fallback = fallbackOrigin.replace(/\/+$/, "");
  if (!podcastId.trim()) return fallback;
  const row = drizzleDb
    .select({
      linkDomain: podcasts.linkDomain,
      managedDomain: podcasts.managedDomain,
      managedSubDomain: podcasts.managedSubDomain,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId.trim()))
    .limit(1)
    .get();
  if (!row) return fallback;
  return getCanonicalOrigin(row, readSettings()) ?? fallback;
}

/**
 * Resolve request host to a podcast for custom-domain redirect.
 * Compares host to link_domain and managed_domain (exact, case-insensitive).
 * If no match, uses dns_default_domain: if host is subdomain.default_domain, looks up by managed_sub_domain.
 * Returns podcast id and slug for redirect, or null.
 */
export function getPodcastByHost(host: string): { id: string; slug: string } | null {
  const raw = (host || "").trim().toLowerCase();
  if (!raw) return null;

  const settings = readSettings();
  if (settings.dns_allow_linking_domain) {
    const linkMatch = drizzleDb
      .select({ id: podcasts.id, slug: podcasts.slug })
      .from(podcasts)
      .where(
        and(
          eq(sql`LOWER(TRIM(${podcasts.linkDomain}))`, raw),
          isNotNull(podcasts.linkDomain),
          ne(podcasts.linkDomain, ""),
        ),
      )
      .limit(1)
      .get();
    if (linkMatch) return linkMatch;
  }

  if (settings.dns_default_allow_domain) {
    const managedMatch = drizzleDb
      .select({ id: podcasts.id, slug: podcasts.slug })
      .from(podcasts)
      .where(
        and(
          eq(sql`LOWER(TRIM(${podcasts.managedDomain}))`, raw),
          isNotNull(podcasts.managedDomain),
          ne(podcasts.managedDomain, ""),
        ),
      )
      .limit(1)
      .get();
    if (managedMatch) return managedMatch;
  }

  const defaultDomain = (settings.dns_default_domain ?? "").trim().toLowerCase();
  if (!defaultDomain || !settings.dns_default_allow_sub_domain) return null;
  if (!raw.endsWith(`.${defaultDomain}`) || raw === defaultDomain) return null;
  const sub = raw.slice(0, -defaultDomain.length - 1);
  if (sub === "@") return null; // @ is not a valid DNS subdomain label

  const subMatch = drizzleDb
    .select({ id: podcasts.id, slug: podcasts.slug })
    .from(podcasts)
    .where(
      and(
        eq(sql`LOWER(TRIM(${podcasts.managedSubDomain}))`, sub),
        isNotNull(podcasts.managedSubDomain),
        ne(podcasts.managedSubDomain, ""),
      ),
    )
    .limit(1)
    .get();
  return subMatch ?? null;
}

/**
 * Check if a domain is allowed for TLS (e.g. Caddy on-demand cert issuance).
 * Returns true for: primary domain, hostname, dns_default_domain, dns_default_allow_domains,
 * and any domain that resolves via getPodcastByHost (link_domain, managed_domain, sub.dns_default_domain).
 */
export function isDomainAllowed(domain: string): boolean {
  const raw = (domain || "").trim().toLowerCase();
  if (!raw) return false;

  // Allow localhost/127.0.0.1 so Caddy can serve healthchecks and internal requests (uses self-signed cert, not public CA)
  if (raw === "127.0.0.1" || raw === "localhost" || raw === "::1") return true;

  const settings = readSettings();

  // Primary domain from env (not localhost or wildcard)
  const envDomain = (DOMAIN ?? "").trim().toLowerCase();
  if (envDomain && envDomain !== "localhost" && envDomain !== "_" && raw === envDomain) {
    return true;
  }

  // Admin-configured hostname (may be URL like https://example.com)
  const hostnameRaw = (settings.hostname ?? "").trim().toLowerCase();
  if (hostnameRaw) {
    let hostFromHostname = hostnameRaw;
    try {
      if (hostnameRaw.startsWith("http://") || hostnameRaw.startsWith("https://")) {
        const u = new URL(hostnameRaw);
        hostFromHostname = u.hostname;
      }
    } catch {
      /* ignore parse errors */
    }
    if (raw === hostFromHostname) return true;
  }

  // Base domain for subdomains
  const defaultDomain = (settings.dns_default_domain ?? "").trim().toLowerCase();
  if (defaultDomain && raw === defaultDomain) return true;

  // Allowlist of extra domains
  const allowDomainsRaw = settings.dns_default_allow_domains ?? "[]";
  try {
    const parsed = JSON.parse(allowDomainsRaw) as unknown;
    const arr = Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
    if (arr.some((d) => (d || "").trim().toLowerCase() === raw)) return true;
  } catch {
    // ignore invalid JSON
  }

  // Link domain, managed domain, or subdomain of dns_default_domain
  return getPodcastByHost(raw) !== null;
}
