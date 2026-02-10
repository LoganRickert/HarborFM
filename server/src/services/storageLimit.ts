import type { Database } from 'better-sqlite3';

/**
 * Returns true if adding additionalBytes would exceed the user's storage limit.
 * Null or 0 max_storage_mb means no limit (returns false).
 */
export function wouldExceedStorageLimit(db: Database, userId: string, additionalBytes: number): boolean {
  const row = db
    .prepare('SELECT COALESCE(disk_bytes_used, 0) AS used, max_storage_mb FROM users WHERE id = ?')
    .get(userId) as { used: number; max_storage_mb: number | null } | undefined;
  if (!row) return false;
  const maxMb = row.max_storage_mb;
  if (maxMb == null || maxMb <= 0) return false;
  const limitBytes = maxMb * 1024 * 1024;
  return row.used + additionalBytes > limitBytes;
}
