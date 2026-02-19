import { asc, eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { podcasts } from "../../db/schema.js";

/** List public podcast id + slug (unlisted = 0), ordered by createdAt asc. */
export function listPublicPodcastSlugs(): Array<{ id: string; slug: string }> {
  return drizzleDb
    .select({ id: podcasts.id, slug: podcasts.slug })
    .from(podcasts)
    .where(sql`COALESCE(${podcasts.unlisted}, 0) = 0`)
    .orderBy(asc(podcasts.createdAt))
    .all();
}

/** Get podcast id by slug; undefined if not found. */
export function getPodcastIdBySlug(slug: string): string | undefined {
  const row = drizzleDb
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(eq(podcasts.slug, slug))
    .limit(1)
    .get();
  return row?.id;
}
