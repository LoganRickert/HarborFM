/**
 * Drizzle schema matching migrations 001-050.
 * Used as query layer; existing migrate.ts and raw migrations remain for SQLite.
 */
import {
  sqliteTable,
  text,
  integer,
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
    fundingUrl: text("funding_url"),
    fundingLabel: text("funding_label"),
    persons: text("persons"),
    updateFrequencyRrule: text("update_frequency_rrule"),
    updateFrequencyLabel: text("update_frequency_label"),
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
    finalMarkers: text("final_markers"),
    videoFinalPath: text("video_final_path"),
  },
  (table) => [
    unique("episodes_podcast_guid").on(table.podcastId, table.guid),
    index("idx_episodes_podcast").on(table.podcastId),
    index("idx_episodes_status").on(table.status),
    index("idx_episodes_publish_at").on(table.publishAt),
    index("idx_episodes_slug").on(table.slug),
    index("idx_episodes_podcast_slug").on(table.podcastId, table.slug),
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
  },
  (table) => [index("idx_episode_segments_episode").on(table.episodeId)],
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
