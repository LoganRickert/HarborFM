import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  contactMessages,
  episodes,
  podcasts,
} from "../../db/schema.js";
import type { ContactMessageRow } from "./utils.js";

function likeEscape(s: string): string {
  return s.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export type ListMessagesOptions = {
  page: number;
  limit: number;
  search: string;
  sort: "newest" | "oldest";
};

/**
 * List contact messages with pagination. Admins see all; others see only
 * messages for podcasts they own.
 */
export function listMessages(
  userId: string,
  isAdmin: boolean,
  options: ListMessagesOptions,
): { rows: ContactMessageRow[]; total: number } {
  const { page, limit, search, sort } = options;
  const offset = (page - 1) * limit;
  const searchPattern = search ? `%${likeEscape(search)}%` : null;

  const ownerCondition = isAdmin
    ? undefined
    : sql`${contactMessages.podcastId} IN (SELECT id FROM podcasts WHERE owner_user_id = ${userId})`;

  const searchCondition = searchPattern
    ? or(
        like(contactMessages.name, searchPattern),
        like(contactMessages.email, searchPattern),
        like(contactMessages.message, searchPattern),
      )
    : undefined;

  const whereConditions = [ownerCondition, searchCondition].filter(
    (c): c is NonNullable<typeof c> => c !== undefined,
  );
  const whereClause =
    whereConditions.length > 0 ? and(...whereConditions) : undefined;

  const totalRow = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(contactMessages)
    .where(whereClause)
    .get();
  const total = totalRow?.count ?? 0;

  const orderBy =
    sort === "oldest"
      ? asc(contactMessages.createdAt)
      : desc(contactMessages.createdAt);

  const rows = drizzleDb
    .select({
      id: contactMessages.id,
      name: contactMessages.name,
      email: contactMessages.email,
      message: contactMessages.message,
      createdAt: contactMessages.createdAt,
      podcastId: contactMessages.podcastId,
      episodeId: contactMessages.episodeId,
      podcastTitle: podcasts.title,
      episodeTitle: episodes.title,
    })
    .from(contactMessages)
    .leftJoin(podcasts, eq(contactMessages.podcastId, podcasts.id))
    .leftJoin(episodes, eq(contactMessages.episodeId, episodes.id))
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)
    .all();

  const normalizedRows: ContactMessageRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    message: r.message,
    createdAt: r.createdAt,
    podcastId: r.podcastId,
    episodeId: r.episodeId,
    podcastTitle: r.podcastTitle ?? null,
    episodeTitle: r.episodeTitle ?? null,
  }));

  return { rows: normalizedRows, total };
}
