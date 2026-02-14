import { db } from "../../db/index.js";
import { readSettings } from "../../modules/settings/index.js";
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
