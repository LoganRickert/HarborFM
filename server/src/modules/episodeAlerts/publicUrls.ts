import { basename } from "path";
import { eq } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { podcasts } from "../../db/schema.js";
import { getBaseUrl } from "../auth/shared.js";
import { readSettings } from "../settings/index.js";
import { getCanonicalFeedUrl } from "../../services/dns/custom-domain-resolver.js";
import type { EpisodeForAlert } from "./repo.js";

/**
 * Public origin for episode-alert links: linked/managed domain when set, else app hostname.
 */
export function getEpisodeAlertPublicOrigin(podcastId: string): string {
  const fallback = getBaseUrl();
  const row = drizzleDb
    .select({
      linkDomain: podcasts.linkDomain,
      managedDomain: podcasts.managedDomain,
      managedSubDomain: podcasts.managedSubDomain,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!row) return fallback;
  const canonical = getCanonicalFeedUrl(row, readSettings());
  if (!canonical) return fallback;
  try {
    return new URL(canonical).origin;
  } catch {
    return fallback;
  }
}

/** True when the podcast serves its public feed on a custom domain (not /feed/:slug). */
export function podcastUsesCustomDomainFeed(podcastId: string): boolean {
  const row = drizzleDb
    .select({
      linkDomain: podcasts.linkDomain,
      managedDomain: podcasts.managedDomain,
      managedSubDomain: podcasts.managedSubDomain,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!row) return false;
  return Boolean(getCanonicalFeedUrl(row, readSettings()));
}

export function buildEpisodeAlertFeedUrl(
  podcastId: string,
  slug: string,
  query?: string,
): string {
  const origin = getEpisodeAlertPublicOrigin(podcastId);
  const qs = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  if (podcastUsesCustomDomainFeed(podcastId)) {
    return `${origin}/${qs}`;
  }
  return `${origin}/feed/${encodeURIComponent(slug)}${qs}`;
}

export function buildEpisodeAlertEpisodeUrl(
  podcastId: string,
  podcastSlug: string,
  episodeSlug: string | null,
): string {
  const origin = getEpisodeAlertPublicOrigin(podcastId);
  if (!episodeSlug) {
    return buildEpisodeAlertFeedUrl(podcastId, podcastSlug);
  }
  if (podcastUsesCustomDomainFeed(podcastId)) {
    return `${origin}/${encodeURIComponent(episodeSlug)}`;
  }
  return `${origin}/feed/${encodeURIComponent(podcastSlug)}/${encodeURIComponent(episodeSlug)}`;
}

function absoluteOrNull(url: string | null | undefined): string | null {
  const t = url?.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return null;
}

/** Episode art first, then podcast cover. Absolute URL for email/community embeds. */
export function buildEpisodeAlertArtworkUrl(episode: EpisodeForAlert): string | null {
  const origin = getEpisodeAlertPublicOrigin(episode.podcastId);
  const episodeExt = absoluteOrNull(episode.artworkUrl);
  if (episodeExt) return episodeExt;
  if (episode.artworkPath) {
    const file = basename(episode.artworkPath);
    if (file) {
      return `${origin}/api/public/artwork/${encodeURIComponent(episode.podcastId)}/episodes/${encodeURIComponent(episode.id)}/${encodeURIComponent(file)}`;
    }
  }
  const podcastExt = absoluteOrNull(episode.podcastArtworkUrl);
  if (podcastExt) return podcastExt;
  if (episode.podcastArtworkPath) {
    const file = basename(episode.podcastArtworkPath);
    if (file) {
      return `${origin}/api/public/artwork/${encodeURIComponent(episode.podcastId)}/${encodeURIComponent(file)}`;
    }
  }
  return null;
}
