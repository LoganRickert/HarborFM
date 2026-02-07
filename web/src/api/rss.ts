import { apiPost } from './client';

export function generateRss(podcastId: string, publicBaseUrl?: string | null) {
  return apiPost<{ path: string; message: string }>(`/podcasts/${podcastId}/generate-rss`, {
    public_base_url: publicBaseUrl ?? undefined,
  });
}

export function getPublicRssUrl(podcastSlug: string): string {
  return `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/rss`;
}

export function getAuthRssPreviewUrl(podcastId: string, publicBaseUrl?: string | null): string {
  const params = new URLSearchParams();
  if (publicBaseUrl) params.set('public_base_url', publicBaseUrl);
  const q = params.toString();
  return `/api/podcasts/${encodeURIComponent(podcastId)}/rss-preview${q ? `?${q}` : ''}`;
}
