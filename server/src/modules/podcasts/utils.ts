import { basename } from "path";

export const PODCAST_LIST_SELECT = `
    SELECT id, owner_user_id, title, slug, description, subtitle, summary, language, author_name, owner_name,
           email, category_primary, category_secondary, category_primary_two, category_secondary_two,
           category_primary_three, category_secondary_three, explicit, artwork_path, artwork_url, site_url,
           copyright, podcast_guid, locked, license, itunes_type, medium,
           funding_links, persons, update_frequency,
           podcast_txts, social_interacts, locations, chat, value_blocks, blocks, publisher,
           podroll,
           spotify_recent_count, spotify_country_of_origin, apple_podcasts_verify,
           apple_podcasts_url, spotify_url, amazon_music_url, podcast_index_url, listen_notes_url, castbox_url,
           x_url, facebook_url, instagram_url, tiktok_url, youtube_url, discord_url,
           link_domain, managed_domain, managed_sub_domain,
           created_at, updated_at,
           COALESCE(unlisted, 0) AS unlisted, COALESCE(subscriber_only_feed_enabled, 0) AS subscriber_only_feed_enabled,
           COALESCE(public_feed_disabled, 0) AS public_feed_disabled,
           COALESCE(podcasts.max_episodes, (SELECT max_episodes FROM users WHERE id = podcasts.owner_user_id)) AS max_episodes,
           (SELECT COUNT(*) FROM episodes WHERE podcast_id = podcasts.id) AS episode_count
    FROM podcasts`;

function parseJsonObjectArray(raw: string | null | undefined): Record<string, unknown>[] | null {
  if (raw == null || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Serialize JSON array/object for DB; empty → null. Undefined passthrough. */
export function jsonArrayOrNull(payload: unknown[] | null | undefined): string | null | undefined {
  if (payload === undefined) return undefined;
  if (payload == null || payload.length === 0) return null;
  return JSON.stringify(payload);
}

export function jsonObjectOrNull(payload: object | null | undefined): string | null | undefined {
  if (payload === undefined) return undefined;
  if (payload == null) return null;
  return JSON.stringify(payload);
}

export function podcastRowWithFilename<
  T extends {
    artworkPath?: string | null;
    license?: string | null;
    fundingLinks?: string | null;
    updateFrequency?: string | null;
    podcastTxts?: string | null;
    socialInteracts?: string | null;
    locations?: string | null;
    chat?: string | null;
    valueBlocks?: string | null;
    blocks?: string | null;
    publisher?: string | null;
    podroll?: string | null;
  },
>(
  row: T,
): T & {
  artworkFilename: string | null;
  license?: Record<string, unknown> | null;
  fundingLinks?: Record<string, unknown>[] | null;
  updateFrequency?: Record<string, unknown> | null;
  podcastTxts?: Record<string, unknown>[] | null;
  socialInteracts?: Record<string, unknown>[] | null;
  locations?: Record<string, unknown>[] | null;
  chat?: Record<string, unknown> | null;
  valueBlocks?: Record<string, unknown>[] | null;
  blocks?: Record<string, unknown>[] | null;
  publisher?: Record<string, unknown> | null;
  podroll?: Record<string, unknown>[] | null;
} {
  const path = row.artworkPath ?? null;
  // Legacy flat license strings (pre-068) → present as identifier object
  let licenseParsed = parseJsonObject(row.license ?? null);
  if (
    licenseParsed == null &&
    typeof row.license === "string" &&
    row.license.trim() &&
    !row.license.trim().startsWith("{")
  ) {
    licenseParsed = { identifier: row.license.trim() };
  }
  return {
    ...row,
    artworkFilename: path ? basename(path) : null,
    license: licenseParsed,
    fundingLinks: parseJsonObjectArray(row.fundingLinks ?? null),
    updateFrequency: parseJsonObject(row.updateFrequency ?? null),
    podcastTxts: parseJsonObjectArray(row.podcastTxts ?? null),
    socialInteracts: parseJsonObjectArray(row.socialInteracts ?? null),
    locations: parseJsonObjectArray(row.locations ?? null),
    chat: parseJsonObject(row.chat ?? null),
    valueBlocks: parseJsonObjectArray(row.valueBlocks ?? null),
    blocks: parseJsonObjectArray(row.blocks ?? null),
    publisher: parseJsonObject(row.publisher ?? null),
    podroll: parseJsonObjectArray(row.podroll ?? null),
  };
}

export const ARTWORK_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/i;
