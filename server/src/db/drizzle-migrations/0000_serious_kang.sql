CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`last_used_at` text,
	`name` text,
	`valid_until` text,
	`disabled` integer DEFAULT false NOT NULL,
	`valid_from` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_id` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_key_hash` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_key_hash` ON `api_keys` (`user_id`,`key_hash`);--> statement-breakpoint
CREATE TABLE `auth_2fa_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`method` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`totp_secret_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_2fa_challenges_token_hash_unique` ON `auth_2fa_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_2fa_challenges_token_hash` ON `auth_2fa_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_2fa_challenges_expires_at` ON `auth_2fa_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`podcast_id` text,
	`episode_id` text,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contact_messages_created_at` ON `contact_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_contact_messages_podcast_id` ON `contact_messages` (`podcast_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_messages_episode_id` ON `contact_messages` (`episode_id`);--> statement-breakpoint
CREATE TABLE `episode_cast` (
	`episode_id` text NOT NULL,
	`cast_id` text NOT NULL,
	PRIMARY KEY(`episode_id`, `cast_id`),
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cast_id`) REFERENCES `podcast_cast`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_episode_cast_episode` ON `episode_cast` (`episode_id`);--> statement-breakpoint
CREATE INDEX `idx_episode_cast_cast` ON `episode_cast` (`cast_id`);--> statement-breakpoint
CREATE TABLE `episode_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`reusable_asset_id` text,
	`audio_path` text,
	`duration_sec` integer DEFAULT 0 NOT NULL,
	`name` text,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`in_progress` integer DEFAULT false NOT NULL,
	`record_failed` integer DEFAULT false NOT NULL,
	`trim_ranges` text,
	`markers` text,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reusable_asset_id`) REFERENCES `reusable_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_episode_segments_episode` ON `episode_segments` (`episode_id`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`podcast_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '',
	`guid` text NOT NULL,
	`season_number` integer,
	`episode_number` integer,
	`episode_type` text,
	`explicit` integer,
	`publish_at` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`artwork_path` text,
	`artwork_url` text,
	`audio_source_path` text,
	`audio_final_path` text,
	`audio_mime` text,
	`audio_bytes` integer,
	`audio_duration_sec` integer,
	`slug` text,
	`episode_link` text,
	`guid_is_permalink` integer DEFAULT false,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`updated_at` text DEFAULT datetime('now') NOT NULL,
	`description_copyright_snapshot` text,
	`subtitle` text,
	`summary` text,
	`content_encoded` text,
	`subscriber_only` integer DEFAULT false,
	`final_markers` text,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_episodes_podcast` ON `episodes` (`podcast_id`);--> statement-breakpoint
CREATE INDEX `idx_episodes_status` ON `episodes` (`status`);--> statement-breakpoint
CREATE INDEX `idx_episodes_publish_at` ON `episodes` (`publish_at`);--> statement-breakpoint
CREATE INDEX `idx_episodes_slug` ON `episodes` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_episodes_podcast_slug` ON `episodes` (`podcast_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_podcast_guid` ON `episodes` (`podcast_id`,`guid`);--> statement-breakpoint
CREATE TABLE `export_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`export_id` text NOT NULL,
	`podcast_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`log` text,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`export_id`) REFERENCES `exports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_export_runs_export` ON `export_runs` (`export_id`);--> statement-breakpoint
CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`podcast_id` text NOT NULL,
	`name` text NOT NULL,
	`public_base_url` text,
	`mode` text DEFAULT 'S3' NOT NULL,
	`config_enc` text,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`updated_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_exports_podcast` ON `exports` (`podcast_id`);--> statement-breakpoint
CREATE TABLE `forgot_password_attempts` (
	`email` text PRIMARY KEY NOT NULL,
	`attempted_at` text NOT NULL,
	`ip` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE TABLE `ip_bans` (
	`ip` text NOT NULL,
	`context` text NOT NULL,
	`banned_until` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`updated_at` text DEFAULT datetime('now') NOT NULL,
	PRIMARY KEY(`ip`, `context`)
);
--> statement-breakpoint
CREATE INDEX `idx_ip_bans_until` ON `ip_bans` (`banned_until`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`context` text NOT NULL,
	`attempted_email` text,
	`user_agent` text,
	`created_at` text DEFAULT datetime('now') NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_ip_context_created_at` ON `login_attempts` (`ip`,`context`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_login_attempts_ip_context_created_at_email` ON `login_attempts` (`ip`,`context`,`created_at`,`attempted_email`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_password_reset_tokens_email` ON `password_reset_tokens` (`email`);--> statement-breakpoint
CREATE INDEX `idx_password_reset_tokens_token_hash` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `password_reset_totp_attempts` (
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_password_reset_totp_attempts_token_hash` ON `password_reset_totp_attempts` (`token_hash`);--> statement-breakpoint
CREATE TABLE `platform_invites` (
	`inviter_user_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`inviter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_platform_invites_inviter_created` ON `platform_invites` (`inviter_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `podcast_cast` (
	`id` text PRIMARY KEY NOT NULL,
	`podcast_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`description` text,
	`photo_path` text,
	`photo_url` text,
	`social_link_text` text,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_podcast_cast_podcast` ON `podcast_cast` (`podcast_id`);--> statement-breakpoint
CREATE TABLE `podcast_shares` (
	`podcast_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_podcast_shares_user_id` ON `podcast_shares` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `podcast_shares_podcast_user` ON `podcast_shares` (`podcast_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `podcast_stats_episode_daily` (
	`episode_id` text NOT NULL,
	`stat_date` text NOT NULL,
	`bot_count` integer DEFAULT 0 NOT NULL,
	`human_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`episode_id`, `stat_date`),
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `podcast_stats_episode_listens_daily` (
	`episode_id` text NOT NULL,
	`stat_date` text NOT NULL,
	`bot_count` integer DEFAULT 0 NOT NULL,
	`human_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`episode_id`, `stat_date`),
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `podcast_stats_episode_location_daily` (
	`episode_id` text NOT NULL,
	`stat_date` text NOT NULL,
	`location` text NOT NULL,
	`bot_count` integer DEFAULT 0 NOT NULL,
	`human_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`episode_id`, `stat_date`, `location`),
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `podcast_stats_listen_dedup` (
	`episode_id` text NOT NULL,
	`stat_date` text NOT NULL,
	`client_key` text NOT NULL,
	PRIMARY KEY(`episode_id`, `stat_date`, `client_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_podcast_stats_listen_dedup_stat_date` ON `podcast_stats_listen_dedup` (`stat_date`);--> statement-breakpoint
CREATE TABLE `podcast_stats_rss_daily` (
	`podcast_id` text NOT NULL,
	`stat_date` text NOT NULL,
	`bot_count` integer DEFAULT 0 NOT NULL,
	`human_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`podcast_id`, `stat_date`),
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `podcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '',
	`language` text DEFAULT 'en',
	`author_name` text DEFAULT '',
	`owner_name` text DEFAULT '',
	`email` text DEFAULT '',
	`category_primary` text DEFAULT '',
	`category_secondary` text,
	`category_primary_two` text,
	`category_secondary_two` text,
	`category_primary_three` text,
	`category_secondary_three` text,
	`explicit` integer DEFAULT false NOT NULL,
	`artwork_path` text,
	`artwork_url` text,
	`site_url` text,
	`copyright` text,
	`podcast_guid` text,
	`locked` integer DEFAULT false,
	`license` text,
	`itunes_type` text DEFAULT 'episodic',
	`medium` text DEFAULT 'podcast',
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`updated_at` text DEFAULT datetime('now') NOT NULL,
	`max_episodes` integer,
	`max_collaborators` integer,
	`subtitle` text,
	`summary` text,
	`funding_url` text,
	`funding_label` text,
	`persons` text,
	`update_frequency_rrule` text,
	`update_frequency_label` text,
	`spotify_recent_count` integer,
	`spotify_country_of_origin` text,
	`apple_podcasts_verify` text,
	`unlisted` integer DEFAULT false,
	`subscriber_only_feed_enabled` integer DEFAULT false,
	`max_subscriber_tokens` integer,
	`public_feed_disabled` integer DEFAULT false,
	`link_domain` text,
	`managed_domain` text,
	`managed_sub_domain` text,
	`cloudflare_api_key_enc` text,
	`apple_podcasts_url` text,
	`spotify_url` text,
	`amazon_music_url` text,
	`podcast_index_url` text,
	`listen_notes_url` text,
	`castbox_url` text,
	`x_url` text,
	`facebook_url` text,
	`instagram_url` text,
	`tiktok_url` text,
	`youtube_url` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_podcasts_owner` ON `podcasts` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_podcasts_guid` ON `podcasts` (`podcast_guid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_podcasts_owner_slug` ON `podcasts` (`owner_user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `reusable_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`audio_path` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`tag` text,
	`global_asset` integer DEFAULT false,
	`copyright` text,
	`license` text,
	`source_url` text,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reusable_assets_owner` ON `reusable_assets` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT datetime('now') NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sso_oauth_state` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`nonce` text
);
--> statement-breakpoint
CREATE INDEX `idx_sso_oauth_state_created` ON `sso_oauth_state` (`created_at`);--> statement-breakpoint
CREATE TABLE `sso_saml_cache` (
	`request_id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sso_saml_cache_created` ON `sso_saml_cache` (`created_at`);--> statement-breakpoint
CREATE TABLE `sso_saml_state` (
	`relay_state` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sso_saml_state_created` ON `sso_saml_state` (`created_at`);--> statement-breakpoint
CREATE TABLE `subscriber_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`podcast_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`valid_from` text,
	`valid_until` text,
	`disabled` integer DEFAULT false,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_subscriber_tokens_podcast_id` ON `subscriber_tokens` (`podcast_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriber_tokens_token_hash` ON `subscriber_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_type` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_identities_user` ON `user_identities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_issuer_subject` ON `user_identities` (`issuer`,`subject`);--> statement-breakpoint
CREATE TABLE `user_otp_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_otp_codes_user_id` ON `user_otp_codes` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_otp_codes_expires_at` ON `user_otp_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_totp_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_totp_attempts_user_created` ON `user_totp_attempts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`username` text,
	`created_at` text DEFAULT datetime('now') NOT NULL,
	`role` text DEFAULT 'user',
	`disabled` integer DEFAULT false,
	`disk_bytes_used` integer DEFAULT 0,
	`last_login_at` text,
	`last_login_ip` text,
	`last_login_user_agent` text,
	`last_login_location` text,
	`max_podcasts` integer,
	`max_storage_mb` integer,
	`max_episodes` integer,
	`email_verified` integer DEFAULT true NOT NULL,
	`email_verification_expires_at` text,
	`read_only` integer DEFAULT false NOT NULL,
	`max_collaborators` integer,
	`max_subscriber_tokens` integer,
	`can_transcribe` integer,
	`totp_secret_enc` text,
	`two_factor_method` text,
	`totp_locked_until` text,
	`profile_email_username_updated_at` text,
	`pending_email` text,
	`email_verification_token_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_email_verification_token_hash` ON `users` (`email_verification_token_hash`);