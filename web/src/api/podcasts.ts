import type { PodcastAnalyticsQuery, PodcastCreate, PodcastUpdate, PodcastsListQuery } from '@harborfm/shared';
import { apiGet, apiPost, apiPatch, apiDelete, csrfHeaders } from './client';

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
  subtitle: string | null;
  summary: string | null;
  language: string;
  author_name: string;
  owner_name: string;
  email: string;
  category_primary: string;
  category_secondary: string | null;
  category_primary_two: string | null;
  category_secondary_two: string | null;
  category_primary_three: string | null;
  category_secondary_three: string | null;
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
  funding_url: string | null;
  funding_label: string | null;
  persons: string | null;
  update_frequency_rrule: string | null;
  update_frequency_label: string | null;
  spotify_recent_count: number | null;
  spotify_country_of_origin: string | null;
  apple_podcasts_verify: string | null;
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
  effective_max_subscriber_tokens?: number | null;
  /** 1 = unlisted (not on /feed or sitemap). */
  unlisted?: number;
  /** 1 = subscriber-only feed enabled (tokens can be created). */
  subscriber_only_feed_enabled?: number;
  /** 1 = public feed disabled (only tokenized subscriber feed works). */
  public_feed_disabled?: number;
  /** 1 = podcast owner has transcription permission (for graying out Generate Transcript when not). */
  owner_can_transcribe?: number;
  /** DNS: link domain (hostname). */
  link_domain?: string | null;
  /** DNS: managed domain (hostname). */
  managed_domain?: string | null;
  /** DNS: managed sub-domain. */
  managed_sub_domain?: string | null;
  /** True when podcast has a Cloudflare API key set (key never sent to client). */
  cloudflare_api_key_set?: boolean;
  /** Client-only: new API key when editing (sent in PATCH; never returned by API). */
  cloudflare_api_key?: string;
  /** DNS config from server settings (allow toggles and default domain list for edit UI). */
  dns_config?: {
    allow_linking_domain: boolean;
    allow_domain: boolean;
    allow_domains: string[];
    default_domain: string;
    allow_sub_domain: boolean;
    allow_custom_key: boolean;
  };
}

export interface PodcastsResponse {
  podcasts: Podcast[];
  total: number;
}

export function listPodcasts(params?: PodcastsListQuery) {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.q) search.set('q', params.q);
  if (params?.sort) search.set('sort', params.sort);
  const query = search.toString();
  return apiGet<PodcastsResponse>(`/podcasts${query ? `?${query}` : ''}`);
}

export function listPodcastsForUser(userId: string, params?: PodcastsListQuery) {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.q) search.set('q', params.q);
  if (params?.sort) search.set('sort', params.sort);
  const query = search.toString();
  return apiGet<PodcastsResponse>(`/podcasts/user/${userId}${query ? `?${query}` : ''}`);
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

export function getPodcastAnalytics(podcastId: string, params?: PodcastAnalyticsQuery) {
  const search = new URLSearchParams();
  if (params?.start_date) search.set('start_date', params.start_date);
  if (params?.end_date) search.set('end_date', params.end_date);
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const query = search.toString();
  return apiGet<PodcastAnalytics>(`/podcasts/${podcastId}/analytics${query ? `?${query}` : ''}`);
}

export function createPodcast(body: PodcastCreate) {
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

export interface ImportStatus {
  status: 'idle' | 'pending' | 'importing' | 'done' | 'failed';
  message?: string;
  error?: string;
  current_episode?: number;
  total_episodes?: number;
}

/** Start importing a podcast from an RSS/Atom feed URL. Returns 202 with podcast_id; poll getImportStatus for progress. */
export function startImportPodcast(feedUrl: string) {
  return apiPost<{ podcast_id: string }>('/podcasts/import', { feed_url: feedUrl });
}

export function getImportStatus(podcastId: string) {
  return apiGet<ImportStatus>(`/podcasts/${podcastId}/import-status`);
}

export interface ActiveImportStatus {
  status: 'idle' | 'pending' | 'importing' | 'done' | 'failed';
  podcast_id?: string;
  message?: string;
  error?: string;
  current_episode?: number;
  total_episodes?: number;
}

/** Get the current user's in-progress import, if any. Use on Dashboard load to restore the import popup after refresh. */
export function getActiveImport() {
  return apiGet<ActiveImportStatus>('/podcasts/import-status');
}

export function updatePodcast(id: string, body: PodcastUpdate) {
  return apiPatch<Podcast>(`/podcasts/${id}`, body);
}

// Subscriber tokens (private RSS)
export interface SubscriberToken {
  id: string;
  name: string;
  created_at: string;
  valid_from: string | null;
  valid_until: string | null;
  disabled: number;
  last_used_at: string | null;
}

export function listSubscriberTokens(
  podcastId: string,
  params?: { limit?: number; offset?: number; q?: string; sort?: 'newest' | 'oldest' }
) {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.q) searchParams.set('q', params.q);
  if (params?.sort) searchParams.set('sort', params.sort);
  const query = searchParams.toString();
  const url = `/podcasts/${podcastId}/subscriber-tokens${query ? `?${query}` : ''}`;
  return apiGet<{ tokens: SubscriberToken[]; total: number }>(url);
}

export function createSubscriberToken(
  podcastId: string,
  body: { name: string; valid_from?: string; valid_until?: string }
) {
  return apiPost<SubscriberToken & { token: string }>(`/podcasts/${podcastId}/subscriber-tokens`, body);
}

export function updateSubscriberToken(
  podcastId: string,
  tokenId: string,
  body: { disabled?: boolean; valid_until?: string; valid_from?: string }
) {
  return apiPatch<SubscriberToken>(`/podcasts/${podcastId}/subscriber-tokens/${tokenId}`, body);
}

export function deleteSubscriberToken(podcastId: string, tokenId: string) {
  return apiDelete(`/podcasts/${podcastId}/subscriber-tokens/${tokenId}`);
}
