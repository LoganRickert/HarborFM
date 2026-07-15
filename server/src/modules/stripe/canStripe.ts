import { eq, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { users } from "../../db/schema.js";

/** User canStripe flag for paid subscription / Stripe features. */
export function getUserCanStripe(userId: string): boolean {
  const row = drizzleDb
    .select({
      canStripe: sql<number>`COALESCE(${users.canStripe}, 0)`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return row?.canStripe === 1;
}
