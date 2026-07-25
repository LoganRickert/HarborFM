import { apiPost } from './client';

export function generateRss(podcastId: string, publicBaseUrl?: string | null) {
  return apiPost<{ path: string; message: string }>(`/podcasts/${podcastId}/generate-rss`, {
    publicBaseUrl: publicBaseUrl ?? undefined,
  });
}

export function getPublicRssUrl(podcastSlug: string): string {
  return `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/rss`;
}

/**
 * Absolute public RSS feed URL. Prefers managed/linked domain when canonicalFeedUrl is set.
 */
export function buildAbsolutePublicRssUrl(
  podcastSlug: string,
  canonicalFeedUrl?: string | null,
): string {
  const path = getPublicRssUrl(podcastSlug);
  const canonical = canonicalFeedUrl?.trim();
  if (canonical) {
    try {
      return `${new URL(canonical).origin}${path}`;
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export function getAuthRssPreviewUrl(podcastId: string, publicBaseUrl?: string | null): string {
  const params = new URLSearchParams();
  if (publicBaseUrl) params.set('publicBaseUrl', publicBaseUrl);
  const q = params.toString();
  return `/api/podcasts/${encodeURIComponent(podcastId)}/rss-preview${q ? `?${q}` : ''}`;
}
