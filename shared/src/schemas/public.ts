import { z } from 'zod';

/** Single public podcast (list and by-slug). */
export const publicPodcastSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  language: z.string(),
  author_name: z.string(),
  artwork_url: z.string().nullable(),
  artwork_uploaded: z.boolean().optional(),
  artwork_filename: z.string().nullable().optional(),
  site_url: z.string().nullable(),
  explicit: z.number(),
  rss_url: z.string().nullable().optional(),
  created_at: z.string().optional(),
  /** When 1, subscribers feature is on (tokens, private link). */
  subscriber_only_feed_enabled: z.number().optional(),
  /** When 1, feed is subscriber-only (public feed disabled); use with subscriber_only_feed_enabled for gold lock. */
  public_feed_disabled: z.number().optional(),
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
  podcast_id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  guid: z.string(),
  season_number: z.number().nullable(),
  episode_number: z.number().nullable(),
  episode_type: z.string().nullable(),
  explicit: z.number().nullable(),
  publish_at: z.string().nullable(),
  artwork_url: z.string().nullable(),
  artwork_filename: z.string().nullable().optional(),
  audio_mime: z.string().nullable(),
  audio_bytes: z.number().nullable(),
  audio_duration_sec: z.number().nullable(),
  audio_url: z.string().nullable(),
  srt_url: z.string().nullable().optional(),
  /** When 1, episode is subscriber-only; public page shows locked card (no audio_url). */
  subscriber_only: z.number().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  /** Private URLs (only present when authenticated with subscriber token) */
  private_audio_url: z.string().nullish(),
  private_waveform_url: z.string().nullish(),
  private_srt_url: z.string().nullish(),
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
  public_feeds_enabled: z.boolean(),
  /** When request Host is a custom podcast domain, the podcast slug to show at /. */
  custom_feed_slug: z.string().optional(),
});

export type PublicPodcast = z.infer<typeof publicPodcastSchema>;
export type PublicPodcastsListQuery = z.infer<typeof publicPodcastsListQuerySchema>;
export type PublicPodcastsResponse = z.infer<typeof publicPodcastsResponseSchema>;
export type PublicEpisode = z.infer<typeof publicEpisodeSchema>;
export type PublicEpisodesResponse = z.infer<typeof publicEpisodesResponseSchema>;
export type PublicConfig = z.infer<typeof publicConfigSchema>;
