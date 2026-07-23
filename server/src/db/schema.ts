/**
 * Used as query layer; existing migrate.ts and raw migrations remain for SQLite.
 */
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/sqlite-core";
import { sqlNow } from "./utils.js";

// ---------------------------------------------------------------------------
// Users (001 + 003, 004, 006, 008, 016, 025, 027, 028, 037, 040, 046, 047, 048)
// ---------------------------------------------------------------------------
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").unique(),
    passwordHash: text("password_hash"),
    username: text("username").unique(),
    createdAt: text("created_at").notNull().default(sqlNow()),
    role: text("role").default("user"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    diskBytesUsed: integer("disk_bytes_used").default(0),
    lastLoginAt: text("last_login_at"),
    lastLoginIp: text("last_login_ip"),
    lastLoginUserAgent: text("last_login_user_agent"),
    lastLoginLocation: text("last_login_location"),
    maxPodcasts: integer("max_podcasts"),
    maxStorageMb: integer("max_storage_mb"),
    maxEpisodes: integer("max_episodes"),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(true),
    emailVerificationExpiresAt: text("email_verification_expires_at"),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
    maxCollaborators: integer("max_collaborators"),
    maxSubscriberTokens: integer("max_subscriber_tokens"),
    canTranscribe: integer("can_transcribe"),
    canGenerateVideo: integer("can_generate_video"),
    canStripe: integer("can_stripe"),
    canEpisodeAlert: integer("can_episode_alert"),
    canUploadEpisodeFiles: integer("can_upload_episode_files"),
    canImportTheme: integer("can_import_theme"),
    totpSecretEnc: text("totp_secret_enc"),
    twoFactorMethod: text("two_factor_method"),
    totpLockedUntil: text("totp_locked_until"),
    profileEmailUsernameUpdatedAt: text("profile_email_username_updated_at"),
    pendingEmail: text("pending_email"),
    emailVerificationTokenHash: text("email_verification_token_hash"),
  },
  (table) => [
    index("idx_users_email_verification_token_hash").on(table.emailVerificationTokenHash),
  ],
);

// ---------------------------------------------------------------------------
// Podcasts (001 + 004, 016, 019, 020, 022, 026, 027, 031, 032)
// ---------------------------------------------------------------------------
export const podcasts = sqliteTable(
  "podcasts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description").default(""),
    language: text("language").default("en"),
    authorName: text("author_name").default(""),
    ownerName: text("owner_name").default(""),
    email: text("email").default(""),
    categoryPrimary: text("category_primary").default(""),
    categorySecondary: text("category_secondary"),
    categoryPrimaryTwo: text("category_primary_two"),
    categorySecondaryTwo: text("category_secondary_two"),
    categoryPrimaryThree: text("category_primary_three"),
    categorySecondaryThree: text("category_secondary_three"),
    explicit: integer("explicit", { mode: "boolean" }).notNull().default(false),
    artworkPath: text("artwork_path"),
    artworkUrl: text("artwork_url"),
    siteUrl: text("site_url"),
    copyright: text("copyright"),
    podcastGuid: text("podcast_guid"),
    locked: integer("locked", { mode: "boolean" }).default(false),
    license: text("license"),
    itunesType: text("itunes_type").default("episodic"),
    medium: text("medium").default("podcast"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
    maxEpisodes: integer("max_episodes"),
    maxCollaborators: integer("max_collaborators"),
    subtitle: text("subtitle"),
    summary: text("summary"),
    fundingLinks: text("funding_links"),
    persons: text("persons"),
    updateFrequency: text("update_frequency"),
    podcastTxts: text("podcast_txts"),
    socialInteracts: text("social_interacts"),
    locations: text("locations"),
    chat: text("chat"),
    valueBlocks: text("value_blocks"),
    blocks: text("blocks"),
    publisher: text("publisher"),
    podroll: text("podroll"),
    spotifyRecentCount: integer("spotify_recent_count"),
    spotifyCountryOfOrigin: text("spotify_country_of_origin"),
    applePodcastsVerify: text("apple_podcasts_verify"),
    unlisted: integer("unlisted", { mode: "boolean" }).default(false),
    subscriberOnlyFeedEnabled: integer("subscriber_only_feed_enabled", { mode: "boolean" }).default(false),
    maxSubscriberTokens: integer("max_subscriber_tokens"),
    publicFeedDisabled: integer("public_feed_disabled", { mode: "boolean" }).default(false),
    linkDomain: text("link_domain"),
    managedDomain: text("managed_domain"),
    managedSubDomain: text("managed_sub_domain"),
    cloudflareApiKeyEnc: text("cloudflare_api_key_enc"),
    applePodcastsUrl: text("apple_podcasts_url"),
    spotifyUrl: text("spotify_url"),
    amazonMusicUrl: text("amazon_music_url"),
    podcastIndexUrl: text("podcast_index_url"),
    listenNotesUrl: text("listen_notes_url"),
    castboxUrl: text("castbox_url"),
    xUrl: text("x_url"),
    facebookUrl: text("facebook_url"),
    instagramUrl: text("instagram_url"),
    tiktokUrl: text("tiktok_url"),
    youtubeUrl: text("youtube_url"),
    discordUrl: text("discord_url"),
    allowUnapprovedReviews: integer("allow_unapproved_reviews", { mode: "boolean" }).default(true),
    subscriberOnlyReviews: integer("subscriber_only_reviews", { mode: "boolean" }).default(false),
    subscriberOnlyMessages: integer("subscriber_only_messages", { mode: "boolean" }).default(false),
    showScheduledEpisodes: integer("show_scheduled_episodes", { mode: "boolean" }).default(false),
    subscribersKeepExpiredEpisodes: integer("subscribers_keep_expired_episodes", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    stripeCredentialsId: text("stripe_credentials_id"),
    stripePaymentsEnabled: integer("stripe_payments_enabled", {
      mode: "boolean",
    }).default(false),
    stripeCheckoutPaused: integer("stripe_checkout_paused", {
      mode: "boolean",
    }).default(false),
    billingAnchor: text("billing_anchor").notNull().default("anniversary"),
    feedAccent: text("feed_accent").default("green"),
    feedShowPodcastDescription: integer("feed_show_podcast_description", {
      mode: "boolean",
    }).default(true),
    feedShowEpisodeDescription: integer("feed_show_episode_description", {
      mode: "boolean",
    }).default(true),
    feedShowFunding: integer("feed_show_funding", { mode: "boolean" }).default(true),
    feedShowReviewsPodcast: integer("feed_show_reviews_podcast", {
      mode: "boolean",
    }).default(true),
    feedShowReviewsEpisode: integer("feed_show_reviews_episode", {
      mode: "boolean",
    }).default(true),
    feedShowAuthor: integer("feed_show_author", { mode: "boolean" }).default(true),
    feedShowPodroll: integer("feed_show_podroll", { mode: "boolean" }).default(true),
    feedShowCast: integer("feed_show_cast", { mode: "boolean" }).default(true),
    feedTheme: text("feed_theme").default("default"),
    episodeAlertsEnabled: integer("episode_alerts_enabled", {
      mode: "boolean",
    }).default(false),
    episodeAlertsCheckoutList: text("episode_alerts_checkout_list")
      .notNull()
      .default("subscribers"),
    episodeAlertsMailingAddress: text("episode_alerts_mailing_address"),
  },
  (table) => [
    unique("users_podcasts_owner_slug").on(table.ownerUserId, table.slug),
    index("idx_podcasts_owner").on(table.ownerUserId),
    index("idx_podcasts_guid").on(table.podcastGuid),
  ],
);

// ---------------------------------------------------------------------------
// Episodes (001 + 005, 020, 021, 023, 034, 035, 036)
// ---------------------------------------------------------------------------
export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").default(""),
    guid: text("guid").notNull(),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    episodeType: text("episode_type"),
    explicit: integer("explicit", { mode: "boolean" }),
    publishAt: text("publish_at"),
    /** When set and in the past, episode is omitted from public surfaces (and private unless podcast keeps expired). */
    expiresAt: text("expires_at"),
    status: text("status").notNull().default("draft"),
    artworkPath: text("artwork_path"),
    artworkUrl: text("artwork_url"),
    audioSourcePath: text("audio_source_path"),
    audioFinalPath: text("audio_final_path"),
    audioMime: text("audio_mime"),
    audioBytes: integer("audio_bytes"),
    audioDurationSec: integer("audio_duration_sec"),
    slug: text("slug"),
    episodeLink: text("episode_link"),
    guidIsPermalink: integer("guid_is_permalink", { mode: "boolean" }).default(false),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
    descriptionCopyrightSnapshot: text("description_copyright_snapshot"),
    subtitle: text("subtitle"),
    summary: text("summary"),
    contentEncoded: text("content_encoded"),
    subscriberOnly: integer("subscriber_only", { mode: "boolean" }).default(false),
    subscriberOnlyStartsAt: text("subscriber_only_starts_at"),
    subscriberOnlyEndsAt: text("subscriber_only_ends_at"),
    finalMarkers: text("final_markers"),
    finalSoundbites: text("final_soundbites"),
    contentLinks: text("content_links"),
    podcastTxts: text("podcast_txts"),
    socialInteracts: text("social_interacts"),
    locations: text("locations"),
    license: text("license"),
    podcastImages: text("podcast_images"),
    fundingLinks: text("funding_links"),
    chat: text("chat"),
    valueBlocks: text("value_blocks"),
    videoFinalPath: text("video_final_path"),
    showNotesGuestVisible: integer("show_notes_guest_visible", { mode: "boolean" })
      .notNull()
      .default(false),
    episodeAlertsSentAt: text("episode_alerts_sent_at"),
  },
  (table) => [
    unique("episodes_podcast_guid").on(table.podcastId, table.guid),
    index("idx_episodes_podcast").on(table.podcastId),
    index("idx_episodes_status").on(table.status),
    index("idx_episodes_publish_at").on(table.publishAt),
    index("idx_episodes_expires_at").on(table.expiresAt),
    index("idx_episodes_subscriber_only_starts_at").on(table.subscriberOnlyStartsAt),
    index("idx_episodes_subscriber_only_ends_at").on(table.subscriberOnlyEndsAt),
    index("idx_episodes_slug").on(table.slug),
    index("idx_episodes_podcast_slug").on(table.podcastId, table.slug),
  ],
);

// ---------------------------------------------------------------------------
// Episode alert destinations (084)
// ---------------------------------------------------------------------------
export const episodeAlertDestinations = sqliteTable(
  "episode_alert_destinations",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    type: text("type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** all = every released episode; premium = subscriber-only episodes only */
    episodeScope: text("episode_scope").notNull().default("all"),
    config: text("config").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_episode_alert_destinations_podcast").on(table.podcastId)],
);

// ---------------------------------------------------------------------------
// Episode alert subscribers (084)
// ---------------------------------------------------------------------------
export const episodeAlertSubscribers = sqliteTable(
  "episode_alert_subscribers",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    list: text("list").notNull().default("general"),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    emailVerificationTokenHash: text("email_verification_token_hash"),
    emailVerificationExpiresAt: text("email_verification_expires_at"),
    unsubscribeTokenHash: text("unsubscribe_token_hash"),
    source: text("source").notNull().default("feed"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    verifiedAt: text("verified_at"),
  },
  (table) => [
    unique("idx_episode_alert_subscribers_unique").on(
      table.podcastId,
      table.email,
      table.list,
    ),
    index("idx_episode_alert_subscribers_podcast").on(table.podcastId),
    index("idx_episode_alert_subscribers_verify").on(table.emailVerificationTokenHash),
    index("idx_episode_alert_subscribers_unsub").on(table.unsubscribeTokenHash),
  ],
);

// ---------------------------------------------------------------------------
// Exports (001 + 009, 010, 011 unified)
// ---------------------------------------------------------------------------
export const exports = sqliteTable(
  "exports",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    publicBaseUrl: text("public_base_url"),
    mode: text("mode").notNull().default("S3"),
    configEnc: text("config_enc"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_exports_podcast").on(table.podcastId)],
);

// ---------------------------------------------------------------------------
// Export runs
// ---------------------------------------------------------------------------
export const exportRuns = sqliteTable(
  "export_runs",
  {
    id: text("id").primaryKey(),
    exportId: text("export_id")
      .notNull()
      .references(() => exports.id, { onDelete: "cascade" }),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    log: text("log"),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_export_runs_export").on(table.exportId)],
);

// ---------------------------------------------------------------------------
// Reusable assets
// ---------------------------------------------------------------------------
export const reusableAssets = sqliteTable(
  "reusable_assets",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    audioPath: text("audio_path").notNull(),
    durationSec: integer("duration_sec").notNull(),
    tag: text("tag"),
    globalAsset: integer("global_asset", { mode: "boolean" }).default(false),
    copyright: text("copyright"),
    license: text("license"),
    sourceUrl: text("source_url"),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_reusable_assets_owner").on(table.ownerUserId)],
);

// ---------------------------------------------------------------------------
// Episode segments (001 + 034, 035)
// ---------------------------------------------------------------------------
export const episodeSegments = sqliteTable(
  "episode_segments",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type", { enum: ["recorded", "reusable"] }).notNull(),
    reusableAssetId: text("reusable_asset_id").references(() => reusableAssets.id, {
      onDelete: "set null",
    }),
    audioPath: text("audio_path"),
    durationSec: integer("duration_sec").notNull().default(0),
    name: text("name"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    inProgress: integer("in_progress", { mode: "boolean" }).notNull().default(false),
    recordFailed: integer("record_failed", { mode: "boolean" }).notNull().default(false),
    trimRanges: text("trim_ranges"),
    markers: text("markers"),
    audioEq: text("audio_eq"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    hostDuckingEnabled: integer("host_ducking_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [index("idx_episode_segments_episode").on(table.episodeId)],
);

// ---------------------------------------------------------------------------
// Episode show notes (064)
// ---------------------------------------------------------------------------
export const episodeShowNotesItems = sqliteTable(
  "episode_show_notes_items",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull().default(""),
    durationMin: integer("duration_min"),
    checked: integer("checked", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_episode_show_notes_items_episode").on(table.episodeId)],
);

// ---------------------------------------------------------------------------
// Episode files (088) - listener-facing attachments
// ---------------------------------------------------------------------------
export const episodeFiles = sqliteTable(
  "episode_files",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'file' | 'link'
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    storageName: text("storage_name"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    originalFilename: text("original_filename"),
    url: text("url"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_episode_files_episode_sort").on(table.episodeId, table.sortOrder),
  ],
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sqlNow()),
});

// ---------------------------------------------------------------------------
// Login attempts
// ---------------------------------------------------------------------------
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    ip: text("ip").notNull(),
    context: text("context").notNull(),
    attemptedEmail: text("attempted_email"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_login_attempts_ip_context_created_at").on(table.ip, table.context, table.createdAt),
    index("idx_login_attempts_ip_context_created_at_email").on(
      table.ip,
      table.context,
      table.createdAt,
      table.attemptedEmail,
    ),
  ],
);

// ---------------------------------------------------------------------------
// IP bans
// ---------------------------------------------------------------------------
export const ipBans = sqliteTable(
  "ip_bans",
  {
    ip: text("ip").notNull(),
    context: text("context").notNull(),
    bannedUntil: text("banned_until").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [
    primaryKey({ columns: [table.ip, table.context] }),
    index("idx_ip_bans_until").on(table.bannedUntil),
  ],
);

// ---------------------------------------------------------------------------
// Podcast stats (002)
// ---------------------------------------------------------------------------
export const podcastStatsRssDaily = sqliteTable(
  "podcast_stats_rss_daily",
  {
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    statDate: text("stat_date").notNull(),
    source: text("source").notNull().default("Other"),
    botCount: integer("bot_count").notNull().default(0),
    humanCount: integer("human_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.podcastId, table.statDate, table.source] }),
  ],
);

export const podcastStatsEpisodeDaily = sqliteTable(
  "podcast_stats_episode_daily",
  {
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    statDate: text("stat_date").notNull(),
    source: text("source").notNull().default("Other"),
    botCount: integer("bot_count").notNull().default(0),
    humanCount: integer("human_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.episodeId, table.statDate, table.source] }),
  ],
);

export const podcastStatsEpisodeLocationDaily = sqliteTable(
  "podcast_stats_episode_location_daily",
  {
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    statDate: text("stat_date").notNull(),
    location: text("location").notNull(),
    source: text("source").notNull().default("Other"),
    botCount: integer("bot_count").notNull().default(0),
    humanCount: integer("human_count").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.episodeId,
        table.statDate,
        table.location,
        table.source,
      ],
    }),
  ],
);

export const podcastStatsEpisodeListensDaily = sqliteTable(
  "podcast_stats_episode_listens_daily",
  {
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    statDate: text("stat_date").notNull(),
    source: text("source").notNull().default("Other"),
    botCount: integer("bot_count").notNull().default(0),
    humanCount: integer("human_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.episodeId, table.statDate, table.source] }),
  ],
);

export const podcastStatsListenDedup = sqliteTable(
  "podcast_stats_listen_dedup",
  {
    episodeId: text("episode_id").notNull(),
    statDate: text("stat_date").notNull(),
    clientKey: text("client_key").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.episodeId, table.statDate, table.clientKey] }),
    index("idx_podcast_stats_listen_dedup_stat_date").on(table.statDate),
  ],
);

// ---------------------------------------------------------------------------
// Password reset tokens (007, 038)
// ---------------------------------------------------------------------------
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_password_reset_tokens_email").on(table.email),
    index("idx_password_reset_tokens_token_hash").on(table.tokenHash),
  ],
);

// ---------------------------------------------------------------------------
// API keys (012, 029, 030)
// ---------------------------------------------------------------------------
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
    lastUsedAt: text("last_used_at"),
    name: text("name"),
    validUntil: text("valid_until"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    validFrom: text("valid_from"),
  },
  (table) => [
    unique("api_keys_user_key_hash").on(table.userId, table.keyHash),
    index("idx_api_keys_user_id").on(table.userId),
    index("idx_api_keys_key_hash").on(table.keyHash),
  ],
);

// ---------------------------------------------------------------------------
// Contact messages (013, 014)
// ---------------------------------------------------------------------------
export const contactMessages = sqliteTable(
  "contact_messages",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
    podcastId: text("podcast_id").references(() => podcasts.id),
    episodeId: text("episode_id").references(() => episodes.id),
  },
  (table) => [
    index("idx_contact_messages_created_at").on(table.createdAt),
    index("idx_contact_messages_podcast_id").on(table.podcastId),
    index("idx_contact_messages_episode_id").on(table.episodeId),
  ],
);

// ---------------------------------------------------------------------------
// Reviews (054)
// ---------------------------------------------------------------------------
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    episodeId: text("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    approved: integer("approved", { mode: "boolean" }).notNull().default(false),
    spam: integer("spam", { mode: "boolean" }).notNull().default(false),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sqlNow()),
    emailVerificationTokenHash: text("email_verification_token_hash"),
    emailVerificationExpiresAt: text("email_verification_expires_at"),
    deleteTokenHash: text("delete_token_hash"),
    deleteTokenExpiresAt: text("delete_token_expires_at"),
  },
  (table) => [
    index("idx_reviews_podcast_id").on(table.podcastId),
    index("idx_reviews_episode_id").on(table.episodeId),
    index("idx_reviews_created_at").on(table.createdAt),
    index("idx_reviews_email_verification_token_hash").on(table.emailVerificationTokenHash),
    index("idx_reviews_delete_token_hash").on(table.deleteTokenHash),
    index("idx_reviews_user_id").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Podcast shares (015)
// ---------------------------------------------------------------------------
export const podcastShares = sqliteTable(
  "podcast_shares",
  {
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    unique("podcast_shares_podcast_user").on(table.podcastId, table.userId),
    index("idx_podcast_shares_user_id").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Platform invites (017)
// ---------------------------------------------------------------------------
export const platformInvites = sqliteTable(
  "platform_invites",
  {
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_platform_invites_inviter_created").on(table.inviterUserId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Forgot password attempts (018)
// ---------------------------------------------------------------------------
export const forgotPasswordAttempts = sqliteTable("forgot_password_attempts", {
  email: text("email").primaryKey(),
  attemptedAt: text("attempted_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

// ---------------------------------------------------------------------------
// Subscriber tokens (024, 025)
// ---------------------------------------------------------------------------
export const subscriberTokens = sqliteTable(
  "subscriber_tokens",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    validFrom: text("valid_from"),
    validUntil: text("valid_until"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    createdAt: text("created_at").notNull().default(sqlNow()),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [
    index("idx_subscriber_tokens_podcast_id").on(table.podcastId),
    index("idx_subscriber_tokens_token_hash").on(table.tokenHash),
  ],
);

// ---------------------------------------------------------------------------
// Podcast cast (033)
// ---------------------------------------------------------------------------
export const podcastCast = sqliteTable(
  "podcast_cast",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role", { enum: ["host", "guest"] }).notNull(),
    description: text("description"),
    photoPath: text("photo_path"),
    photoUrl: text("photo_url"),
    socialLinkText: text("social_link_text"),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_podcast_cast_podcast").on(table.podcastId)],
);

// ---------------------------------------------------------------------------
// Episode cast (033)
// ---------------------------------------------------------------------------
export const episodeCast = sqliteTable(
  "episode_cast",
  {
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    castId: text("cast_id")
      .notNull()
      .references(() => podcastCast.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.episodeId, table.castId] }),
    index("idx_episode_cast_episode").on(table.episodeId),
    index("idx_episode_cast_cast").on(table.castId),
  ],
);

// ---------------------------------------------------------------------------
// User OTP codes (037)
// ---------------------------------------------------------------------------
export const userOtpCodes = sqliteTable(
  "user_otp_codes",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_user_otp_codes_user_id").on(table.userId),
    index("idx_user_otp_codes_expires_at").on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Auth 2FA challenges (037, 050)
// ---------------------------------------------------------------------------
export const auth2faChallenges = sqliteTable(
  "auth_2fa_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    method: text("method", { enum: ["totp", "email"] }).notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
    totpSecretHash: text("totp_secret_hash"),
  },
  (table) => [
    index("idx_auth_2fa_challenges_token_hash").on(table.tokenHash),
    index("idx_auth_2fa_challenges_expires_at").on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// User TOTP attempts (037)
// ---------------------------------------------------------------------------
export const userTotpAttempts = sqliteTable(
  "user_totp_attempts",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_user_totp_attempts_user_created").on(table.userId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// User identities (040)
// ---------------------------------------------------------------------------
export const userIdentities = sqliteTable(
  "user_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerType: text("provider_type", { enum: ["oidc", "saml"] }).notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    unique("user_identities_issuer_subject").on(table.issuer, table.subject),
    index("idx_user_identities_user").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// SSO OAuth state (041, 042)
// ---------------------------------------------------------------------------
export const ssoOauthState = sqliteTable(
  "sso_oauth_state",
  {
    state: text("state").primaryKey(),
    codeVerifier: text("code_verifier").notNull(),
    providerId: text("provider_id").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
    nonce: text("nonce"),
  },
  (table) => [index("idx_sso_oauth_state_created").on(table.createdAt)],
);

// ---------------------------------------------------------------------------
// SSO SAML state (043)
// ---------------------------------------------------------------------------
export const ssoSamlState = sqliteTable(
  "sso_saml_state",
  {
    relayState: text("relay_state").primaryKey(),
    providerId: text("provider_id").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_sso_saml_state_created").on(table.createdAt)],
);

// ---------------------------------------------------------------------------
// SSO SAML cache (044)
// ---------------------------------------------------------------------------
export const ssoSamlCache = sqliteTable(
  "sso_saml_cache",
  {
    requestId: text("request_id").primaryKey(),
    value: text("value").notNull(),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_sso_saml_cache_created").on(table.createdAt)],
);

// ---------------------------------------------------------------------------
// Password reset TOTP attempts (049)
// ---------------------------------------------------------------------------
export const passwordResetTotpAttempts = sqliteTable(
  "password_reset_totp_attempts",
  {
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_password_reset_totp_attempts_token_hash").on(table.tokenHash),
  ],
);

// ---------------------------------------------------------------------------
// Episode polls (072)
// ---------------------------------------------------------------------------
export const episodePolls = sqliteTable(
  "episode_polls",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .unique()
      .references(() => episodes.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    startAt: text("start_at"),
    endAt: text("end_at"),
    requireEmail: integer("require_email", { mode: "boolean" }).notNull().default(false),
    publicResults: integer("public_results", { mode: "boolean" }).notNull().default(false),
    limitOneVotePerIp: integer("limit_one_vote_per_ip", { mode: "boolean" })
      .notNull()
      .default(false),
    questionsJson: text("questions_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_episode_polls_episode_id").on(table.episodeId)],
);

export const episodePollSubmissions = sqliteTable(
  "episode_poll_submissions",
  {
    id: text("id").primaryKey(),
    pollId: text("poll_id")
      .notNull()
      .references(() => episodePolls.id, { onDelete: "cascade" }),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    emailVerificationTokenHash: text("email_verification_token_hash"),
    emailVerificationExpiresAt: text("email_verification_expires_at"),
    ipHash: text("ip_hash"),
    clientKey: text("client_key"),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_episode_poll_submissions_poll_id").on(table.pollId),
    index("idx_episode_poll_submissions_episode_id").on(table.episodeId),
    index("idx_episode_poll_submissions_verify_token").on(
      table.emailVerificationTokenHash,
    ),
    index("idx_episode_poll_submissions_poll_ip").on(table.pollId, table.ipHash),
    index("idx_episode_poll_submissions_client_key").on(table.pollId, table.clientKey),
  ],
);

export const episodePollAnswers = sqliteTable(
  "episode_poll_answers",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => episodePollSubmissions.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    optionId: text("option_id"),
    textValue: text("text_value"),
  },
  (table) => [
    index("idx_episode_poll_answers_submission_id").on(table.submissionId),
    index("idx_episode_poll_answers_question_id").on(table.questionId),
  ],
);

// ---------------------------------------------------------------------------
// Stripe credentials (074) - per-user shareable packs
// ---------------------------------------------------------------------------
export const stripeCredentials = sqliteTable(
  "stripe_credentials",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull().default(""),
    mode: text("mode").notNull().default("test"),
    testSecretKeyEnc: text("test_secret_key_enc"),
    testPublishableKeyEnc: text("test_publishable_key_enc"),
    testWebhookSecretEnc: text("test_webhook_secret_enc"),
    liveSecretKeyEnc: text("live_secret_key_enc"),
    livePublishableKeyEnc: text("live_publishable_key_enc"),
    liveWebhookSecretEnc: text("live_webhook_secret_enc"),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_stripe_credentials_owner_user_id").on(table.ownerUserId),
  ],
);

// ---------------------------------------------------------------------------
// Stripe plans (075) - per-show Products / Prices
// ---------------------------------------------------------------------------
export const stripePlans = sqliteTable(
  "stripe_plans",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("test"),
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    stripeProductId: text("stripe_product_id").notNull().default(""),
    stripePriceId: text("stripe_price_id").notNull().default(""),
    autoRenewDefault: integer("auto_renew_default", { mode: "boolean" })
      .notNull()
      .default(true),
    syncError: text("sync_error"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_stripe_plans_podcast_id").on(table.podcastId),
  ],
);

// ---------------------------------------------------------------------------
// Stripe subscriptions (076) - checkout to subscriber tokens
// ---------------------------------------------------------------------------
export const stripeSubscriptions = sqliteTable(
  "stripe_subscriptions",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    stripeCredentialsId: text("stripe_credentials_id").notNull(),
    mode: text("mode").notNull().default("test"),
    planId: text("plan_id"),
    subscriberTokenId: text("subscriber_token_id").references(
      () => subscriberTokens.id,
      { onDelete: "set null" },
    ),
    stripeCustomerId: text("stripe_customer_id").notNull().default(""),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    status: text("status").notNull().default("incomplete"),
    currentPeriodEnd: text("current_period_end"),
    cancelAtPeriodEnd: integer("cancel_at_period_end", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    customerEmail: text("customer_email"),
    accessTokenEnc: text("access_token_enc"),
    /** Set when checkout success has returned the raw token once (blocks re-reveal via session_id). */
    accessTokenRevealedAt: text("access_token_revealed_at"),
    /** Actual amount charged at checkout (after discounts), for refunds. */
    amountPaidCents: integer("amount_paid_cents"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_stripe_subscriptions_podcast_id").on(table.podcastId),
    index("idx_stripe_subscriptions_stripe_sub_id").on(
      table.stripeSubscriptionId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Stripe coupons (078) - per-show Coupon + Promotion Code
// ---------------------------------------------------------------------------
export const stripeCoupons = sqliteTable(
  "stripe_coupons",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("test"),
    code: text("code").notNull(),
    name: text("name"),
    discountType: text("discount_type").notNull(),
    percentOff: real("percent_off"),
    amountOffCents: integer("amount_off_cents"),
    currency: text("currency").notNull().default("usd"),
    duration: text("duration").notNull(),
    durationInMonths: integer("duration_in_months"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    maxRedemptions: integer("max_redemptions"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    stripeCouponId: text("stripe_coupon_id").notNull().default(""),
    stripePromotionCodeId: text("stripe_promotion_code_id").notNull().default(""),
    syncError: text("sync_error"),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [index("idx_stripe_coupons_podcast_id").on(table.podcastId)],
);

export const stripeCouponRedemptions = sqliteTable(
  "stripe_coupon_redemptions",
  {
    id: text("id").primaryKey(),
    couponId: text("coupon_id")
      .notNull()
      .references(() => stripeCoupons.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => stripeSubscriptions.id, { onDelete: "cascade" }),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    customerEmail: text("customer_email"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePromotionCodeId: text("stripe_promotion_code_id"),
    stripeCouponId: text("stripe_coupon_id"),
    amountOffCents: integer("amount_off_cents"),
    percentOff: real("percent_off"),
    createdAt: text("created_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_stripe_coupon_redemptions_coupon_id").on(table.couponId),
    index("idx_stripe_coupon_redemptions_podcast_id").on(table.podcastId),
  ],
);

// ---------------------------------------------------------------------------
// Stripe refund requests (077) - listener asks, owner approves/rejects
// ---------------------------------------------------------------------------
export const stripeRefundRequests = sqliteTable(
  "stripe_refund_requests",
  {
    id: text("id").primaryKey(),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => stripeSubscriptions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    stripeRefundId: text("stripe_refund_id"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("idx_stripe_refund_requests_podcast_id").on(table.podcastId),
    index("idx_stripe_refund_requests_subscription_id").on(table.subscriptionId),
  ],
);

// ---------------------------------------------------------------------------
// Feed themes (server-wide packages + user-imported copies)
// ---------------------------------------------------------------------------
export const feedThemes = sqliteTable(
  "feed_themes",
  {
    id: text("id").primaryKey(),
    /** Null when scope is server (bundled / server-wide theme). */
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** user = personal import; server = available to every podcast. */
    scope: text("scope").notNull().default("user"),
    packageId: text("package_id").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    byteSize: integer("byte_size").notNull().default(0),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
  },
  (table) => [
    index("idx_feed_themes_owner").on(table.ownerUserId),
    index("idx_feed_themes_scope").on(table.scope),
  ],
);

/** Instance-wide theme catalog destinations (admin-managed catalog.json URLs). */
export const themeCatalogDestinations = sqliteTable("theme_catalog_destinations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  createdAt: text("created_at").notNull().default(sqlNow()),
  updatedAt: text("updated_at").notNull().default(sqlNow()),
});

// ---------------------------------------------------------------------------
// Scheduled episode group-call meetings (093)
// ---------------------------------------------------------------------------
export const episodeGroupCallMeetings = sqliteTable(
  "episode_group_call_meetings",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    podcastId: text("podcast_id")
      .notNull()
      .references(() => podcasts.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scheduledStartAt: text("scheduled_start_at").notNull(),
    /** IANA time zone from the host's browser (e.g. America/New_York). */
    hostTimeZone: text("host_time_zone"),
    token: text("token").notNull().unique(),
    joinCode: text("join_code").notNull(),
    status: text("status").notNull().default("scheduled"),
    liveSessionId: text("live_session_id"),
    episodePublishedNotifiedAt: text("episode_published_notified_at"),
    icsSequence: integer("ics_sequence").notNull().default(0),
    createdAt: text("created_at").notNull().default(sqlNow()),
    updatedAt: text("updated_at").notNull().default(sqlNow()),
    cancelledAt: text("cancelled_at"),
    endedAt: text("ended_at"),
  },
  (table) => [
    index("idx_egcm_episode_id").on(table.episodeId),
    index("idx_egcm_created_by_status").on(table.createdByUserId, table.status),
    index("idx_egcm_join_code").on(table.joinCode),
    index("idx_egcm_token").on(table.token),
  ],
);

export const episodeGroupCallMeetingInvites = sqliteTable(
  "episode_group_call_meeting_invites",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => episodeGroupCallMeetings.id, { onDelete: "cascade" }),
    email: text("email"),
    displayName: text("display_name"),
    inviteToken: text("invite_token").notNull().unique(),
    createdAt: text("created_at").notNull().default(sqlNow()),
    lastSentAt: text("last_sent_at"),
  },
  (table) => [
    index("idx_egcmi_meeting_id").on(table.meetingId),
    index("idx_egcmi_invite_token").on(table.inviteToken),
  ],
);
