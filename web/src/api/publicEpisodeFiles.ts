import type { EpisodeFileItem, EpisodeFilesListResponse } from '@harborfm/shared';

const BASE = '/api';

export type PublicEpisodeFileItem = EpisodeFileItem;

export function getPublicEpisodeFiles(
  podcastSlug: string,
  episodeSlug: string,
): Promise<EpisodeFilesListResponse> {
  return fetch(
    `${BASE}/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/files`,
  ).then((r) => {
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
    return r.json();
  });
}
