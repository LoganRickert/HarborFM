/**
 * SSO: user_identities table, username column, nullable email/password for federated users.
 * Username set to user_{nanoid} for existing users (not email).
 */
import { nanoid } from "nanoid";

export const up = (db: { exec: (sql: string) => void }) => {
  const d = db as unknown as {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      all: (args?: unknown) => { id: string }[];
      run: (...args: unknown[]) => unknown;
    };
  };

  d.exec("PRAGMA foreign_keys = OFF");

  d.exec(`
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE COLLATE NOCASE,
      password_hash TEXT,
      username TEXT UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      role TEXT DEFAULT 'user',
      disabled INTEGER DEFAULT 0,
      disk_bytes_used INTEGER DEFAULT 0,
      last_login_at TEXT,
      last_login_ip TEXT,
      last_login_user_agent TEXT,
      last_login_location TEXT,
      max_podcasts INTEGER,
      max_storage_mb INTEGER,
      max_episodes INTEGER,
      email_verified INTEGER NOT NULL DEFAULT 1,
      email_verification_token TEXT,
      email_verification_expires_at TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      max_collaborators INTEGER,
      max_subscriber_tokens INTEGER,
      can_transcribe INTEGER,
      totp_secret_enc TEXT,
      two_factor_method TEXT,
      totp_locked_until TEXT
    );
  `);

  d.exec(`
    INSERT INTO users_new (
      id, email, password_hash, created_at, role, disabled, disk_bytes_used,
      last_login_at, last_login_ip, last_login_user_agent, last_login_location,
      max_podcasts, max_storage_mb, max_episodes, email_verified,
      email_verification_token, email_verification_expires_at, read_only,
      max_collaborators, max_subscriber_tokens, can_transcribe,
      totp_secret_enc, two_factor_method, totp_locked_until, username
    )
    SELECT
      id, email, password_hash, created_at, role, disabled, disk_bytes_used,
      last_login_at, last_login_ip, last_login_user_agent, last_login_location,
      max_podcasts, max_storage_mb, max_episodes, email_verified,
      email_verification_token, email_verification_expires_at, read_only,
      max_collaborators, max_subscriber_tokens, can_transcribe,
      totp_secret_enc, two_factor_method, totp_locked_until,
      NULL
    FROM users;
  `);

  const ids = d.prepare("SELECT id FROM users_new").all() as { id: string }[];
  const updateStmt = d.prepare("UPDATE users_new SET username = ? WHERE id = ?");
  for (const row of ids) {
    updateStmt.run(`user_${nanoid()}`, row.id);
  }

  d.exec("DROP TABLE users");
  d.exec("ALTER TABLE users_new RENAME TO users");

  d.exec(`
    CREATE TABLE user_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_type TEXT NOT NULL CHECK (provider_type IN ('oidc','saml')),
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(issuer, subject)
    );
    CREATE INDEX idx_user_identities_user ON user_identities(user_id);
  `);

  d.exec("PRAGMA foreign_keys = ON");
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec("PRAGMA foreign_keys = OFF");

  db.exec("DROP TABLE IF EXISTS user_identities");

  db.exec(`
    CREATE TABLE users_old (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      role TEXT DEFAULT 'user',
      disabled INTEGER DEFAULT 0,
      disk_bytes_used INTEGER DEFAULT 0,
      last_login_at TEXT,
      last_login_ip TEXT,
      last_login_user_agent TEXT,
      last_login_location TEXT,
      max_podcasts INTEGER,
      max_storage_mb INTEGER,
      max_episodes INTEGER,
      email_verified INTEGER NOT NULL DEFAULT 1,
      email_verification_token TEXT,
      email_verification_expires_at TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      max_collaborators INTEGER,
      max_subscriber_tokens INTEGER,
      can_transcribe INTEGER,
      totp_secret_enc TEXT,
      two_factor_method TEXT,
      totp_locked_until TEXT
    );
  `);

  db.exec(`
    INSERT INTO users_old (
      id, email, password_hash, created_at, role, disabled, disk_bytes_used,
      last_login_at, last_login_ip, last_login_user_agent, last_login_location,
      max_podcasts, max_storage_mb, max_episodes, email_verified,
      email_verification_token, email_verification_expires_at, read_only,
      max_collaborators, max_subscriber_tokens, can_transcribe,
      totp_secret_enc, two_factor_method, totp_locked_until
    )
    SELECT
      id, COALESCE(email, ''), COALESCE(password_hash, ''), created_at, role, disabled, disk_bytes_used,
      last_login_at, last_login_ip, last_login_user_agent, last_login_location,
      max_podcasts, max_storage_mb, max_episodes, email_verified,
      email_verification_token, email_verification_expires_at, read_only,
      max_collaborators, max_subscriber_tokens, can_transcribe,
      totp_secret_enc, two_factor_method, totp_locked_until
    FROM users WHERE email IS NOT NULL AND password_hash IS NOT NULL;
  `);

  db.exec("DROP TABLE users");
  db.exec("ALTER TABLE users_old RENAME TO users");

  db.exec("PRAGMA foreign_keys = ON");
};
