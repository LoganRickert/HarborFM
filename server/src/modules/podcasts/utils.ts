import { basename } from "path";

export const PODCAST_LIST_SELECT = `
    SELECT id, owner_user_id, title, slug, description, subtitle, summary, language, author_name, owner_name,
           email, category_primary, category_secondary, category_primary_two, category_secondary_two,
           category_primary_three, category_secondary_three, explicit, artwork_path, artwork_url, site_url,
           copyright, podcast_guid, locked, license, itunes_type, medium,
           funding_url, funding_label, persons, update_frequency_rrule, update_frequency_label,
           spotify_recent_count, spotify_country_of_origin, apple_podcasts_verify,
           apple_podcasts_url, spotify_url, amazon_music_url, podcast_index_url, listen_notes_url, castbox_url,
           x_url, facebook_url, instagram_url, tiktok_url, youtube_url,
           link_domain, managed_domain, managed_sub_domain,
           created_at, updated_at,
           COALESCE(unlisted, 0) AS unlisted, COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled,
           COALESCE(public_feed_disabled, 0) AS public_feed_disabled,
           COALESCE(podcasts.max_episodes, (SELECT max_episodes FROM users WHERE id = podcasts.owner_user_id)) AS max_episodes,
           (SELECT COUNT(*) FROM episodes WHERE podcast_id = podcasts.id) AS episode_count
    FROM podcasts`;

export function podcastRowWithFilename<T extends { artworkPath?: string | null }>(
  row: T,
): T & { artworkFilename: string | null } {
  const path = row.artworkPath ?? null;
  return { ...row, artworkFilename: path ? basename(path) : null };
}

export const ARTWORK_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/i;
