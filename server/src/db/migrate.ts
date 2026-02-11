import { db } from './index.js';
import * as m001 from './migrations/001_initial.js';
import * as m002 from './migrations/002_podcast_stats.js';
import * as m003 from './migrations/003_user_limits.js';
import * as m004 from './migrations/004_podcast_max_episodes.js';
import * as m005 from './migrations/005_episode_description_copyright_snapshot.js';
import * as m006 from './migrations/006_email_verification.js';
import * as m007 from './migrations/007_password_reset_tokens.js';
import * as m008 from './migrations/008_user_read_only.js';
import * as m009 from './migrations/009_export_bucket_region_endpoint_encrypted.js';
import * as m010 from './migrations/010_export_mode_config_enc.js';
import * as m011 from './migrations/011_exports_unified_config.js';
import * as m012 from './migrations/012_api_keys.js';
import * as m013 from './migrations/013_contact_messages.js';
import * as m014 from './migrations/014_contact_messages_context.js';
import * as m015 from './migrations/015_podcast_shares.js';
import * as m016 from './migrations/016_max_collaborators.js';
import * as m017 from './migrations/017_platform_invites.js';

const migrations = [
  { name: '001_initial', ...m001 },
  { name: '002_podcast_stats', ...m002 },
  { name: '003_user_limits', ...m003 },
  { name: '004_podcast_max_episodes', ...m004 },
  { name: '005_episode_description_copyright_snapshot', ...m005 },
  { name: '006_email_verification', ...m006 },
  { name: '007_password_reset_tokens', ...m007 },
  { name: '008_user_read_only', ...m008 },
  { name: '009_export_bucket_region_endpoint_encrypted', ...m009 },
  { name: '010_export_mode_config_enc', ...m010 },
  { name: '011_exports_unified_config', ...m011 },
  { name: '012_api_keys', ...m012 },
  { name: '013_contact_messages', ...m013 },
  { name: '014_contact_messages_context', ...m014 },
  { name: '015_podcast_shares', ...m015 },
  { name: '016_max_collaborators', ...m016 },
  { name: '017_platform_invites', ...m017 },
];

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function getApplied(): Set<string> {
  db.exec(MIGRATIONS_TABLE);
  const rows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

const applied = getApplied();
let settingsMigrationApplied = false;
for (const m of migrations) {
  if (applied.has(m.name)) {
    if (m.name === '001_initial') {
      settingsMigrationApplied = true;
    }
    continue;
  }
  console.log('Applying migration:', m.name);
  m.up(db);
  db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(m.name);
  if (m.name === '001_initial') {
    settingsMigrationApplied = true;
  }
}
console.log('Migrations complete.');

// After settings migration, migrate settings from file if needed
if (settingsMigrationApplied) {
  // Use dynamic import with .then() to avoid top-level await
  import('../routes/settings.js')
    .then((module) => {
      module.migrateSettingsFromFile();
    })
    .catch((err) => {
      // Settings module might not be loaded yet, that's okay
      console.warn('Could not migrate settings from file:', err);
    });
}
