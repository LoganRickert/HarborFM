/**
 * Enforce max API keys per user at DB level to prevent race conditions.
 * Trigger fires BEFORE INSERT; RAISE aborts if count >= limit.
 */
const MAX_KEYS = 5;

export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`
    CREATE TRIGGER api_keys_max_per_user
    BEFORE INSERT ON api_keys
    FOR EACH ROW
    WHEN (SELECT count(*) FROM api_keys WHERE user_id = NEW.user_id) >= ${MAX_KEYS}
    BEGIN
      SELECT RAISE(ABORT, 'API key limit exceeded');
    END;
  `);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TRIGGER IF EXISTS api_keys_max_per_user;`);
};
