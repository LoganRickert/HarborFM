import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { users } from "../../db/schema.js";

/** User canEpisodeAlert flag for episode alert features. */
export function getUserCanEpisodeAlert(userId: string): boolean {
  const row = drizzleDb
    .select({
      canEpisodeAlert: sql<number>`COALESCE(${users.canEpisodeAlert}, 0)`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.canEpisodeAlert === 1;
}
