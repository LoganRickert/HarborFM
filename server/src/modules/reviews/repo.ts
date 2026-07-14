import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { episodes, podcasts, reviews } from "../../db/schema.js";

function likeEscape(s: string): string {
  return s.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export type CreateReviewInput = {
  id: string;
  podcastId: string;
  episodeId: string | null;
  userId: string | null;
  name: string;
  email: string;
  rating: number;
  body: string;
  verified: boolean;
  approved: boolean;
  spam: boolean;
  hidden: boolean;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: string | null;
  deleteTokenHash: string | null;
  deleteTokenExpiresAt: string | null;
};

export function createReview(input: CreateReviewInput): void {
  drizzleDb.insert(reviews).values({
    id: input.id,
    podcastId: input.podcastId,
    episodeId: input.episodeId,
    userId: input.userId,
    name: input.name,
    email: input.email,
    rating: input.rating,
    body: input.body,
    verified: input.verified,
    approved: input.approved,
    spam: input.spam,
    hidden: input.hidden,
    emailVerificationTokenHash: input.emailVerificationTokenHash,
    emailVerificationExpiresAt: input.emailVerificationExpiresAt,
    deleteTokenHash: input.deleteTokenHash,
    deleteTokenExpiresAt: input.deleteTokenExpiresAt,
  }).run();
}

export function getReviewById(reviewId: string): {
  id: string;
  podcastId: string;
  episodeId: string | null;
  userId: string | null;
  name: string;
  email: string;
  rating: number;
  body: string;
  verified: boolean;
  approved: boolean;
  spam: boolean;
  hidden: boolean;
  createdAt: string;
} | undefined {
  const row = drizzleDb
    .select({
      id: reviews.id,
      podcastId: reviews.podcastId,
      episodeId: reviews.episodeId,
      userId: reviews.userId,
      name: reviews.name,
      email: reviews.email,
      rating: reviews.rating,
      body: reviews.body,
      verified: reviews.verified,
      approved: reviews.approved,
      spam: reviews.spam,
      hidden: reviews.hidden,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1)
    .get();
  if (!row) return undefined;
  return {
    ...row,
    userId: row.userId ?? null,
    verified: Boolean(row.verified),
    approved: Boolean(row.approved),
    spam: Boolean(row.spam),
    hidden: Boolean(row.hidden),
  };
}

/** Count non-hidden reviews for this podcast + email (podcast-level: episode_id IS NULL). */
export function countReviewsByPodcastAndEmail(
  podcastId: string,
  email: string,
): number {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(reviews)
    .where(
      and(
        eq(reviews.podcastId, podcastId),
        eq(reviews.email, email),
        eq(reviews.hidden, false),
        sql`${reviews.episodeId} IS NULL`,
      ),
    )
    .get();
  return row?.count ?? 0;
}

/** Count non-hidden reviews for this episode + email. */
export function countReviewsByEpisodeAndEmail(
  episodeId: string,
  email: string,
): number {
  const row = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(reviews)
    .where(
      and(
        eq(reviews.episodeId, episodeId),
        eq(reviews.email, email),
        eq(reviews.hidden, false),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/** Get podcast review-related settings by podcast id. */
export function getPodcastReviewSettings(podcastId: string): {
  subscriberOnlyReviews: boolean;
  allowUnapprovedReviews: boolean;
} | undefined {
  const row = drizzleDb
    .select({
      subscriberOnlyReviews: sql<number>`COALESCE(${podcasts.subscriberOnlyReviews}, 0)`.as("subscriberOnlyReviews"),
      allowUnapprovedReviews: sql<number>`COALESCE(${podcasts.allowUnapprovedReviews}, 1)`.as("allowUnapprovedReviews"),
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!row) return undefined;
  return {
    subscriberOnlyReviews: (row as { subscriberOnlyReviews: number }).subscriberOnlyReviews === 1,
    allowUnapprovedReviews: (row as { allowUnapprovedReviews: number }).allowUnapprovedReviews === 1,
  };
}

export type ListReviewsForPodcastOptions = {
  podcastId: string;
  page: number;
  limit: number;
  search: string;
  sort: "newest" | "oldest";
};

export type ReviewRow = {
  id: string;
  podcastId: string;
  episodeId: string | null;
  userId?: string | null;
  name: string;
  email: string;
  rating: number;
  body: string;
  verified: boolean;
  approved: boolean;
  spam: boolean;
  hidden: boolean;
  createdAt: string;
  episodeTitle: string | null;
};

export function listReviewsForPodcast(
  options: ListReviewsForPodcastOptions,
): { rows: ReviewRow[]; total: number } {
  const { podcastId, page, limit, search, sort } = options;
  const offset = (page - 1) * limit;
  const searchPattern = search ? `%${likeEscape(search)}%` : null;

  const searchCondition = searchPattern
    ? or(
        like(reviews.name, searchPattern),
        like(reviews.email, searchPattern),
        like(reviews.body, searchPattern),
      )
    : undefined;

  const whereClause = searchCondition
    ? and(eq(reviews.podcastId, podcastId), eq(reviews.hidden, false), searchCondition)
    : and(eq(reviews.podcastId, podcastId), eq(reviews.hidden, false));

  const totalRow = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(reviews)
    .where(whereClause)
    .get();
  const total = totalRow?.count ?? 0;

  const orderBy =
    sort === "oldest"
      ? asc(reviews.createdAt)
      : desc(reviews.createdAt);

  const rows = drizzleDb
    .select({
      id: reviews.id,
      podcastId: reviews.podcastId,
      episodeId: reviews.episodeId,
      userId: reviews.userId,
      name: reviews.name,
      email: reviews.email,
      rating: reviews.rating,
      body: reviews.body,
      verified: reviews.verified,
      approved: reviews.approved,
      spam: reviews.spam,
      hidden: reviews.hidden,
      createdAt: reviews.createdAt,
      episodeTitle: episodes.title,
    })
    .from(reviews)
    .leftJoin(episodes, eq(reviews.episodeId, episodes.id))
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)
    .all();

  return {
    rows: rows.map((r) => ({
      ...r,
      verified: Boolean(r.verified),
      approved: Boolean(r.approved),
      spam: Boolean(r.spam),
      hidden: Boolean(r.hidden),
      episodeTitle: r.episodeTitle ?? null,
    })),
    total,
  };
}

export function setReviewVerified(reviewId: string): boolean {
  const result = drizzleDb
    .update(reviews)
    .set({
      verified: true,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    })
    .where(eq(reviews.id, reviewId))
    .run();
  return result.changes > 0;
}

/** Approve a review and clear the spam flag so it can appear on the public feed. */
export function setReviewApproved(reviewId: string): boolean {
  const result = drizzleDb
    .update(reviews)
    .set({ approved: true, spam: false })
    .where(eq(reviews.id, reviewId))
    .run();
  return result.changes > 0;
}

export function setReviewHidden(reviewId: string): boolean {
  const result = drizzleDb
    .update(reviews)
    .set({ hidden: true, deleteTokenHash: null, deleteTokenExpiresAt: null })
    .where(eq(reviews.id, reviewId))
    .run();
  return result.changes > 0;
}

/** Get podcast slug by id (for redirect URL). */
export function getPodcastSlugById(podcastId: string): string | undefined {
  const row = drizzleDb
    .select({ slug: podcasts.slug })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row?.slug ?? undefined;
}

/** Get episode slug by id (for redirect URL). */
export function getEpisodeSlugById(episodeId: string): string | undefined {
  const row = drizzleDb
    .select({ slug: episodes.slug })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  return row?.slug ?? undefined;
}

/** Find review by verification token hash and not expired. Returns review id and podcast id. */
export function findReviewByVerificationToken(tokenHash: string): {
  id: string;
  podcastId: string;
} | undefined {
  const row = drizzleDb
    .select({ id: reviews.id, podcastId: reviews.podcastId })
    .from(reviews)
    .where(
      and(
        eq(reviews.emailVerificationTokenHash, tokenHash),
        sql`datetime(${reviews.emailVerificationExpiresAt}) > datetime('now')`,
      ),
    )
    .limit(1)
    .get();
  return row ?? undefined;
}

/** Find review by delete token hash and not expired. Returns review id and podcast id. */
export function findReviewByDeleteToken(tokenHash: string): {
  id: string;
  podcastId: string;
} | undefined {
  const row = drizzleDb
    .select({ id: reviews.id, podcastId: reviews.podcastId })
    .from(reviews)
    .where(
      and(
        eq(reviews.deleteTokenHash, tokenHash),
        sql`datetime(${reviews.deleteTokenExpiresAt}) > datetime('now')`,
      ),
    )
    .limit(1)
    .get();
  return row ?? undefined;
}

export type ListPublicReviewsOptions = {
  podcastId: string;
  episodeId: string | null;
  limit: number;
  offset: number;
  publishNonVerified: boolean;
  /** When true, include verified reviews even if not approved. When false, only show approved. */
  allowUnapprovedReviews: boolean;
};

/** List reviews for public feed: not hidden, not spam; require verified (unless publishNonVerified); require approved only when !allowUnapprovedReviews. */
export function listPublicReviews(options: ListPublicReviewsOptions): ReviewRow[] {
  const { podcastId, episodeId, limit, offset, publishNonVerified, allowUnapprovedReviews } = options;
  const conditions = [
    eq(reviews.podcastId, podcastId),
    eq(reviews.hidden, false),
    eq(reviews.spam, false),
  ];
  if (!allowUnapprovedReviews) {
    conditions.push(eq(reviews.approved, true));
  }
  if (episodeId !== null) {
    conditions.push(eq(reviews.episodeId, episodeId));
  } else {
    conditions.push(sql`${reviews.episodeId} IS NULL`);
  }
  if (!publishNonVerified) {
    conditions.push(eq(reviews.verified, true));
  }
  const rows = drizzleDb
    .select({
      id: reviews.id,
      podcastId: reviews.podcastId,
      episodeId: reviews.episodeId,
      userId: reviews.userId,
      name: reviews.name,
      email: reviews.email,
      rating: reviews.rating,
      body: reviews.body,
      verified: reviews.verified,
      approved: reviews.approved,
      spam: reviews.spam,
      hidden: reviews.hidden,
      createdAt: reviews.createdAt,
      episodeTitle: episodes.title,
    })
    .from(reviews)
    .leftJoin(episodes, eq(reviews.episodeId, episodes.id))
    .where(and(...conditions))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map((r) => ({
    ...r,
    userId: r.userId ?? null,
    verified: Boolean(r.verified),
    approved: Boolean(r.approved),
    spam: Boolean(r.spam),
    hidden: Boolean(r.hidden),
    episodeTitle: r.episodeTitle ?? null,
  }));
}
