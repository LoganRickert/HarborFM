import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { users } from "../../db/schema.js";

/** User canImportTheme flag for Theme import features. */
export function getUserCanImportTheme(userId: string): boolean {
  const row = drizzleDb
    .select({
      canImportTheme: sql<number>`COALESCE(${users.canImportTheme}, 0)`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.canImportTheme === 1;
}
