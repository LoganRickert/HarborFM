import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  episodeCast,
  episodes,
  exports as exportsTable,
  podcastCast,
  podcasts,
} from "../../db/schema.js";

/** Get podcast id by slug (for subscriber-auth and private routes). */
export function getPodcastIdBySlug(slug: string): string | undefined {
  const row = drizzleDb
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(eq(podcasts.slug, slug))
    .limit(1)
    .get();
  return row?.id;
}

/** Get podcast meta for feed/episode 404 and subscriber-only logic. */
export function getPodcastMetaForFeed(slug: string): {
  id: string;
  publicFeedDisabled: number;
  subscriberOnlyFeedEnabled: number;
  showScheduledEpisodes: number;
} | undefined {
  const row = drizzleDb
    .select({
      id: podcasts.id,
      publicFeedDisabled: sql<number>`COALESCE(${podcasts.publicFeedDisabled}, 0)`.as("publicFeedDisabled"),
      subscriberOnlyFeedEnabled: sql<number>`COALESCE(${podcasts.subscriberOnlyFeedEnabled}, 0)`.as("subscriberOnlyFeedEnabled"),
      showScheduledEpisodes: sql<number>`COALESCE(${podcasts.showScheduledEpisodes}, 0)`.as("showScheduledEpisodes"),
    })
    .from(podcasts)
    .where(eq(podcasts.slug, slug))
    .limit(1)
    .get();
  return row as
    | { id: string; publicFeedDisabled: number; subscriberOnlyFeedEnabled: number; showScheduledEpisodes: number }
    | undefined;
}

/** Full podcast row for public podcast page (by slug). */
export function getPodcastBySlug(slug: string) {
  return drizzleDb
    .select({
      id: podcasts.id,
      title: podcasts.title,
      slug: podcasts.slug,
      description: podcasts.description,
      language: podcasts.language,
      authorName: podcasts.authorName,
      artworkUrl: podcasts.artworkUrl,
      artworkPath: podcasts.artworkPath,
      siteUrl: podcasts.siteUrl,
      explicit: podcasts.explicit,
      publicFeedDisabled: sql<number>`COALESCE(${podcasts.publicFeedDisabled}, 0)`.as("publicFeedDisabled"),
      subscriberOnlyFeedEnabled: sql<number>`COALESCE(${podcasts.subscriberOnlyFeedEnabled}, 0)`.as("subscriberOnlyFeedEnabled"),
      subscriberOnlyReviews: sql<number>`COALESCE(${podcasts.subscriberOnlyReviews}, 0)`.as("subscriberOnlyReviews"),
      subscriberOnlyMessages: sql<number>`COALESCE(${podcasts.subscriberOnlyMessages}, 0)`.as("subscriberOnlyMessages"),
      showScheduledEpisodes: sql<number>`COALESCE(${podcasts.showScheduledEpisodes}, 0)`.as("showScheduledEpisodes"),
      linkDomain: podcasts.linkDomain,
      managedDomain: podcasts.managedDomain,
      managedSubDomain: podcasts.managedSubDomain,
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
      podroll: podcasts.podroll,
      fundingLinks: podcasts.fundingLinks,
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
      episodeAlertsEnabled: sql<number>`COALESCE(${podcasts.episodeAlertsEnabled}, 0)`.as(
        "episodeAlertsEnabled",
      ),
    })
    .from(podcasts)
    .where(eq(podcasts.slug, slug))
    .limit(1)
    .get();
}

export type ListPublicPodcastsOptions = {
  limit: number;
  offset: number;
  /** Pre-escaped LIKE pattern (e.g. %foo%) or null for no search. Use utils.likeEscape. */
  searchPattern: string | null;
  sortNewestFirst: boolean;
};

/** List public (unlisted=0) podcasts with optional search and sort. */
export function listPublicPodcasts(options: ListPublicPodcastsOptions) {
  const { limit, offset, searchPattern: likePattern, sortNewestFirst } = options;
  const whereCond = likePattern
    ? and(
        sql`COALESCE(${podcasts.unlisted}, 0) = 0`,
        or(
          sql`${podcasts.title} LIKE ${likePattern} ESCAPE '\\'`,
          sql`${podcasts.slug} LIKE ${likePattern} ESCAPE '\\'`,
          sql`${podcasts.authorName} LIKE ${likePattern} ESCAPE '\\'`,
          sql`${podcasts.description} LIKE ${likePattern} ESCAPE '\\'`,
        )!,
      )
    : sql`COALESCE(${podcasts.unlisted}, 0) = 0`;

  const totalRow = drizzleDb
    .select({ count: sql<number>`count(*)`.as("count") })
    .from(podcasts)
    .where(whereCond)
    .get();
  const total = Number(totalRow?.count ?? 0);

  const rows = drizzleDb
    .select({
      id: podcasts.id,
      title: podcasts.title,
      slug: podcasts.slug,
      description: podcasts.description,
      language: podcasts.language,
      authorName: podcasts.authorName,
      artworkUrl: podcasts.artworkUrl,
      artworkPath: podcasts.artworkPath,
      siteUrl: podcasts.siteUrl,
      explicit: podcasts.explicit,
      createdAt: podcasts.createdAt,
      publicFeedDisabled: sql<number>`COALESCE(${podcasts.publicFeedDisabled}, 0)`.as("publicFeedDisabled"),
      subscriberOnlyFeedEnabled: sql<number>`COALESCE(${podcasts.subscriberOnlyFeedEnabled}, 0)`.as("subscriberOnlyFeedEnabled"),
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
    })
    .from(podcasts)
    .where(whereCond)
    .orderBy(sortNewestFirst ? desc(podcasts.createdAt) : asc(podcasts.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return { rows, total };
}

/** Get export row with non-empty publicBaseUrl for a podcast (for RSS URL in DTO). */
export function getExportWithPublicBaseUrl(podcastId: string) {
  return drizzleDb
    .select()
    .from(exportsTable)
    .where(
      and(
        eq(exportsTable.podcastId, podcastId),
        sql`${exportsTable.publicBaseUrl} IS NOT NULL AND LENGTH(TRIM(${exportsTable.publicBaseUrl})) > 0`,
      ),
    )
    .limit(1)
    .get();
}

/** Get podcast artwork path by id. */
export function getPodcastArtworkPath(podcastId: string): string | null | undefined {
  const row = drizzleDb
    .select({ artworkPath: podcasts.artworkPath })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row?.artworkPath ?? undefined;
}

/** Get episode artwork path by episode id and podcast id. */
export function getEpisodeArtworkPath(
  episodeId: string,
  podcastId: string,
): string | null | undefined {
  const row = drizzleDb
    .select({ artworkPath: episodes.artworkPath })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.podcastId, podcastId),
      ),
    )
    .limit(1)
    .get();
  return row?.artworkPath ?? undefined;
}

/** Get cast member photo path (public cast only). */
export function getCastPhotoPath(
  castId: string,
  podcastId: string,
): string | null | undefined {
  const row = drizzleDb
    .select({ photoPath: podcastCast.photoPath })
    .from(podcastCast)
    .where(
      and(
        eq(podcastCast.id, castId),
        eq(podcastCast.podcastId, podcastId),
        eq(podcastCast.isPublic, true),
      ),
    )
    .limit(1)
    .get();
  return row?.photoPath ?? undefined;
}

/** Get podcast id by slug where unlisted=0 (for listing/discovery only; cast uses getPodcastIdBySlug). */
export function getPodcastIdBySlugUnlistedFalse(slug: string): string | undefined {
  const row = drizzleDb
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(
      and(
        eq(podcasts.slug, slug),
        sql`COALESCE(${podcasts.unlisted}, 0) = 0`,
      ),
    )
    .limit(1)
    .get();
  return row?.id;
}

/** Hosts for a podcast (public). */
export function getPodcastCastHosts(podcastId: string) {
  return drizzleDb
    .select({
      id: podcastCast.id,
      name: podcastCast.name,
      role: podcastCast.role,
      description: podcastCast.description,
      photoPath: podcastCast.photoPath,
      photoUrl: podcastCast.photoUrl,
      socialLinkText: podcastCast.socialLinkText,
    })
    .from(podcastCast)
    .where(
      and(
        eq(podcastCast.podcastId, podcastId),
        eq(podcastCast.role, "host"),
        eq(podcastCast.isPublic, true),
      ),
    )
    .orderBy(desc(podcastCast.createdAt))
    .all();
}

/** Guests for a podcast (public) with pagination. */
export function getPodcastCastGuests(
  podcastId: string,
  limit: number,
  offset: number,
) {
  const whereCond = and(
    eq(podcastCast.podcastId, podcastId),
    eq(podcastCast.role, "guest"),
    eq(podcastCast.isPublic, true),
  );
  const countRow = drizzleDb
    .select({ count: sql<number>`count(*)`.as("count") })
    .from(podcastCast)
    .where(whereCond)
    .get();
  const total = Number(countRow?.count ?? 0);
  const rows = drizzleDb
    .select({
      id: podcastCast.id,
      name: podcastCast.name,
      role: podcastCast.role,
      description: podcastCast.description,
      photoPath: podcastCast.photoPath,
      photoUrl: podcastCast.photoUrl,
      socialLinkText: podcastCast.socialLinkText,
    })
    .from(podcastCast)
    .where(whereCond)
    .orderBy(desc(podcastCast.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  return { rows, total };
}

/** Get episode cast (public) by podcast slug and episode slug. Includes unlisted podcasts (by direct link). */
export function getEpisodeCastBySlugs(podcastSlug: string, episodeSlug: string) {
  const podcast = drizzleDb
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(eq(podcasts.slug, podcastSlug))
    .limit(1)
    .get();
  if (!podcast) return [];
  const episodeRow = drizzleDb
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcast.id),
        eq(episodes.slug, episodeSlug),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get();
  if (!episodeRow) return [];
  return drizzleDb
    .select({
      id: podcastCast.id,
      podcastId: podcastCast.podcastId,
      name: podcastCast.name,
      role: podcastCast.role,
      description: podcastCast.description,
      photoPath: podcastCast.photoPath,
      photoUrl: podcastCast.photoUrl,
      socialLinkText: podcastCast.socialLinkText,
      isPublic: podcastCast.isPublic,
      createdAt: podcastCast.createdAt,
    })
    .from(podcastCast)
    .innerJoin(episodeCast, eq(episodeCast.castId, podcastCast.id))
    .where(
      and(
        eq(episodeCast.episodeId, episodeRow.id),
        eq(podcastCast.isPublic, true),
      ),
    )
    .orderBy(asc(podcastCast.role), desc(podcastCast.createdAt))
    .all();
}

export type ListPublishedEpisodesOptions = {
  limit: number;
  offset: number;
  sort: "newest" | "oldest";
  /** Pre-escaped LIKE pattern or null. Use utils.likeEscape. */
  searchPattern: string | null;
  includeSubscriberOnly: boolean;
  /** When true, include scheduled/published episodes with future publishAt (shown as placeholder). */
  includeScheduledEpisodes: boolean;
  /** When set, only return episodes with this episode_type (full | trailer | bonus). */
  episodeType?: string | null;
};

const publishedEpisodeWhereBase = and(
  eq(episodes.status, "published"),
  sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
);

/** List published episodes for a podcast. */
export function listPublishedEpisodes(
  podcastId: string,
  options: ListPublishedEpisodesOptions,
) {
  const { limit, offset, sort, searchPattern: likePattern, includeSubscriberOnly, includeScheduledEpisodes, episodeType } = options;
  const scheduledOrPublishedBase = and(
    eq(episodes.podcastId, podcastId),
    inArray(episodes.status, ["scheduled", "published"]),
  );
  const baseWhere = includeScheduledEpisodes
    ? scheduledOrPublishedBase
    : and(eq(episodes.podcastId, podcastId), publishedEpisodeWhereBase);
  const episodeWhereSubscriber = includeSubscriberOnly
    ? baseWhere
    : and(baseWhere, eq(episodes.subscriberOnly, false));
  const episodeWhereType =
    episodeType != null && episodeType !== ""
      ? and(episodeWhereSubscriber, eq(episodes.episodeType, episodeType))
      : episodeWhereSubscriber;
  const episodeWhereSearch = likePattern
    ? and(
        episodeWhereType,
        or(
          sql`${episodes.title} LIKE ${likePattern} ESCAPE '\\'`,
          sql`COALESCE(${episodes.description}, '') LIKE ${likePattern} ESCAPE '\\'`,
        )!,
      )
    : episodeWhereType;

  const totalRow = drizzleDb
    .select({ count: sql<number>`count(*)`.as("count") })
    .from(episodes)
    .where(episodeWhereSearch)
    .get();
  const total = Number(totalRow?.count ?? 0);

  const rows = drizzleDb
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      title: episodes.title,
      slug: episodes.slug,
      description: episodes.description,
      descriptionCopyrightSnapshot: episodes.descriptionCopyrightSnapshot,
      guid: episodes.guid,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeType: episodes.episodeType,
      explicit: episodes.explicit,
      publishAt: episodes.publishAt,
      artworkUrl: episodes.artworkUrl,
      artworkPath: episodes.artworkPath,
      audioMime: episodes.audioMime,
      audioBytes: episodes.audioBytes,
      audioDurationSec: episodes.audioDurationSec,
      audioFinalPath: episodes.audioFinalPath,
      finalMarkers: episodes.finalMarkers,
      finalSoundbites: episodes.finalSoundbites,
      subscriberOnly: sql<number>`COALESCE(${episodes.subscriberOnly}, 0)`.as("subscriberOnly"),
      createdAt: episodes.createdAt,
      updatedAt: episodes.updatedAt,
    })
    .from(episodes)
    .where(episodeWhereSearch)
    .orderBy(
      sort === "oldest" ? asc(episodes.publishAt) : desc(episodes.publishAt),
      sort === "oldest" ? asc(episodes.createdAt) : desc(episodes.createdAt),
    )
    .limit(limit)
    .offset(offset)
    .all();

  return { rows, total };
}

/** Get a single published episode by podcast id and episode slug. */
export function getPublishedEpisodeBySlug(podcastId: string, episodeSlug: string) {
  return drizzleDb
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      title: episodes.title,
      slug: episodes.slug,
      description: episodes.description,
      descriptionCopyrightSnapshot: episodes.descriptionCopyrightSnapshot,
      guid: episodes.guid,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeType: episodes.episodeType,
      explicit: episodes.explicit,
      publishAt: episodes.publishAt,
      artworkUrl: episodes.artworkUrl,
      artworkPath: episodes.artworkPath,
      audioMime: episodes.audioMime,
      audioBytes: episodes.audioBytes,
      audioDurationSec: episodes.audioDurationSec,
      audioFinalPath: episodes.audioFinalPath,
      videoFinalPath: episodes.videoFinalPath,
      finalMarkers: episodes.finalMarkers,
      finalSoundbites: episodes.finalSoundbites,
      subscriberOnly: sql<number>`COALESCE(${episodes.subscriberOnly}, 0)`.as("subscriberOnly"),
      createdAt: episodes.createdAt,
      updatedAt: episodes.updatedAt,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.slug, episodeSlug),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get();
}

/** Get a single episode by slug for public page; when includeScheduled is true, includes scheduled/published with future publishAt. */
export function getPublicEpisodeBySlug(
  podcastId: string,
  episodeSlug: string,
  includeScheduled: boolean,
) {
  const strictWhere = and(
    eq(episodes.podcastId, podcastId),
    eq(episodes.slug, episodeSlug),
    eq(episodes.status, "published"),
    sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
  );
  const relaxedWhere = and(
    eq(episodes.podcastId, podcastId),
    eq(episodes.slug, episodeSlug),
    inArray(episodes.status, ["scheduled", "published"]),
  );
  return drizzleDb
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      title: episodes.title,
      slug: episodes.slug,
      description: episodes.description,
      descriptionCopyrightSnapshot: episodes.descriptionCopyrightSnapshot,
      guid: episodes.guid,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeType: episodes.episodeType,
      explicit: episodes.explicit,
      publishAt: episodes.publishAt,
      artworkUrl: episodes.artworkUrl,
      artworkPath: episodes.artworkPath,
      audioMime: episodes.audioMime,
      audioBytes: episodes.audioBytes,
      audioDurationSec: episodes.audioDurationSec,
      audioFinalPath: episodes.audioFinalPath,
      videoFinalPath: episodes.videoFinalPath,
      finalMarkers: episodes.finalMarkers,
      finalSoundbites: episodes.finalSoundbites,
      subscriberOnly: sql<number>`COALESCE(${episodes.subscriberOnly}, 0)`.as("subscriberOnly"),
      createdAt: episodes.createdAt,
      updatedAt: episodes.updatedAt,
      fundingLinks: episodes.fundingLinks,
    })
    .from(episodes)
    .where(includeScheduled ? relaxedWhere : strictWhere)
    .limit(1)
    .get();
}

/** Get episode row for waveform (id, audioFinalPath, subscriberOnly). */
export function getEpisodeForWaveform(
  podcastId: string,
  episodeSlug: string,
): { id: string; audioFinalPath: string | null; subscriberOnly: number } | undefined {
  const row = drizzleDb
    .select({
      id: episodes.id,
      audioFinalPath: episodes.audioFinalPath,
      subscriberOnly: sql<number>`COALESCE(${episodes.subscriberOnly}, 0)`.as("subscriberOnly"),
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.slug, episodeSlug),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get();
  return row as
    | { id: string; audioFinalPath: string | null; subscriberOnly: number }
    | undefined;
}

/** Get episode video path for private stream (by episode id and podcast id). */
export function getEpisodeVideoForPrivate(
  podcastId: string,
  episodeId: string,
): { id: string; videoFinalPath: string | null } | undefined {
  return drizzleDb
    .select({
      id: episodes.id,
      videoFinalPath: episodes.videoFinalPath,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.id, episodeId),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get() as { id: string; videoFinalPath: string | null } | undefined;
}

/** Get episode audio path for private stream (by episode id and podcast id). */
export function getEpisodeAudioForPrivate(
  podcastId: string,
  episodeId: string,
): { id: string; audioFinalPath: string | null; audioMime: string | null } | undefined {
  return drizzleDb
    .select({
      id: episodes.id,
      audioFinalPath: episodes.audioFinalPath,
      audioMime: episodes.audioMime,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.id, episodeId),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get() as
    | { id: string; audioFinalPath: string | null; audioMime: string | null }
    | undefined;
}

/** Resolve episode by id or slug for a podcast (for private transcript/chapters). */
export function getPublishedEpisodeByIdOrSlug(
  podcastId: string,
  episodeIdOrSlug: string,
): { id: string; slug: string | null } | undefined {
  const byId = drizzleDb
    .select({ id: episodes.id, slug: episodes.slug })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.id, episodeIdOrSlug),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get();
  if (byId) return byId as { id: string; slug: string | null };
  return drizzleDb
    .select({ id: episodes.id, slug: episodes.slug })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.slug, episodeIdOrSlug),
        eq(episodes.status, "published"),
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(1)
    .get() as { id: string; slug: string | null } | undefined;
}
