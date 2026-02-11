import { apiGet, apiPost, apiPatch, csrfHeaders } from './client';

/** Thrown by addCollaborator when response is not ok; may include data from body (e.g. USER_NOT_FOUND). */
export class CollaboratorApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: { code?: string; email?: string; error?: string }
  ) {
    super(message);
    this.name = 'CollaboratorApiError';
  }
}

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
  max_episodes?: number | null;
  episode_count?: number;
  my_role?: 'owner' | 'view' | 'editor' | 'manager';
  is_shared?: boolean;
  max_collaborators?: number | null;
  /** Whether the podcast owner has at least 5 MB free for recording (used for Record new section). */
  can_record_new_section?: boolean;
  /** Effective max collaborators (podcast or owner limit). Used to hide add form when at limit. */
  effective_max_collaborators?: number | null;
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

export interface PodcastAnalytics {
  rss_daily: Array<{ stat_date: string; bot_count: number; human_count: number }>;
  episodes: Array<{ id: string; title: string; slug: string | null }>;
  episode_daily: Array<{
    episode_id: string;
    stat_date: string;
    bot_count: number;
    human_count: number;
  }>;
  episode_location_daily: Array<{
    episode_id: string;
    stat_date: string;
    location: string;
    bot_count: number;
    human_count: number;
  }>;
  episode_listens_daily: Array<{
    episode_id: string;
    stat_date: string;
    bot_count: number;
    human_count: number;
  }>;
}

export function getPodcastAnalytics(podcastId: string) {
  return apiGet<PodcastAnalytics>(`/podcasts/${podcastId}/analytics`);
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

export interface Collaborator {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

export function listCollaborators(podcastId: string) {
  return apiGet<{ collaborators: Collaborator[] }>(`/podcasts/${podcastId}/collaborators`);
}

export async function addCollaborator(podcastId: string, body: { email: string; role: string }): Promise<Collaborator> {
  const res = await fetch(`/api/podcasts/${podcastId}/collaborators`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new CollaboratorApiError(
      (data as { error?: string }).error ?? res.statusText,
      res.status,
      data as { code?: string; email?: string }
    );
  }
  return data as Collaborator;
}

export function updateCollaborator(podcastId: string, userId: string, body: { role: string }) {
  return apiPatch<Collaborator>(`/podcasts/${podcastId}/collaborators/${userId}`, body);
}

export function removeCollaborator(podcastId: string, userId: string) {
  return fetch(`/api/podcasts/${podcastId}/collaborators/${userId}`, { method: 'DELETE', credentials: 'include', headers: csrfHeaders() }).then((r) => {
    if (!r.ok) return r.json().then((j) => Promise.reject(new Error((j as { error?: string }).error ?? r.statusText)));
    return undefined;
  });
}

export function inviteToPlatform(body: { email: string }) {
  return apiPost<{ ok: boolean }>('/invite-to-platform', body);
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
