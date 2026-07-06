import { z } from 'zod';

/** Single public podcast (list and by-slug). */
export const publicPodcastSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  language: z.string(),
  authorName: z.string(),
  artworkUrl: z.string().nullable(),
  artworkUploaded: z.boolean().optional(),
  artworkFilename: z.string().nullable().optional(),
  siteUrl: z.string().nullable(),
  explicit: z.number(),
  rssUrl: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  /** When true, subscribers feature is on (tokens, private link). */
  subscriberOnlyFeedEnabled: z.boolean().optional(),
  /** When true, feed is subscriber-only (public feed disabled); use with subscriberOnlyFeedEnabled for gold lock. */
  publicFeedDisabled: z.boolean().optional(),
  /** When the podcast has an active custom domain, the preferred URL for sharing (e.g. https://myshow.com/). Omit when none. */
  canonicalFeedUrl: z.string().optional(),
  applePodcastsUrl: z.string().nullable().optional(),
  spotifyUrl: z.string().nullable().optional(),
  amazonMusicUrl: z.string().nullable().optional(),
  podcastIndexUrl: z.string().nullable().optional(),
  listenNotesUrl: z.string().nullable().optional(),
  castboxUrl: z.string().nullable().optional(),
  xUrl: z.string().nullable().optional(),
  facebookUrl: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  tiktokUrl: z.string().nullable().optional(),
  youtubeUrl: z.string().nullable().optional(),
});

/** Querystring for GET /public/podcasts (paginated list). */
export const publicPodcastsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
});

/** Response for GET /public/podcasts. */
export const publicPodcastsResponseSchema = z.object({
  podcasts: z.array(publicPodcastSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

/** Single public episode. */
export const publicEpisodeSchema = z.object({
  id: z.string(),
  podcastId: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  guid: z.string(),
  seasonNumber: z.number().nullable(),
  episodeNumber: z.number().nullable(),
  episodeType: z.string().nullable(),
  explicit: z.number().nullable(),
  publishAt: z.string().nullable(),
  artworkUrl: z.string().nullable(),
  artworkFilename: z.string().nullable().optional(),
  audioMime: z.string().nullable(),
  audioBytes: z.number().nullable(),
  audioDurationSec: z.number().nullable(),
  audioUrl: z.string().nullable(),
  srtUrl: z.string().nullable().optional(),
  /** When true, episode is subscriber-only; public page shows locked card (no audioUrl). */
  subscriberOnly: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Private URLs (only present when authenticated with subscriber token) */
  privateAudioUrl: z.string().nullish(),
  privateWaveformUrl: z.string().nullish(),
  privateSrtUrl: z.string().nullish(),
  /** Chapter markers; time in seconds of final audio. */
  markers: z.array(z.object({ time: z.number(), title: z.string().optional(), color: z.string().optional() })).optional().nullable(),
});

/** Response for GET /public/podcasts/:slug/episodes. */
export const publicEpisodesResponseSchema = z.object({
  episodes: z.array(publicEpisodeSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

/** Response for GET /public/config. */
export const publicConfigSchema = z.object({
  publicFeedsEnabled: z.boolean(),
  /** When request Host is a custom podcast domain, the podcast slug to show at /. */
  customFeedSlug: z.string().optional(),
  /** When true, show GDPR-style cookie/tracking consent banner on public pages. */
  gdprConsentBannerEnabled: z.boolean().optional(),
  /** When true, WebRTC group calls are configured (service + public WS URL). */
  webrtcEnabled: z.boolean().optional(),
  /** When true, public feed pages show reviews and accept submissions (subject to podcast settings). */
  reviewsEnabled: z.boolean().optional(),
  /** When set, replaces HarborFM on public feed headers and embeds. */
  whiteLabel: z.string().optional(),
});

export type PublicPodcast = z.infer<typeof publicPodcastSchema>;
export type PublicPodcastsListQuery = z.infer<typeof publicPodcastsListQuerySchema>;
export type PublicPodcastsResponse = z.infer<typeof publicPodcastsResponseSchema>;
export type PublicEpisode = z.infer<typeof publicEpisodeSchema>;
export type PublicEpisodesResponse = z.infer<typeof publicEpisodesResponseSchema>;
export type PublicConfig = z.infer<typeof publicConfigSchema>;
