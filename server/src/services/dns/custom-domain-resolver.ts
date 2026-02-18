import { db } from "../../db/index.js";
import { readSettings } from "../../modules/settings/index.js";
import { DOMAIN } from "../../config.js";
import type { AppSettings } from "../../modules/settings/routes.js";

/**
 * Get the canonical feed URL for a podcast when it has an active custom domain.
 * Returns https://{domain}/ or null. Uses same "active" logic as getPodcastByHost.
 */
export function getCanonicalFeedUrl(
  row: {
    link_domain?: string | null;
    managed_domain?: string | null;
    managed_sub_domain?: string | null;
  },
  settings: AppSettings,
): string | null {
  const link = row.link_domain?.trim();
  if (link && settings.dns_allow_linking_domain) {
    return `https://${link}/`;
  }
  const managed = row.managed_domain?.trim();
  if (managed && settings.dns_default_allow_domain) {
    return `https://${managed}/`;
  }
  const sub = row.managed_sub_domain?.trim();
  const defaultDomain = (settings.dns_default_domain ?? "").trim();
  if (sub && defaultDomain && settings.dns_default_allow_sub_domain) {
    return `https://${sub}.${defaultDomain}/`;
  }
  return null;
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
    const linkMatch = db
      .prepare(
        "SELECT id, slug FROM podcasts WHERE LOWER(TRIM(link_domain)) = ? AND link_domain IS NOT NULL AND link_domain != ''",
      )
      .get(raw) as { id: string; slug: string } | undefined;
    if (linkMatch) return linkMatch;
  }

  if (settings.dns_default_allow_domain) {
    const managedMatch = db
      .prepare(
        "SELECT id, slug FROM podcasts WHERE LOWER(TRIM(managed_domain)) = ? AND managed_domain IS NOT NULL AND managed_domain != ''",
      )
      .get(raw) as { id: string; slug: string } | undefined;
    if (managedMatch) return managedMatch;
  }

  const defaultDomain = (settings.dns_default_domain ?? "").trim().toLowerCase();
  if (!defaultDomain || !settings.dns_default_allow_sub_domain) return null;
  if (!raw.endsWith(`.${defaultDomain}`) || raw === defaultDomain) return null;
  const sub = raw.slice(0, -defaultDomain.length - 1);
  if (sub === "@") return null; // @ is not a valid DNS subdomain label

  const subMatch = db
    .prepare(
      "SELECT id, slug FROM podcasts WHERE LOWER(TRIM(managed_sub_domain)) = ? AND managed_sub_domain IS NOT NULL AND managed_sub_domain != ''",
    )
    .get(sub) as { id: string; slug: string } | undefined;
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
