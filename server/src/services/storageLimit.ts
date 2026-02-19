import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../db/drizzle.js";
import { users } from "../db/schema.js";

/**
 * Returns true if adding additionalBytes would exceed the user's storage limit.
 * Null or 0 max_storage_mb means no limit (returns false).
 */
export function wouldExceedStorageLimit(
  drizzleDb: DrizzleDb,
  userId: string,
  additionalBytes: number,
): boolean {
  const row = drizzleDb
    .select({
      used: sql<number>`COALESCE(${users.diskBytesUsed}, 0)`.as("used"),
      maxStorageMb: users.maxStorageMb,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  if (!row) return false;
  const maxMb = row.maxStorageMb;
  if (maxMb == null || maxMb <= 0) return false;
  const limitBytes = maxMb * 1024 * 1024;
  return row.used + additionalBytes > limitBytes;
}
