import type { PodcastAnalyticsQuery, PodcastCreate, PodcastUpdate, PodcastsListQuery } from '@harborfm/shared';
import type { CastCreate, CastResponse, CastUpdate } from '@harborfm/shared';
import { apiGet, apiPost, apiPatch, apiDelete, csrfHeaders } from './client';

/** Thrown by addCollaborator when response is not ok; may include data from body (e.g. USER_NOT_FOUND). */
export class CollaboratorApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: { code?: string; email?: string; error?: string; canInviteToPlatform?: boolean }
  ) {
    super(message);
    this.name = 'CollaboratorApiError';
  }
}

const BASE = '/api';

export interface Podcast {
  id: string;
  ownerUserId: string;
  title: string;
  slug: string;
  description: string;
  subtitle: string | null;
  summary: string | null;
  language: string;
  authorName: string;
  ownerName: string;
  email: string;
  categoryPrimary: string;
  categorySecondary: string | null;
  categoryPrimaryTwo: string | null;
  categorySecondaryTwo: string | null;
  categoryPrimaryThree: string | null;
  categorySecondaryThree: string | null;
  explicit: number;
  artworkPath: string | null;
  artworkFilename: string | null;
  artworkUrl: string | null;
  siteUrl: string | null;
  copyright: string | null;
  podcastGuid: string | null;
  locked: number;
  license: string | null;
  itunesType: 'episodic' | 'serial';
  medium: 'podcast' | 'music' | 'video' | 'film' | 'audiobook' | 'newsletter' | 'blog';
  fundingUrl: string | null;
  fundingLabel: string | null;
  persons: string | null;
  updateFrequencyRrule: string | null;
  updateFrequencyLabel: string | null;
  spotifyRecentCount: number | null;
  spotifyCountryOfOrigin: string | null;
  applePodcastsVerify: string | null;
  createdAt: string;
  updatedAt: string;
  maxEpisodes?: number | null;
  episodeCount?: number;
  myRole?: 'owner' | 'view' | 'editor' | 'manager';
  isShared?: boolean;
  maxCollaborators?: number | null;
  /** Whether the podcast owner has at least 5 MB free for recording (used for Record new section). */
  canRecordNewSection?: boolean;
  /** Effective max collaborators (podcast or owner limit). Used to hide add form when at limit. */
  effectiveMaxCollaborators?: number | null;
  effectiveMaxSubscriberTokens?: number | null;
  /** 1 = unlisted (not on /feed or sitemap). */
  unlisted?: number;
  /** Subscriber-only feed enabled (tokens can be created). */
  subscriberOnlyFeedEnabled?: boolean;
  /** Public feed disabled (only tokenized subscriber feed works). */
  publicFeedDisabled?: boolean;
  /** Allow unapproved reviews to be shown on public feed (default true). */
  allowUnapprovedReviews?: number | boolean;
  /** Only subscribers can leave reviews (requires subscriberOnlyFeedEnabled). */
  subscriberOnlyReviews?: number | boolean;
  /** Only subscribers can see/use Message button and submit contact (requires subscriberOnlyFeedEnabled). */
  subscriberOnlyMessages?: number | boolean;
  /** When true, future-dated scheduled/published episodes appear on the public feed with a placeholder. */
  showScheduledEpisodes?: number | boolean;
  /** 1 = podcast owner has transcription permission (for graying out Generate Transcript when not). */
  ownerCanTranscribe?: number;
  /** DNS: link domain (hostname). */
  linkDomain?: string | null;
  /** DNS: managed domain (hostname). */
  managedDomain?: string | null;
  /** DNS: managed sub-domain. */
  managedSubDomain?: string | null;
  /** True when podcast has a Cloudflare API key set (key never sent to client). */
  cloudflareApiKeySet?: boolean;
  /** Client-only: new API key when editing (sent in PATCH; never returned by API). */
  cloudflareApiKey?: string;
  /** When the podcast has an active custom domain, the preferred URL for sharing (e.g. https://myshow.com/). */
  canonicalFeedUrl?: string | null;
  applePodcastsUrl?: string | null;
  spotifyUrl?: string | null;
  amazonMusicUrl?: string | null;
  podcastIndexUrl?: string | null;
  listenNotesUrl?: string | null;
  castboxUrl?: string | null;
  xUrl?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  youtubeUrl?: string | null;
  /** DNS config from server settings (allow toggles and default domain list for edit UI). */
  dnsConfig?: {
    allowLinkingDomain: boolean;
    allowDomain: boolean;
    allowDomains: string[];
    defaultDomain: string;
    allowSubDomain: boolean;
    allowCustomKey: boolean;
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

/** Analytics response (camelCase). Server may send snake_case; we map in getPodcastAnalytics. */
export interface PodcastAnalytics {
  rssDaily: Array<{ statDate: string; botCount: number; humanCount: number }>;
  episodes: Array<{ id: string; title: string; slug: string | null }>;
  episodeDaily: Array<{
    episodeId: string;
    statDate: string;
    botCount: number;
    humanCount: number;
  }>;
  episodeLocationDaily: Array<{
    episodeId: string;
    statDate: string;
    location: string;
    botCount: number;
    humanCount: number;
  }>;
  episodeListensDaily: Array<{
    episodeId: string;
    statDate: string;
    botCount: number;
    humanCount: number;
  }>;
}

function mapAnalyticsFromServer(raw: {
  rss_daily?: Array<{ stat_date?: string; bot_count?: number; human_count?: number }>;
  episodes?: Array<{ id: string; title: string; slug: string | null }>;
  episode_daily?: Array<{ episode_id?: string; stat_date?: string; bot_count?: number; human_count?: number }>;
  episode_location_daily?: Array<{ episode_id?: string; stat_date?: string; location?: string; bot_count?: number; human_count?: number }>;
  episode_listens_daily?: Array<{ episode_id?: string; stat_date?: string; bot_count?: number; human_count?: number }>;
}): PodcastAnalytics {
  return {
    rssDaily: (raw.rss_daily ?? []).map((r) => ({
      statDate: r.stat_date ?? '',
      botCount: r.bot_count ?? 0,
      humanCount: r.human_count ?? 0,
    })),
    episodes: raw.episodes ?? [],
    episodeDaily: (raw.episode_daily ?? []).map((r) => ({
      episodeId: r.episode_id ?? '',
      statDate: r.stat_date ?? '',
      botCount: r.bot_count ?? 0,
      humanCount: r.human_count ?? 0,
    })),
    episodeLocationDaily: (raw.episode_location_daily ?? []).map((r) => ({
      episodeId: r.episode_id ?? '',
      statDate: r.stat_date ?? '',
      location: r.location ?? '',
      botCount: r.bot_count ?? 0,
      humanCount: r.human_count ?? 0,
    })),
    episodeListensDaily: (raw.episode_listens_daily ?? []).map((r) => ({
      episodeId: r.episode_id ?? '',
      statDate: r.stat_date ?? '',
      botCount: r.bot_count ?? 0,
      humanCount: r.human_count ?? 0,
    })),
  };
}

export function getPodcastAnalytics(podcastId: string, params?: PodcastAnalyticsQuery) {
  const search = new URLSearchParams();
  if (params?.startDate) search.set('startDate', params.startDate);
  if (params?.endDate) search.set('endDate', params.endDate);
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const query = search.toString();
  return apiGet<Parameters<typeof mapAnalyticsFromServer>[0]>(`/podcasts/${podcastId}/analytics${query ? `?${query}` : ''}`).then(mapAnalyticsFromServer);
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
  userId: string;
  username: string;
  role: string;
  createdAt: string;
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
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new CollaboratorApiError(
      (data.error as string) ?? res.statusText,
      res.status,
      {
        code: data.code as string | undefined,
        email: data.email as string | undefined,
        error: data.error as string | undefined,
        canInviteToPlatform: data.can_invite_to_platform as boolean | undefined,
      }
    );
  }
  return data as unknown as Collaborator;
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
  currentEpisode?: number;
  totalEpisodes?: number;
}

/** Start importing a podcast from an RSS/Atom feed URL. Returns 202 with podcastId; poll getImportStatus for progress. */
export function startImportPodcast(feedUrl: string) {
  return apiPost<{ podcastId: string }>('/podcasts/import', { feedUrl });
}

export function getImportStatus(podcastId: string) {
  return apiGet<ImportStatus>(`/podcasts/${podcastId}/import-status`);
}

export interface ActiveImportStatus {
  status: 'idle' | 'pending' | 'importing' | 'done' | 'failed';
  podcastId?: string;
  message?: string;
  error?: string;
  currentEpisode?: number;
  totalEpisodes?: number;
}

/** Get the current user's in-progress import, if any. Use on Dashboard load to restore the import popup after refresh. */
export function getActiveImport() {
  return apiGet<ActiveImportStatus>('/podcasts/import-status');
}

export interface DeletePodcastStatus {
  status: 'idle' | 'pending' | 'deleting' | 'done' | 'failed';
  message?: string;
  error?: string;
  currentEpisode?: number;
  totalEpisodes?: number;
}

/** Start deleting a podcast. Returns 202; poll getDeletePodcastStatus for progress. */
export function startDeletePodcast(podcastId: string) {
  return apiPost<{ message: string }>(`/podcasts/${podcastId}/delete`, {});
}

export function getDeletePodcastStatus(podcastId: string) {
  return apiGet<{
    status: string;
    message?: string;
    error?: string;
    current_episode?: number;
    total_episodes?: number;
  }>(`/podcasts/${podcastId}/delete-status`).then((raw) => ({
    status: raw.status as DeletePodcastStatus['status'],
    message: raw.message,
    error: raw.error,
    currentEpisode: raw.current_episode,
    totalEpisodes: raw.total_episodes,
  }));
}

export interface ActiveDeleteStatus {
  status: 'idle' | 'pending' | 'deleting' | 'done' | 'failed';
  podcastId?: string;
  message?: string;
  error?: string;
  currentEpisode?: number;
  totalEpisodes?: number;
}

/** Get the current user's in-progress delete, if any. */
export function getActiveDelete() {
  return apiGet<{
    status: string;
    podcast_id?: string;
    message?: string;
    error?: string;
    current_episode?: number;
    total_episodes?: number;
  }>('/podcasts/delete-status').then((raw) => ({
    status: raw.status as ActiveDeleteStatus['status'],
    podcastId: raw.podcast_id,
    message: raw.message,
    error: raw.error,
    currentEpisode: raw.current_episode,
    totalEpisodes: raw.total_episodes,
  }));
}

export function updatePodcast(id: string, body: PodcastUpdate) {
  return apiPatch<Podcast>(`/podcasts/${id}`, body);
}

// Subscriber tokens (private RSS)
export interface SubscriberToken {
  id: string;
  name: string;
  createdAt: string;
  validFrom: string | null;
  validUntil: string | null;
  disabled: number;
  lastUsedAt: string | null;
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
  body: { name: string; validFrom?: string; validUntil?: string }
) {
  return apiPost<SubscriberToken & { token: string }>(`/podcasts/${podcastId}/subscriber-tokens`, body);
}

export function updateSubscriberToken(
  podcastId: string,
  tokenId: string,
  body: { disabled?: boolean; validUntil?: string; validFrom?: string }
) {
  return apiPatch<SubscriberToken>(`/podcasts/${podcastId}/subscriber-tokens/${tokenId}`, body);
}

export function deleteSubscriberToken(podcastId: string, tokenId: string) {
  return apiDelete(`/podcasts/${podcastId}/subscriber-tokens/${tokenId}`);
}

// Show cast (hosts and guests)
export type CastMember = CastResponse & { photoFilename?: string | null };

export function listCast(
  podcastId: string,
  params?: {
    limit?: number;
    offset?: number;
    q?: string;
    sort?: 'newest' | 'oldest';
    /** Exclude cast already assigned to this episode */
    episodeId?: string;
  }
) {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.q) search.set('q', params.q);
  if (params?.sort) search.set('sort', params.sort);
  if (params?.episodeId) search.set('episodeId', params.episodeId);
  const query = search.toString();
  return apiGet<{ cast: CastMember[]; total: number }>(`/podcasts/${podcastId}/cast${query ? `?${query}` : ''}`);
}

export function createCast(podcastId: string, body: CastCreate) {
  return apiPost<CastMember>(`/podcasts/${podcastId}/cast`, body);
}

export function updateCast(podcastId: string, castId: string, body: CastUpdate) {
  return apiPatch<CastMember>(`/podcasts/${podcastId}/cast/${castId}`, body);
}

export function deleteCast(podcastId: string, castId: string) {
  return apiDelete(`/podcasts/${podcastId}/cast/${castId}`);
}

export async function uploadCastPhoto(podcastId: string, castId: string, file: File): Promise<CastMember> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/podcasts/${podcastId}/cast/${castId}/photo`, {
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

export function castPhotoUrl(podcastId: string, castId: string, filename: string): string {
  return `/api/podcasts/${podcastId}/cast/${castId}/artwork/${encodeURIComponent(filename)}`;
}
