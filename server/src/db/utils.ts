import { sql } from "drizzle-orm";
import { DB_PROVIDER } from "../config.js";

/** Dialect-aware "current timestamp" for defaults and updates. */
export function sqlNow() {
  return DB_PROVIDER === "mysql"
    ? sql`CURRENT_TIMESTAMP`
    : sql`datetime('now')`;
}

/** Returns true if the error is the api_keys max-per-user trigger (race-condition backstop). */
export function isApiKeyLimitExceeded(err: unknown): boolean {
  if (err == null) return false;
  return String((err as Error).message ?? err).includes("API key limit exceeded");
}

/** Returns true if the error is a unique constraint violation (SQLite or MySQL). */
export function isUniqueViolation(err: unknown): boolean {
  if (err == null) return false;
  const msg = String((err as Error).message ?? err);
  const code = (err as { code?: string }).code;
  return (
    code === "SQLITE_CONSTRAINT" ||
    msg.includes("UNIQUE constraint failed") ||
    code === "ER_DUP_ENTRY" ||
    msg.includes("Duplicate entry")
  );
}
