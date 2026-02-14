import { db } from "../../db/index.js";
import { PODCAST_LIST_SELECT, podcastRowWithFilename } from "./utils.js";

export function listOwned(userId: string): Record<string, unknown>[] {
  return db
    .prepare(
      `${PODCAST_LIST_SELECT} WHERE owner_user_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId) as Record<string, unknown>[];
}

export function listShared(userId: string): Record<string, unknown>[] {
  return db
    .prepare(
      `${PODCAST_LIST_SELECT}
         WHERE id IN (SELECT podcast_id FROM podcast_shares WHERE user_id = ?)
         ORDER BY updated_at DESC`,
    )
    .all(userId) as Record<string, unknown>[];
}

export function getShareRole(podcastId: string, userId: string): string | undefined {
  const row = db
    .prepare(
      "SELECT role FROM podcast_shares WHERE podcast_id = ? AND user_id = ?",
    )
    .get(podcastId, userId) as { role: string } | undefined;
  return row?.role;
}

export function getById(id: string): Record<string, unknown> | undefined {
  const row = db
    .prepare(
      `SELECT podcasts.id, podcasts.owner_user_id, podcasts.title, podcasts.slug, podcasts.description,
         podcasts.subtitle, podcasts.summary, podcasts.language, podcasts.author_name, podcasts.owner_name, podcasts.email,
         podcasts.category_primary, podcasts.category_secondary, podcasts.category_primary_two, podcasts.category_secondary_two,
         podcasts.category_primary_three, podcasts.category_secondary_three, podcasts.explicit, podcasts.artwork_path, podcasts.artwork_url, podcasts.site_url,
         podcasts.copyright, podcasts.podcast_guid, podcasts.locked, podcasts.license,
         podcasts.itunes_type, podcasts.medium,
         podcasts.funding_url, podcasts.funding_label, podcasts.persons, podcasts.update_frequency_rrule, podcasts.update_frequency_label,
         podcasts.spotify_recent_count, podcasts.spotify_country_of_origin, podcasts.apple_podcasts_verify,
         podcasts.apple_podcasts_url, podcasts.spotify_url, podcasts.amazon_music_url, podcasts.podcast_index_url,
         podcasts.listen_notes_url, podcasts.castbox_url, podcasts.x_url, podcasts.facebook_url, podcasts.instagram_url,
         podcasts.tiktok_url, podcasts.youtube_url,
         podcasts.link_domain, podcasts.managed_domain, podcasts.managed_sub_domain, podcasts.cloudflare_api_key_enc,
         podcasts.created_at, podcasts.updated_at, podcasts.max_collaborators, podcasts.max_subscriber_tokens,
         COALESCE(podcasts.unlisted, 0) AS unlisted, COALESCE(podcasts.subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled,
         COALESCE(podcasts.public_feed_disabled, 0) AS public_feed_disabled,
         COALESCE(podcasts.max_episodes, (SELECT max_episodes FROM users WHERE id = podcasts.owner_user_id)) AS max_episodes,
         (SELECT COUNT(*) FROM episodes WHERE podcast_id = podcasts.id) AS episode_count
         FROM podcasts WHERE podcasts.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row;
}

export function getByIdWithFilename(id: string): Record<string, unknown> | undefined {
  const row = getById(id);
  return row ? podcastRowWithFilename(row) : undefined;
}

export function getSlug(id: string): string | undefined {
  const row = db
    .prepare("SELECT slug FROM podcasts WHERE id = ?")
    .get(id) as { slug: string } | undefined;
  return row?.slug;
}

export function getArtworkPath(podcastId: string): string | null | undefined {
  const row = db
    .prepare("SELECT artwork_path FROM podcasts WHERE id = ?")
    .get(podcastId) as { artwork_path: string | null } | undefined;
  return row?.artwork_path;
}

export function listByOwnerUserId(
  userId: string,
  sortDir: "ASC" | "DESC",
): Record<string, unknown>[] {
  return db
    .prepare(
      `${PODCAST_LIST_SELECT} WHERE owner_user_id = ? ORDER BY updated_at ${sortDir}`,
    )
    .all(userId) as Record<string, unknown>[];
}

