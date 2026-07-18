import { eq, and, sql, asc, desc, count } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { podcasts, podcastShares, users, episodes } from "../../db/schema.js";
import { podcastRowWithFilename } from "./utils.js";

/** Row shape for podcast list and getById. camelCase per migration convention. */
export interface PodcastListRow {
  id: string;
  ownerUserId: string;
  title: string;
  slug: string;
  description: string | null;
  subtitle: string | null;
  summary: string | null;
  language: string | null;
  authorName: string | null;
  ownerName: string | null;
  email: string | null;
  categoryPrimary: string | null;
  categorySecondary: string | null;
  categoryPrimaryTwo: string | null;
  categorySecondaryTwo: string | null;
  categoryPrimaryThree: string | null;
  categorySecondaryThree: string | null;
  explicit: number;
  artworkPath: string | null;
  artworkUrl: string | null;
  siteUrl: string | null;
  copyright: string | null;
  podcastGuid: string | null;
  /** 0 = not locked, 1 = locked; null normalized to 0 */
  locked: number;
  license: string | null;
  itunesType: string | null;
  medium: string | null;
  fundingLinks: string | null;
  persons: string | null;
  updateFrequency: string | null;
  podcastTxts: string | null;
  socialInteracts: string | null;
  locations: string | null;
  chat: string | null;
  valueBlocks: string | null;
  blocks: string | null;
  publisher: string | null;
  podroll: string | null;
  spotifyRecentCount: number | null;
  spotifyCountryOfOrigin: string | null;
  applePodcastsVerify: string | null;
  applePodcastsUrl: string | null;
  spotifyUrl: string | null;
  amazonMusicUrl: string | null;
  podcastIndexUrl: string | null;
  listenNotesUrl: string | null;
  castboxUrl: string | null;
  xUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  discordUrl: string | null;
  linkDomain: string | null;
  managedDomain: string | null;
  managedSubDomain: string | null;
  /** ISO datetime string from SQLite text column */
  createdAt: string;
  /** ISO datetime string from SQLite text column */
  updatedAt: string;
  unlisted: number;
  subscriberOnlyFeedEnabled: number;
  publicFeedDisabled: number;
  allowUnapprovedReviews: number;
  subscriberOnlyReviews: number;
  subscriberOnlyMessages: number;
  showScheduledEpisodes: number;
  subscribersKeepExpiredEpisodes: number;
  feedAccent: string;
  feedShowPodcastDescription: number;
  feedShowEpisodeDescription: number;
  feedShowFunding: number;
  feedShowReviewsPodcast: number;
  feedShowReviewsEpisode: number;
  feedShowAuthor: number;
  feedShowPodroll: number;
  feedShowCast: number;
  maxEpisodes: number | null;
  episodeCount: number;
}

/** Episode count per podcast; single aggregation, joined to podcasts. */
const episodeCounts = drizzleDb
  .select({
    podcastId: episodes.podcastId,
    cnt: count().as("cnt"),
  })
  .from(episodes)
  .groupBy(episodes.podcastId)
  .as("episode_counts");

/** Shared selection for podcast list and getById. Requires users join (maxEpisodes) and episode_counts join (episodeCount). */
function podcastListSelection(epCounts: typeof episodeCounts) {
  return {
    id: podcasts.id,
    ownerUserId: podcasts.ownerUserId,
    title: podcasts.title,
    slug: podcasts.slug,
    description: podcasts.description,
    subtitle: podcasts.subtitle,
    summary: podcasts.summary,
    language: podcasts.language,
    authorName: podcasts.authorName,
    ownerName: podcasts.ownerName,
    email: podcasts.email,
    categoryPrimary: podcasts.categoryPrimary,
    categorySecondary: podcasts.categorySecondary,
    categoryPrimaryTwo: podcasts.categoryPrimaryTwo,
    categorySecondaryTwo: podcasts.categorySecondaryTwo,
    categoryPrimaryThree: podcasts.categoryPrimaryThree,
    categorySecondaryThree: podcasts.categorySecondaryThree,
    explicit: sql<number>`COALESCE(${podcasts.explicit}, 0)`.as("explicit"),
    artworkPath: podcasts.artworkPath,
    artworkUrl: podcasts.artworkUrl,
    siteUrl: podcasts.siteUrl,
    copyright: podcasts.copyright,
    podcastGuid: podcasts.podcastGuid,
    locked: sql<number>`COALESCE(${podcasts.locked}, 0)`.as("locked"),
    license: podcasts.license,
    itunesType: podcasts.itunesType,
    medium: podcasts.medium,
    fundingLinks: podcasts.fundingLinks,
    persons: podcasts.persons,
    updateFrequency: podcasts.updateFrequency,
    podcastTxts: podcasts.podcastTxts,
    socialInteracts: podcasts.socialInteracts,
    locations: podcasts.locations,
    chat: podcasts.chat,
    valueBlocks: podcasts.valueBlocks,
    blocks: podcasts.blocks,
    publisher: podcasts.publisher,
    podroll: podcasts.podroll,
    spotifyRecentCount: podcasts.spotifyRecentCount,
    spotifyCountryOfOrigin: podcasts.spotifyCountryOfOrigin,
    applePodcastsVerify: podcasts.applePodcastsVerify,
    applePodcastsUrl: podcasts.applePodcastsUrl,
    spotifyUrl: podcasts.spotifyUrl,
    amazonMusicUrl: podcasts.amazonMusicUrl,
    podcastIndexUrl: podcasts.podcastIndexUrl,
    listenNotesUrl: podcasts.listenNotesUrl,
    castboxUrl: podcasts.castboxUrl,
    xUrl: podcasts.xUrl,
    facebookUrl: podcasts.facebookUrl,
    instagramUrl: podcasts.instagramUrl,
    tiktokUrl: podcasts.tiktokUrl,
    youtubeUrl: podcasts.youtubeUrl,
    discordUrl: podcasts.discordUrl,
    linkDomain: podcasts.linkDomain,
    managedDomain: podcasts.managedDomain,
    managedSubDomain: podcasts.managedSubDomain,
    createdAt: podcasts.createdAt,
    updatedAt: podcasts.updatedAt,
    unlisted: sql<number>`COALESCE(${podcasts.unlisted}, 0)`.as("unlisted"),
    subscriberOnlyFeedEnabled: sql<number>`COALESCE(${podcasts.subscriberOnlyFeedEnabled}, 0)`.as(
      "subscriberOnlyFeedEnabled",
    ),
    publicFeedDisabled: sql<number>`COALESCE(${podcasts.publicFeedDisabled}, 0)`.as(
      "publicFeedDisabled",
    ),
    allowUnapprovedReviews: sql<number>`COALESCE(${podcasts.allowUnapprovedReviews}, 1)`.as("allowUnapprovedReviews"),
    subscriberOnlyReviews: sql<number>`COALESCE(${podcasts.subscriberOnlyReviews}, 0)`.as("subscriberOnlyReviews"),
    subscriberOnlyMessages: sql<number>`COALESCE(${podcasts.subscriberOnlyMessages}, 0)`.as("subscriberOnlyMessages"),
    showScheduledEpisodes: sql<number>`COALESCE(${podcasts.showScheduledEpisodes}, 0)`.as("showScheduledEpisodes"),
    subscribersKeepExpiredEpisodes: sql<number>`COALESCE(${podcasts.subscribersKeepExpiredEpisodes}, 0)`.as(
      "subscribersKeepExpiredEpisodes",
    ),
    feedAccent: sql<string>`COALESCE(${podcasts.feedAccent}, 'green')`.as("feedAccent"),
    feedShowPodcastDescription: sql<number>`COALESCE(${podcasts.feedShowPodcastDescription}, 1)`.as(
      "feedShowPodcastDescription",
    ),
    feedShowEpisodeDescription: sql<number>`COALESCE(${podcasts.feedShowEpisodeDescription}, 1)`.as(
      "feedShowEpisodeDescription",
    ),
    feedShowFunding: sql<number>`COALESCE(${podcasts.feedShowFunding}, 1)`.as("feedShowFunding"),
    feedShowReviewsPodcast: sql<number>`COALESCE(${podcasts.feedShowReviewsPodcast}, 1)`.as(
      "feedShowReviewsPodcast",
    ),
    feedShowReviewsEpisode: sql<number>`COALESCE(${podcasts.feedShowReviewsEpisode}, 1)`.as(
      "feedShowReviewsEpisode",
    ),
    feedShowAuthor: sql<number>`COALESCE(${podcasts.feedShowAuthor}, 1)`.as("feedShowAuthor"),
    feedShowPodroll: sql<number>`COALESCE(${podcasts.feedShowPodroll}, 1)`.as("feedShowPodroll"),
    feedShowCast: sql<number>`COALESCE(${podcasts.feedShowCast}, 1)`.as("feedShowCast"),
    maxEpisodes: sql<number | null>`COALESCE(${podcasts.maxEpisodes}, ${users.maxEpisodes})`.as(
      "maxEpisodes",
    ),
    episodeCount: sql<number>`COALESCE(${epCounts.cnt}, 0)`.as("episodeCount"),
  };
}

export function listOwned(userId: string): PodcastListRow[] {
  return drizzleDb
    .select(podcastListSelection(episodeCounts))
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.ownerUserId))
    .leftJoin(episodeCounts, eq(podcasts.id, episodeCounts.podcastId))
    .where(eq(podcasts.ownerUserId, userId))
    .orderBy(desc(podcasts.createdAt))
    .all();
}

/** Returns podcasts shared with the user. podcast_shares has unique(podcast_id, user_id) so no duplicates. */
export function listShared(userId: string): PodcastListRow[] {
  return drizzleDb
    .select(podcastListSelection(episodeCounts))
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.ownerUserId))
    .innerJoin(podcastShares, eq(podcastShares.podcastId, podcasts.id))
    .leftJoin(episodeCounts, eq(podcasts.id, episodeCounts.podcastId))
    .where(eq(podcastShares.userId, userId))
    .orderBy(desc(podcasts.createdAt))
    .all();
}

export function getShareRole(podcastId: string, userId: string): string | undefined {
  const row = drizzleDb
    .select({ role: podcastShares.role })
    .from(podcastShares)
    .where(
      and(
        eq(podcastShares.podcastId, podcastId),
        eq(podcastShares.userId, userId),
      ),
    )
    .limit(1)
    .get();
  return row?.role ?? undefined;
}

export interface PodcastByIdRow extends PodcastListRow {
  cloudflareApiKeyEnc: string | null;
  maxCollaborators: number | null;
  maxSubscriberTokens: number | null;
}

export function getById(id: string): PodcastByIdRow | undefined {
  const row = drizzleDb
    .select({
      ...podcastListSelection(episodeCounts),
      cloudflareApiKeyEnc: podcasts.cloudflareApiKeyEnc,
      maxCollaborators: podcasts.maxCollaborators,
      maxSubscriberTokens: podcasts.maxSubscriberTokens,
    })
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.ownerUserId))
    .leftJoin(episodeCounts, eq(podcasts.id, episodeCounts.podcastId))
    .where(eq(podcasts.id, id))
    .limit(1)
    .get();
  if (!row) {
    console.error("getById: no row", { id });
  }
  return row;
}

export function getByIdWithFilename(
  id: string,
): (PodcastByIdRow & { artworkFilename: string | null }) | undefined {
  const row = getById(id);
  return row ? podcastRowWithFilename(row) : undefined;
}

/** Same as getByIdWithFilename but without leftJoin to episodeCounts. Use when the podcast was just created. */
export function getByIdWithFilenameForCreate(
  id: string,
): (PodcastByIdRow & { artworkFilename: string | null }) | undefined {
  const row = drizzleDb
    .select({
      id: podcasts.id,
      ownerUserId: podcasts.ownerUserId,
      title: podcasts.title,
      slug: podcasts.slug,
      description: podcasts.description,
      subtitle: podcasts.subtitle,
      summary: podcasts.summary,
      language: podcasts.language,
      authorName: podcasts.authorName,
      ownerName: podcasts.ownerName,
      email: podcasts.email,
      categoryPrimary: podcasts.categoryPrimary,
      categorySecondary: podcasts.categorySecondary,
      categoryPrimaryTwo: podcasts.categoryPrimaryTwo,
      categorySecondaryTwo: podcasts.categorySecondaryTwo,
      categoryPrimaryThree: podcasts.categoryPrimaryThree,
      categorySecondaryThree: podcasts.categorySecondaryThree,
      explicit: sql<number>`COALESCE(${podcasts.explicit}, 0)`.as("explicit"),
      artworkPath: podcasts.artworkPath,
      artworkUrl: podcasts.artworkUrl,
      siteUrl: podcasts.siteUrl,
      copyright: podcasts.copyright,
      podcastGuid: podcasts.podcastGuid,
      locked: sql<number>`COALESCE(${podcasts.locked}, 0)`.as("locked"),
      license: podcasts.license,
      itunesType: podcasts.itunesType,
      medium: podcasts.medium,
      fundingLinks: podcasts.fundingLinks,
      persons: podcasts.persons,
      updateFrequency: podcasts.updateFrequency,
      podcastTxts: podcasts.podcastTxts,
      socialInteracts: podcasts.socialInteracts,
      locations: podcasts.locations,
      chat: podcasts.chat,
      valueBlocks: podcasts.valueBlocks,
      blocks: podcasts.blocks,
      publisher: podcasts.publisher,
      podroll: podcasts.podroll,
      spotifyRecentCount: podcasts.spotifyRecentCount,
      spotifyCountryOfOrigin: podcasts.spotifyCountryOfOrigin,
      applePodcastsVerify: podcasts.applePodcastsVerify,
      applePodcastsUrl: podcasts.applePodcastsUrl,
      spotifyUrl: podcasts.spotifyUrl,
      amazonMusicUrl: podcasts.amazonMusicUrl,
      podcastIndexUrl: podcasts.podcastIndexUrl,
      listenNotesUrl: podcasts.listenNotesUrl,
      castboxUrl: podcasts.castboxUrl,
      xUrl: podcasts.xUrl,
      facebookUrl: podcasts.facebookUrl,
      instagramUrl: podcasts.instagramUrl,
      tiktokUrl: podcasts.tiktokUrl,
      youtubeUrl: podcasts.youtubeUrl,
    discordUrl: podcasts.discordUrl,
      linkDomain: podcasts.linkDomain,
      managedDomain: podcasts.managedDomain,
      managedSubDomain: podcasts.managedSubDomain,
      createdAt: podcasts.createdAt,
      updatedAt: podcasts.updatedAt,
      unlisted: sql<number>`COALESCE(${podcasts.unlisted}, 0)`.as("unlisted"),
      subscriberOnlyFeedEnabled: sql<number>`COALESCE(${podcasts.subscriberOnlyFeedEnabled}, 0)`.as("subscriberOnlyFeedEnabled"),
      publicFeedDisabled: sql<number>`COALESCE(${podcasts.publicFeedDisabled}, 0)`.as("publicFeedDisabled"),
      allowUnapprovedReviews: sql<number>`COALESCE(${podcasts.allowUnapprovedReviews}, 1)`.as("allowUnapprovedReviews"),
      subscriberOnlyReviews: sql<number>`COALESCE(${podcasts.subscriberOnlyReviews}, 0)`.as("subscriberOnlyReviews"),
      subscriberOnlyMessages: sql<number>`COALESCE(${podcasts.subscriberOnlyMessages}, 0)`.as("subscriberOnlyMessages"),
      showScheduledEpisodes: sql<number>`COALESCE(${podcasts.showScheduledEpisodes}, 0)`.as("showScheduledEpisodes"),
      subscribersKeepExpiredEpisodes: sql<number>`COALESCE(${podcasts.subscribersKeepExpiredEpisodes}, 0)`.as(
        "subscribersKeepExpiredEpisodes",
      ),
      feedAccent: sql<string>`COALESCE(${podcasts.feedAccent}, 'green')`.as("feedAccent"),
      feedShowPodcastDescription: sql<number>`COALESCE(${podcasts.feedShowPodcastDescription}, 1)`.as(
        "feedShowPodcastDescription",
      ),
      feedShowEpisodeDescription: sql<number>`COALESCE(${podcasts.feedShowEpisodeDescription}, 1)`.as(
        "feedShowEpisodeDescription",
      ),
      feedShowFunding: sql<number>`COALESCE(${podcasts.feedShowFunding}, 1)`.as("feedShowFunding"),
      feedShowReviewsPodcast: sql<number>`COALESCE(${podcasts.feedShowReviewsPodcast}, 1)`.as(
        "feedShowReviewsPodcast",
      ),
      feedShowReviewsEpisode: sql<number>`COALESCE(${podcasts.feedShowReviewsEpisode}, 1)`.as(
        "feedShowReviewsEpisode",
      ),
      feedShowAuthor: sql<number>`COALESCE(${podcasts.feedShowAuthor}, 1)`.as("feedShowAuthor"),
      feedShowPodroll: sql<number>`COALESCE(${podcasts.feedShowPodroll}, 1)`.as("feedShowPodroll"),
      feedShowCast: sql<number>`COALESCE(${podcasts.feedShowCast}, 1)`.as("feedShowCast"),
      maxEpisodes: sql<number | null>`COALESCE(${podcasts.maxEpisodes}, ${users.maxEpisodes})`.as("maxEpisodes"),
      episodeCount: sql<number>`0`.as("episodeCount"),
      cloudflareApiKeyEnc: podcasts.cloudflareApiKeyEnc,
      maxCollaborators: podcasts.maxCollaborators,
      maxSubscriberTokens: podcasts.maxSubscriberTokens,
    })
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.ownerUserId))
    .where(eq(podcasts.id, id))
    .limit(1)
    .get();
  if (!row) {
    console.error("getByIdWithFilenameForCreate: create fetch returned no row", { id });
    const minimal = drizzleDb
      .select({ id: podcasts.id })
      .from(podcasts)
      .where(eq(podcasts.id, id))
      .limit(1)
      .get();
    console.error("getByIdWithFilenameForCreate: minimal podcast-only query", {
      id,
      podcastRowExists: !!minimal,
    });
  }
  return row ? podcastRowWithFilename(row as PodcastByIdRow) : undefined;
}

export function getSlug(id: string): string | undefined {
  const row = drizzleDb
    .select({ slug: podcasts.slug })
    .from(podcasts)
    .where(eq(podcasts.id, id))
    .limit(1)
    .get();
  return row?.slug ?? undefined;
}

/**
 * Returns the relative artwork path for a podcast.
 * - `undefined` = podcast not found
 * - `null` = podcast found, no artwork
 * - `string` = relative path (e.g. artwork/{podcastId}/{filename}.jpg)
 */
export function getArtworkPath(podcastId: string): string | null | undefined {
  const row = drizzleDb
    .select({ artworkPath: podcasts.artworkPath })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row ? row.artworkPath : undefined;
}

export function listByOwnerUserId(
  userId: string,
  sortDir: "ASC" | "DESC",
): PodcastListRow[] {
  const orderByCol =
    sortDir === "ASC" ? asc(podcasts.createdAt) : desc(podcasts.createdAt);
  return drizzleDb
    .select(podcastListSelection(episodeCounts))
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.ownerUserId))
    .leftJoin(episodeCounts, eq(podcasts.id, episodeCounts.podcastId))
    .where(eq(podcasts.ownerUserId, userId))
    .orderBy(orderByCol)
    .all();
}
