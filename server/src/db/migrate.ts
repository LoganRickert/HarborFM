import { db } from "./index.js";
import * as m001 from "./migrations/001_initial.js";
import * as m002 from "./migrations/002_podcast_stats.js";
import * as m003 from "./migrations/003_user_limits.js";
import * as m004 from "./migrations/004_podcast_max_episodes.js";
import * as m005 from "./migrations/005_episode_description_copyright_snapshot.js";
import * as m006 from "./migrations/006_email_verification.js";
import * as m007 from "./migrations/007_password_reset_tokens.js";
import * as m008 from "./migrations/008_user_read_only.js";
import * as m009 from "./migrations/009_export_bucket_region_endpoint_encrypted.js";
import * as m010 from "./migrations/010_export_mode_config_enc.js";
import * as m011 from "./migrations/011_exports_unified_config.js";
import * as m012 from "./migrations/012_api_keys.js";
import * as m013 from "./migrations/013_contact_messages.js";
import * as m014 from "./migrations/014_contact_messages_context.js";
import * as m015 from "./migrations/015_podcast_shares.js";
import * as m016 from "./migrations/016_max_collaborators.js";
import * as m017 from "./migrations/017_platform_invites.js";
import * as m018 from "./migrations/018_forgot_password_attempts.js";
import * as m019 from "./migrations/019_podcast_categories_three_pairs.js";
import * as m020 from "./migrations/020_podcast_episode_new_fields.js";
import * as m021 from "./migrations/021_episodes_guid_unique_per_podcast.js";
import * as m022 from "./migrations/022_podcast_unlisted_subscriber_feed.js";
import * as m023 from "./migrations/023_episodes_subscriber_only.js";
import * as m024 from "./migrations/024_subscriber_tokens.js";
import * as m025 from "./migrations/025_user_max_subscriber_tokens.js";
import * as m026 from "./migrations/026_podcast_public_feed_disabled.js";
import * as m027 from "./migrations/027_podcast_max_episodes_use_owner_limit.js";
import * as m028 from "./migrations/028_user_can_transcribe.js";
import * as m029 from "./migrations/029_api_keys_name_valid_until.js";
import * as m030 from "./migrations/030_api_keys_disabled_valid_from.js";
import * as m031 from "./migrations/031_podcast_dns_fields.js";
import * as m032 from "./migrations/032_podcast_social_links.js";
import * as m033 from "./migrations/033_podcast_cast.js";
import * as m034 from "./migrations/034_segment_recording_state.js";
import * as m035 from "./migrations/035_segment_trim_ranges_markers.js";
import * as m036 from "./migrations/036_episodes_final_markers.js";
import * as m037 from "./migrations/037_two_factor_auth.js";
import * as m038 from "./migrations/038_password_reset_token_hash.js";
import * as m039 from "./migrations/039_paths_to_relative.js";
import * as m040 from "./migrations/040_sso_user_identities.js";
import * as m041 from "./migrations/041_sso_oauth_state.js";
import * as m042 from "./migrations/042_sso_oauth_state_nonce.js";
import * as m043 from "./migrations/043_sso_saml_state.js";
import * as m044 from "./migrations/044_sso_saml_cache.js";
import * as m045 from "./migrations/045_username_user_nanoid.js";
import * as m046 from "./migrations/046_profile_update_rate_limit.js";
import * as m047 from "./migrations/047_pending_email.js";
import * as m048 from "./migrations/048_email_verification_token_hash.js";
import * as m049 from "./migrations/049_password_reset_totp_attempts.js";
import * as m050 from "./migrations/050_auth_2fa_totp_secret_hash.js";
import * as m051 from "./migrations/051_api_keys_max_per_user_trigger.js";
import * as m052 from "./migrations/052_episodes_video_final_path.js";
import * as m053 from "./migrations/053_user_can_generate_video.js";

const migrations = [
  { name: "001_initial", ...m001 },
  { name: "002_podcast_stats", ...m002 },
  { name: "003_user_limits", ...m003 },
  { name: "004_podcast_max_episodes", ...m004 },
  { name: "005_episode_description_copyright_snapshot", ...m005 },
  { name: "006_email_verification", ...m006 },
  { name: "007_password_reset_tokens", ...m007 },
  { name: "008_user_read_only", ...m008 },
  { name: "009_export_bucket_region_endpoint_encrypted", ...m009 },
  { name: "010_export_mode_config_enc", ...m010 },
  { name: "011_exports_unified_config", ...m011 },
  { name: "012_api_keys", ...m012 },
  { name: "013_contact_messages", ...m013 },
  { name: "014_contact_messages_context", ...m014 },
  { name: "015_podcast_shares", ...m015 },
  { name: "016_max_collaborators", ...m016 },
  { name: "017_platform_invites", ...m017 },
  { name: "018_forgot_password_attempts", ...m018 },
  { name: "019_podcast_categories_three_pairs", ...m019 },
  { name: "020_podcast_episode_new_fields", ...m020 },
  { name: "021_episodes_guid_unique_per_podcast", ...m021 },
  { name: "022_podcast_unlisted_subscriber_feed", ...m022 },
  { name: "023_episodes_subscriber_only", ...m023 },
  { name: "024_subscriber_tokens", ...m024 },
  { name: "025_user_max_subscriber_tokens", ...m025 },
  { name: "026_podcast_public_feed_disabled", ...m026 },
  { name: "027_podcast_max_episodes_use_owner_limit", ...m027 },
  { name: "028_user_can_transcribe", ...m028 },
  { name: "029_api_keys_name_valid_until", ...m029 },
  { name: "030_api_keys_disabled_valid_from", ...m030 },
  { name: "031_podcast_dns_fields", ...m031 },
  { name: "032_podcast_social_links", ...m032 },
  { name: "033_podcast_cast", ...m033 },
  { name: "034_segment_recording_state", ...m034 },
  { name: "035_segment_trim_ranges_markers", ...m035 },
  { name: "036_episodes_final_markers", ...m036 },
  { name: "037_two_factor_auth", ...m037 },
  { name: "038_password_reset_token_hash", ...m038 },
  { name: "039_paths_to_relative", ...m039 },
  { name: "040_sso_user_identities", ...m040 },
  { name: "041_sso_oauth_state", ...m041 },
  { name: "042_sso_oauth_state_nonce", ...m042 },
  { name: "043_sso_saml_state", ...m043 },
  { name: "044_sso_saml_cache", ...m044 },
  { name: "045_username_user_nanoid", ...m045 },
  { name: "046_profile_update_rate_limit", ...m046 },
  { name: "047_pending_email", ...m047 },
  { name: "048_email_verification_token_hash", ...m048 },
  { name: "049_password_reset_totp_attempts", ...m049 },
  { name: "050_auth_2fa_totp_secret_hash", ...m050 },
  { name: "051_api_keys_max_per_user_trigger", ...m051 },
  { name: "052_episodes_video_final_path", ...m052 },
  { name: "053_user_can_generate_video", ...m053 },
];

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function getApplied(): Set<string> {
  db.exec(MIGRATIONS_TABLE);
  const rows = db.prepare("SELECT name FROM _migrations").all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

const applied = getApplied();
let settingsMigrationApplied = false;
for (const m of migrations) {
  if (applied.has(m.name)) {
    if (m.name === "001_initial") {
      settingsMigrationApplied = true;
    }
    continue;
  }
  console.log("Applying migration:", m.name);
  m.up(db);
  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(m.name);
  if (m.name === "001_initial") {
    settingsMigrationApplied = true;
  }
}
console.log("Migrations complete.");

// Mark orphaned in-progress recording segments as failed (server crashed mid-recording)
const orphaned = db.prepare(
  "UPDATE episode_segments SET in_progress = 0, record_failed = 1 WHERE in_progress = 1",
).run();
if (orphaned.changes > 0) {
  console.warn("[migrate] Marked %d orphaned in-progress segment(s) as record_failed", orphaned.changes);
}

// After migrations, run settings migrations
import("../modules/settings/index.js")
  .then((module) => {
    if (settingsMigrationApplied) module.migrateSettingsFromFile();
    module.migrateWebRtcFromEnv();
    module.migrateSsoProvidersFromEnv();
  })
  .catch((err) => {
    console.warn("Could not run settings migrations:", err);
  });
