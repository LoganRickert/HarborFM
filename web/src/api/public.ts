import type {
  PublicConfig,
  PublicEpisodesResponse,
  PublicPodcastsListQuery,
  PublicPodcastsResponse,
} from '@harborfm/shared';
import { apiGet, apiPost, apiDelete } from './client';

/** camelCase shape for public podcast (transformed from server snake_case). */
export interface PublicPodcast {
  id: string;
  title: string;
  slug: string;
  description: string;
  language: string;
  authorName: string;
  artworkUrl: string | null;
  artworkUploaded?: boolean;
  artworkFilename?: string | null;
  siteUrl: string | null;
  explicit: number;
  rssUrl?: string | null;
  createdAt?: string;
  subscriberOnlyFeedEnabled?: boolean;
  publicFeedDisabled?: boolean;
  /** When true, only subscribers (signed in with subscriber link) can leave reviews. */
  subscriberOnlyReviews?: boolean;
  /** When true, only subscribers can see/use Message button and submit contact. */
  subscriberOnlyMessages?: boolean;
  /** When true, future-dated scheduled/published episodes appear on the public feed with a placeholder. */
  showScheduledEpisodes?: boolean;
  canonicalFeedUrl?: string;
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
  discordUrl?: string | null;
  /** Creator recommendations (Podcast 2.0 podroll). */
  podroll?: Array<{
    feedGuid: string;
    feedUrl: string | null;
    title: string | null;
    coverArtUrl: string | null;
    homeUrl: string | null;
  }> | null;
  fundingLinks?: Array<{ url: string; text?: string | null }> | null;
  /** Named accent for public feed theming (default green). */
  feedAccent?: string;
  feedShowPodcastDescription?: boolean;
  feedShowEpisodeDescription?: boolean;
  feedShowFunding?: boolean;
  feedShowReviewsPodcast?: boolean;
  feedShowReviewsEpisode?: boolean;
  feedShowAuthor?: boolean;
  feedShowPodroll?: boolean;
  feedShowCast?: boolean;
}

/** camelCase shape for public episode (transformed from server snake_case). */
export interface PublicEpisode {
  id: string;
  podcastId: string;
  title: string;
  slug: string;
  description: string;
  guid: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeType: string | null;
  explicit: number | null;
  publishAt: string | null;
  artworkUrl: string | null;
  artworkFilename?: string | null;
  audioMime: string | null;
  audioBytes: number | null;
  audioDurationSec: number | null;
  audioUrl: string | null;
  videoUrl?: string | null;
  srtUrl?: string | null;
  subscriberOnly?: boolean;
  subscriberOnlyStartsAt?: string | null;
  subscriberOnlyEndsAt?: string | null;
  createdAt: string;
  updatedAt: string;
  privateAudioUrl?: string | null;
  privateWaveformUrl?: string | null;
  privateVideoUrl?: string | null;
  privateSrtUrl?: string | null;
  markers?: Array<{ time: number; title?: string; color?: string }> | null;
  soundbites?: Array<{ time: number; duration: number; title?: string; color?: string }> | null;
  /** When true, episode is scheduled for a future date and audio/markers are not available yet. */
  scheduledNotReleased?: boolean;
  fundingLinks?: Array<{ url: string; text?: string | null }> | null;
}

function toPublicPodcast(r: Record<string, unknown>): PublicPodcast {
  return {
    id: String(r.id ?? ''),
    title: String(r.title ?? ''),
    slug: String(r.slug ?? ''),
    description: String(r.description ?? ''),
    language: String(r.language ?? 'en'),
    authorName: String(r.author_name ?? ''),
    artworkUrl: r.artwork_url != null ? String(r.artwork_url) : null,
    artworkUploaded: Boolean(r.artwork_uploaded),
    artworkFilename: r.artwork_filename != null ? String(r.artwork_filename) : null,
    siteUrl: r.site_url != null ? String(r.site_url) : null,
    explicit: Number(r.explicit ?? 0),
    rssUrl: r.rss_url != null ? String(r.rss_url) : null,
    createdAt: r.created_at != null ? String(r.created_at) : undefined,
    subscriberOnlyFeedEnabled: r.subscriber_only_feed_enabled === 1 || r.subscriber_only_feed_enabled === true,
    publicFeedDisabled: r.public_feed_disabled === 1 || r.public_feed_disabled === true,
    subscriberOnlyReviews: r.subscriber_only_reviews === 1 || r.subscriber_only_reviews === true,
    subscriberOnlyMessages: r.subscriber_only_messages === 1 || r.subscriber_only_messages === true,
    showScheduledEpisodes: r.show_scheduled_episodes === 1 || r.show_scheduled_episodes === true,
    canonicalFeedUrl: r.canonical_feed_url != null ? String(r.canonical_feed_url) : undefined,
    applePodcastsUrl: r.apple_podcasts_url != null ? String(r.apple_podcasts_url) : null,
    spotifyUrl: r.spotify_url != null ? String(r.spotify_url) : null,
    amazonMusicUrl: r.amazon_music_url != null ? String(r.amazon_music_url) : null,
    podcastIndexUrl: r.podcast_index_url != null ? String(r.podcast_index_url) : null,
    listenNotesUrl: r.listen_notes_url != null ? String(r.listen_notes_url) : null,
    castboxUrl: r.castbox_url != null ? String(r.castbox_url) : null,
    xUrl: r.x_url != null ? String(r.x_url) : null,
    facebookUrl: r.facebook_url != null ? String(r.facebook_url) : null,
    instagramUrl: r.instagram_url != null ? String(r.instagram_url) : null,
    tiktokUrl: r.tiktok_url != null ? String(r.tiktok_url) : null,
    youtubeUrl: r.youtube_url != null ? String(r.youtube_url) : null,
    discordUrl: r.discord_url != null ? String(r.discord_url) : null,
    podroll: Array.isArray(r.podroll)
      ? (r.podroll as Array<Record<string, unknown>>)
          .map((p) => {
            const feedGuid =
              typeof p.feed_guid === 'string'
                ? p.feed_guid
                : typeof p.feedGuid === 'string'
                  ? p.feedGuid
                  : '';
            if (!feedGuid.trim()) return null;
            return {
              feedGuid: feedGuid.trim(),
              feedUrl:
                typeof p.feed_url === 'string'
                  ? p.feed_url
                  : typeof p.feedUrl === 'string'
                    ? p.feedUrl
                    : null,
              title:
                typeof p.title === 'string' ? p.title : null,
              coverArtUrl:
                typeof p.cover_art_url === 'string'
                  ? p.cover_art_url
                  : typeof p.coverArtUrl === 'string'
                    ? p.coverArtUrl
                    : null,
              homeUrl:
                typeof p.home_url === 'string'
                  ? p.home_url
                  : typeof p.homeUrl === 'string'
                    ? p.homeUrl
                    : null,
            };
          })
          .filter((p): p is NonNullable<typeof p> => p != null)
      : null,
    fundingLinks: parsePublicFundingLinks(r.funding_links ?? r.fundingLinks),
    feedAccent:
      typeof r.feed_accent === 'string' && r.feed_accent.trim()
        ? r.feed_accent.trim()
        : typeof r.feedAccent === 'string' && r.feedAccent.trim()
          ? r.feedAccent.trim()
          : 'green',
    feedShowPodcastDescription: asPublicBool(
      r.feed_show_podcast_description ?? r.feedShowPodcastDescription,
      true,
    ),
    feedShowEpisodeDescription: asPublicBool(
      r.feed_show_episode_description ?? r.feedShowEpisodeDescription,
      true,
    ),
    feedShowFunding: asPublicBool(r.feed_show_funding ?? r.feedShowFunding, true),
    feedShowReviewsPodcast: asPublicBool(
      r.feed_show_reviews_podcast ?? r.feedShowReviewsPodcast,
      true,
    ),
    feedShowReviewsEpisode: asPublicBool(
      r.feed_show_reviews_episode ?? r.feedShowReviewsEpisode,
      true,
    ),
    feedShowAuthor: asPublicBool(r.feed_show_author ?? r.feedShowAuthor, true),
    feedShowPodroll: asPublicBool(r.feed_show_podroll ?? r.feedShowPodroll, true),
    feedShowCast: asPublicBool(r.feed_show_cast ?? r.feedShowCast, true),
  };
}

function asPublicBool(v: unknown, defaultValue: boolean): boolean {
  if (v === undefined || v === null) return defaultValue;
  return v === 1 || v === true;
}

function parsePublicFundingLinks(
  raw: unknown,
): Array<{ url: string; text: string | null }> | null {
  if (!Array.isArray(raw)) return null;
  const items = (raw as Array<Record<string, unknown>>)
    .map((f) => {
      const url = typeof f.url === 'string' ? f.url.trim() : '';
      if (!url) return null;
      return {
        url,
        text: typeof f.text === 'string' && f.text.trim() ? f.text.trim() : null,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f != null);
  return items.length > 0 ? items : null;
}

function toPublicEpisode(r: Record<string, unknown>): PublicEpisode {
  return {
    id: String(r.id ?? ''),
    podcastId: String(r.podcast_id ?? ''),
    title: String(r.title ?? ''),
    slug: String(r.slug ?? ''),
    description: String(r.description ?? ''),
    guid: String(r.guid ?? ''),
    seasonNumber: r.season_number != null ? Number(r.season_number) : null,
    episodeNumber: r.episode_number != null ? Number(r.episode_number) : null,
    episodeType: r.episode_type != null ? String(r.episode_type) : null,
    explicit: r.explicit != null ? Number(r.explicit) : null,
    publishAt: r.publish_at != null ? String(r.publish_at) : null,
    artworkUrl: r.artwork_url != null ? String(r.artwork_url) : null,
    artworkFilename: r.artwork_filename != null ? String(r.artwork_filename) : null,
    audioMime: r.audio_mime != null ? String(r.audio_mime) : null,
    audioBytes: r.audio_bytes != null ? Number(r.audio_bytes) : null,
    audioDurationSec: r.audio_duration_sec != null ? Number(r.audio_duration_sec) : null,
    audioUrl: r.audio_url != null ? String(r.audio_url) : null,
    videoUrl: (r.video_url as string | null) ?? null,
    srtUrl: r.srt_url != null ? String(r.srt_url) : null,
    subscriberOnly: r.subscriber_only === 1 || r.subscriber_only === true,
    subscriberOnlyStartsAt:
      r.subscriber_only_starts_at != null ? String(r.subscriber_only_starts_at) : null,
    subscriberOnlyEndsAt:
      r.subscriber_only_ends_at != null ? String(r.subscriber_only_ends_at) : null,
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    privateAudioUrl: (r.private_audio_url as string | null) ?? null,
    privateWaveformUrl: (r.private_waveform_url as string | null) ?? null,
    privateVideoUrl: (r.private_video_url as string | null) ?? null,
    privateSrtUrl: (r.private_srt_url as string | null) ?? null,
    markers: Array.isArray(r.markers) ? r.markers : [],
    soundbites: Array.isArray(r.soundbites)
      ? (r.soundbites as Array<{ time: number; duration: number; title?: string; color?: string }>).filter(
          (s) =>
            typeof s?.time === 'number' &&
            typeof s?.duration === 'number' &&
            s.duration >= 15 &&
            s.duration <= 120,
        )
      : [],
    scheduledNotReleased: r.scheduled_not_released === 1 || r.scheduled_not_released === true,
    fundingLinks: parsePublicFundingLinks(r.funding_links ?? r.fundingLinks),
  };
}

export type { PublicConfig, PublicEpisodesResponse, PublicPodcastsListQuery, PublicPodcastsResponse };

// PublicEpisode with auth may include private URLs (same shape; server may send null when unauthenticated)
export type PublicEpisodeWithAuth = PublicEpisode;

export function getPublicPodcastArtworkUrl(podcast: {
  artworkUrl?: string | null;
  artworkFilename?: string | null;
  id: string;
}): string | null {
  if (podcast.artworkUrl) return podcast.artworkUrl;
  if (podcast.artworkFilename) {
    return `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artworkFilename)}`;
  }
  return null;
}

export function getPublicEpisodeArtworkUrl(
  episode: {
    artworkUrl?: string | null;
    artworkFilename?: string | null;
    id: string;
    podcastId: string;
  },
  podcast: {
    artworkUrl?: string | null;
    artworkFilename?: string | null;
    id: string;
  },
): string | null {
  if (episode.artworkUrl) return episode.artworkUrl;
  if (episode.artworkFilename) {
    return `/api/public/artwork/${episode.podcastId}/episodes/${episode.id}/${encodeURIComponent(episode.artworkFilename)}`;
  }
  return getPublicPodcastArtworkUrl(podcast);
}

export function getPublicConfig() {
  return apiGet<PublicConfig>(`/public/config`);
}

export function getPublicPodcasts(params?: PublicPodcastsListQuery) {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  if (params?.q?.trim()) search.set('q', params.q.trim());
  if (params?.sort) search.set('sort', params.sort);
  const query = search.toString();
  return apiGet<PublicPodcastsResponse>(`/public/podcasts${query ? `?${query}` : ''}`).then((data) => ({
    ...data,
    podcasts: (data.podcasts ?? []).map((p) => toPublicPodcast(p as Record<string, unknown>)),
  }));
}

export function getPublicPodcast(slug: string) {
  return apiGet<Record<string, unknown>>(`/public/podcasts/${slug}`).then((r) => toPublicPodcast(r));
}

export function getPublicEpisodes(
  podcastSlug: string,
  limit = 50,
  offset = 0,
  sort: 'newest' | 'oldest' = 'newest',
  q?: string,
  episodeType?: 'full' | 'trailer' | 'bonus',
) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set('sort', sort);
  if (q?.trim()) params.set('q', q.trim());
  if (episodeType) params.set('episodeType', episodeType);
  return apiGet<PublicEpisodesResponse>(`/public/podcasts/${podcastSlug}/episodes?${params.toString()}`).then((data) => ({
    ...data,
    episodes: (data.episodes ?? []).map((e) => toPublicEpisode(e as Record<string, unknown>)),
  }));
}

export function getPublicEpisode(podcastSlug: string, episodeSlug: string) {
  return apiGet<Record<string, unknown>>(`/public/podcasts/${podcastSlug}/episodes/${episodeSlug}`).then((r) =>
    toPublicEpisode(r)
  );
}

export interface PublicCastMember {
  id: string;
  name: string;
  role: 'host' | 'guest';
  description: string | null;
  photo_url: string | null;
  social_link_text: string | null;
}

export function getPublicEpisodeCast(podcastSlug: string, episodeSlug: string) {
  return apiGet<{ cast: PublicCastMember[] }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/cast`
  );
}

export function getPublicCast(
  podcastSlug: string,
  params?: { limit?: number; offset?: number }
) {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const query = search.toString();
  return apiGet<{
    hosts: PublicCastMember[];
    guests: PublicCastMember[];
    guests_total: number;
    guests_has_more: boolean;
  }>(`/public/podcasts/${podcastSlug}/cast${query ? `?${query}` : ''}`);
}

export function publicEpisodeWaveformUrl(podcastSlug: string, episodeSlug: string): string {
  return `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/waveform`;
}

// Subscriber authentication functions
export function authenticateSubscriber(token: string, podcastSlug: string) {
  return apiPost<{ success: boolean; podcastSlug: string }>('/public/subscriber-auth', { token, podcastSlug });
}

export function getSubscriberAuthStatus() {
  return apiGet<{ authenticated: boolean; podcastSlugs: string[]; tokens: Record<string, string> }>('/public/subscriber-auth/status');
}

export function logoutSubscriber(podcastSlug?: string) {
  const query = podcastSlug ? `?podcastSlug=${encodeURIComponent(podcastSlug)}` : '';
  return apiDelete<{ success: boolean }>(`/public/subscriber-auth${query}`);
}

export type PublicStripePlan = {
  id: string;
  kind: 'month' | 'year' | 'one_time';
  amountCents: number;
  currency: string;
  autoRenewDefault: boolean;
};

export function getPublicStripePlans(podcastSlug: string) {
  return apiGet<{
    enabled: boolean;
    mode: 'test' | 'live' | null;
    hasActiveCoupons?: boolean;
    plans: PublicStripePlan[];
  }>(`/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/plans`);
}

export function createPublicStripeCheckout(
  podcastSlug: string,
  planId: string,
  opts?: { episodeAlerts?: boolean },
) {
  return apiPost<{ url: string; sessionId: string }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/checkout`,
    {
      planId,
      ...(opts?.episodeAlerts ? { episodeAlerts: true } : {}),
    },
  );
}

export function recoverPublicStripeToken(podcastSlug: string, email: string) {
  return apiPost<{ ok: boolean; message: string }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/recover-token`,
    { email },
  );
}

export type PublicStripeSubscriptionStatus = {
  hasSubscription: true;
  status: string;
  plan: {
    id: string;
    kind: string;
    amountCents: number;
    currency: string;
    autoRenewDefault: boolean;
  } | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeMode: 'test' | 'live';
  customerEmail: string | null;
  canManageBilling: boolean;
  canCancelAtPeriodEnd: boolean;
  canRenew: boolean;
  canRegenerateAccessToken: boolean;
  canRequestRefund: boolean;
  refundRequest: {
    status: 'pending' | 'approved' | 'rejected';
    amountCents: number;
    currency: string;
    createdAt: string;
  } | null;
  isOneTime: boolean;
};

export function getPublicStripeSubscriptionStatus(podcastSlug: string) {
  return apiGet<PublicStripeSubscriptionStatus>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/subscription/status`,
  );
}

export function createPublicStripeBillingPortal(
  podcastSlug: string,
  opts?: { returnUrl?: string },
) {
  return apiPost<{ url: string }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/subscription/portal`,
    opts ?? {},
  );
}

export function setPublicStripeCancelAtPeriodEnd(
  podcastSlug: string,
  cancel: boolean,
) {
  return apiPost<{
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    status: string;
  }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/subscription/cancel-at-period-end`,
    { cancel },
  );
}

export function renewPublicStripeSubscription(podcastSlug: string) {
  return apiPost<{
    ok: true;
    cancelAtPeriodEnd?: boolean;
    url?: string;
    status?: string;
  }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/subscription/renew`,
    {},
  );
}

export function regeneratePublicStripeToken(podcastSlug: string) {
  return apiPost<{ token: string }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/subscription/regenerate-token`,
    {},
  );
}

export function requestPublicStripeRefund(podcastSlug: string) {
  return apiPost<{
    refundRequest: {
      id: string;
      status: string;
      amountCents: number;
      currency: string;
      createdAt: string;
    };
  }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/subscription/request-refund`,
    {},
  );
}

export function completePublicStripeCheckout(podcastSlug: string, sessionId: string) {
  return apiGet<{
    success: boolean;
    podcastSlug: string;
    token: string | null;
    alreadyClaimed?: boolean;
  }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/stripe/checkout/success?session_id=${encodeURIComponent(sessionId)}`,
  );
}
