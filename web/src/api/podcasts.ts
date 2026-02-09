import { apiGet, apiPost, apiPatch, csrfHeaders } from './client';

const BASE = '/api';

export interface Podcast {
  id: string;
  owner_user_id: string;
  title: string;
  slug: string;
  description: string;
  language: string;
  author_name: string;
  owner_name: string;
  email: string;
  category_primary: string;
  category_secondary: string | null;
  category_tertiary: string | null;
  explicit: number;
  artwork_path: string | null;
  artwork_filename: string | null;
  artwork_url: string | null;
  site_url: string | null;
  copyright: string | null;
  podcast_guid: string | null;
  locked: number;
  license: string | null;
  itunes_type: 'episodic' | 'serial';
  medium: 'podcast' | 'music' | 'video' | 'film' | 'audiobook' | 'newsletter' | 'blog';
  created_at: string;
  updated_at: string;
}

export interface PodcastsResponse {
  podcasts: Podcast[];
}

export function listPodcasts() {
  return apiGet<PodcastsResponse>('/podcasts');
}

export function listPodcastsForUser(userId: string) {
  return apiGet<PodcastsResponse>(`/podcasts/user/${userId}`);
}

export function getPodcast(id: string) {
  return apiGet<Podcast>(`/podcasts/${id}`);
}

export function createPodcast(body: {
  title: string;
  slug: string;
  description?: string;
  language?: string;
  author_name?: string;
  owner_name?: string;
  email?: string;
  category_primary?: string;
  category_secondary?: string | null;
  category_tertiary?: string | null;
  explicit?: 0 | 1;
  site_url?: string | null;
  artwork_url?: string | null;
  copyright?: string | null;
  podcast_guid?: string | null;
  locked?: 0 | 1;
  license?: string | null;
  itunes_type?: 'episodic' | 'serial';
  medium?: 'podcast' | 'music' | 'video' | 'film' | 'audiobook' | 'newsletter' | 'blog';
}) {
  return apiPost<Podcast>('/podcasts', body);
}

export async function uploadPodcastArtwork(podcastId: string, file: File): Promise<Podcast> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/podcasts/${podcastId}/artwork`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

export function updatePodcast(
  id: string,
  body: Partial<{
    title: string;
    slug: string;
    description: string;
    language: string;
    author_name: string;
    owner_name: string;
    email: string;
    category_primary: string;
    category_secondary: string | null;
    category_tertiary: string | null;
    explicit: number;
    site_url: string | null;
    artwork_url: string | null;
    copyright: string | null;
    podcast_guid: string | null;
    locked: number;
    license: string | null;
    itunes_type: 'episodic' | 'serial';
    medium: 'podcast' | 'music' | 'video' | 'film' | 'audiobook' | 'newsletter' | 'blog';
  }>
) {
  return apiPatch<Podcast>(`/podcasts/${id}`, body);
}
