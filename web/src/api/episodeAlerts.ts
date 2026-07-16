import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export type EpisodeAlertDestinationType =
  | 'builtin'
  | 'byo_email'
  | 'byo_sendgrid'
  | 'discord'
  | 'slack'
  | 'telegram'
  | 'mastodon'
  | 'matrix'
  | 'lemmy'
  | 'bluesky'
  | 'json_webhook';

export type EpisodeAlertScope = 'all' | 'premium';
export type EpisodeAlertList = 'general' | 'subscribers';

export interface EpisodeAlertSettings {
  episodeAlertsEnabled: boolean;
  episodeAlertsCheckoutList: EpisodeAlertList;
  episodeAlertsMailingAddress: string | null;
}

export interface EpisodeAlertDestination {
  id: string;
  podcastId: string;
  name: string;
  type: EpisodeAlertDestinationType;
  enabled: boolean;
  episodeScope: EpisodeAlertScope;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeAlertListCounts {
  general: number;
  subscribers: number;
  total: number;
}

export interface EpisodeAlertsResponse {
  settings: EpisodeAlertSettings;
  destinations: EpisodeAlertDestination[];
  listCounts: EpisodeAlertListCounts;
  emailAvailable: boolean;
}

export function getEpisodeAlerts(podcastId: string) {
  return apiGet<EpisodeAlertsResponse>(`/podcasts/${podcastId}/episode-alerts`);
}

export function updateEpisodeAlertsSettings(
  podcastId: string,
  data: Partial<EpisodeAlertSettings>,
) {
  return apiPatch<{ settings: EpisodeAlertSettings }>(
    `/podcasts/${podcastId}/episode-alerts`,
    data,
  );
}

export function createEpisodeAlertDestination(
  podcastId: string,
  data: {
    name?: string;
    type: EpisodeAlertDestinationType;
    enabled?: boolean;
    episodeScope?: EpisodeAlertScope;
    config?: Record<string, unknown>;
  },
) {
  return apiPost<{ destination: EpisodeAlertDestination }>(
    `/podcasts/${podcastId}/episode-alerts/destinations`,
    data,
  );
}

export function updateEpisodeAlertDestination(
  podcastId: string,
  destinationId: string,
  data: {
    name?: string;
    enabled?: boolean;
    episodeScope?: EpisodeAlertScope;
    config?: Record<string, unknown>;
  },
) {
  return apiPatch<{ destination: EpisodeAlertDestination }>(
    `/podcasts/${podcastId}/episode-alerts/destinations/${destinationId}`,
    data,
  );
}

export function deleteEpisodeAlertDestination(
  podcastId: string,
  destinationId: string,
) {
  return apiDelete(`/podcasts/${podcastId}/episode-alerts/destinations/${destinationId}`);
}

export function getPublicEpisodeAlerts(slug: string) {
  return apiGet<{
    enabled: boolean;
    emailSignupAvailable: boolean;
    checkoutList: EpisodeAlertList;
  }>(`/public/podcasts/${encodeURIComponent(slug)}/episode-alerts`);
}

export function signupEpisodeAlerts(
  slug: string,
  data: { email: string; captchaToken?: string },
) {
  return apiPost<{
    ok: boolean;
    verificationRequired: boolean;
  }>(`/public/podcasts/${encodeURIComponent(slug)}/episode-alerts/signup`, data);
}
