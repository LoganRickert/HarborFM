/**
 * Email verification: store token_hash (SHA-256) instead of plaintext token.
 * Invalidates any in-flight verification links.
 */
import { createHash } from "crypto";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const up = (db: { exec: (sql: string) => void }) => {
  const d = db as unknown as {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      all: (args?: unknown) => { id: string; email_verification_token: string }[];
      run: (...args: unknown[]) => unknown;
    };
  };

  d.exec("ALTER TABLE users ADD COLUMN email_verification_token_hash TEXT");
  const rows = d
    .prepare(
      "SELECT id, email_verification_token FROM users WHERE email_verification_token IS NOT NULL AND email_verification_token != ''",
    )
    .all() as { id: string; email_verification_token: string }[];
  const updateStmt = d.prepare(
    "UPDATE users SET email_verification_token_hash = ? WHERE id = ?",
  );
  for (const row of rows) {
    const tokenHash = sha256Hex(row.email_verification_token);
    updateStmt.run(tokenHash, row.id);
  }
  d.exec("CREATE INDEX IF NOT EXISTS idx_users_email_verification_token_hash ON users(email_verification_token_hash)");
  d.exec("ALTER TABLE users DROP COLUMN email_verification_token");
};

export const down = (db: { exec: (sql: string) => void }) => {
  const d = db as unknown as {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...args: unknown[]) => unknown;
    };
  };
  d.exec("ALTER TABLE users ADD COLUMN email_verification_token TEXT");
  d.exec("DROP INDEX IF EXISTS idx_users_email_verification_token_hash");
  d.exec("ALTER TABLE users DROP COLUMN email_verification_token_hash");
};
