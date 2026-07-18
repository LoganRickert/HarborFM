import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { users } from "../../db/schema.js";

/** User canUploadEpisodeFiles flag for Episode Files features. */
export function getUserCanUploadEpisodeFiles(userId: string): boolean {
  const row = drizzleDb
    .select({
      canUploadEpisodeFiles: sql<number>`COALESCE(${users.canUploadEpisodeFiles}, 0)`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.canUploadEpisodeFiles === 1;
}
