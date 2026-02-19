import { and, eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  contactMessages,
  episodes,
  podcasts,
  users,
} from "../../db/schema.js";

/** Get podcast id and title by slug for contact context. */
export function getPodcastIdAndTitleBySlug(
  slug: string,
): { id: string; title: string } | undefined {
  return drizzleDb
    .select({ id: podcasts.id, title: podcasts.title })
    .from(podcasts)
    .where(eq(podcasts.slug, slug))
    .limit(1)
    .get();
}

/** Get episode id and title by podcastId and episode slug. */
export function getEpisodeIdAndTitleByPodcastAndSlug(
  podcastId: string,
  episodeSlug: string,
): { id: string; title: string } | undefined {
  return drizzleDb
    .select({ id: episodes.id, title: episodes.title })
    .from(episodes)
    .where(
      and(
        eq(episodes.podcastId, podcastId),
        eq(episodes.slug, episodeSlug),
      ),
    )
    .limit(1)
    .get();
}

/** True if the podcast owner user has readOnly = 1. */
export function isPodcastOwnerReadOnly(podcastId: string): boolean {
  const row = drizzleDb
    .select({
      readOnly: sql<number>`COALESCE(${users.readOnly}, 0)`,
    })
    .from(podcasts)
    .innerJoin(users, eq(podcasts.ownerUserId, users.id))
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row?.readOnly === 1;
}

/** Insert a contact message. */
export function insertContactMessage(values: {
  id: string;
  name: string;
  email: string;
  message: string;
  podcastId: string | null;
  episodeId: string | null;
}): void {
  drizzleDb.insert(contactMessages).values(values).run();
}

/** Get email recipients for contact notification: podcast owner if podcastId and not disabled, else admin emails. */
export function getContactRecipients(podcastId: string | null): string[] {
  if (podcastId) {
    const owner = drizzleDb
      .select({ email: users.email })
      .from(podcasts)
      .innerJoin(users, eq(podcasts.ownerUserId, users.id))
      .where(
        and(
          eq(podcasts.id, podcastId),
          sql`COALESCE(${users.disabled}, 0) = 0`,
        ),
      )
      .limit(1)
      .get();
    if (owner?.email?.trim()) {
      return [owner.email.trim()];
    }
  }
  const adminRows = drizzleDb
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        sql`COALESCE(${users.disabled}, 0) = 0`,
      ),
    )
    .all();
  return adminRows
    .map((r) => r.email)
    .filter((e): e is string => typeof e === "string" && e.trim() !== "");
}
