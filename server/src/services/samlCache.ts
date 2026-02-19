/**
 * SQLite-backed CacheProvider for SAML InResponseTo validation.
 * Stores AuthnRequest IDs so the callback can verify responses are tied to our requests.
 */
import type { CacheItem, CacheProvider } from "@node-saml/node-saml";
import { drizzleDb } from "../db/drizzle.js";
import { ssoSamlCache } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { sqlNow } from "../db/utils.js";

export const samlDbCacheProvider: CacheProvider = {
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const now = Date.now();
    const createdAt = sqlNow();
    drizzleDb
      .insert(ssoSamlCache)
      .values({ requestId: key, value, createdAt })
      .onConflictDoUpdate({
        target: ssoSamlCache.requestId,
        set: { value, createdAt },
      })
      .run();
    return { value, createdAt: now };
  },

  async getAsync(key: string): Promise<string | null> {
    const row = drizzleDb
      .select({ value: ssoSamlCache.value })
      .from(ssoSamlCache)
      .where(eq(ssoSamlCache.requestId, key))
      .limit(1)
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  },

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const row = drizzleDb
      .select({ value: ssoSamlCache.value })
      .from(ssoSamlCache)
      .where(eq(ssoSamlCache.requestId, key))
      .limit(1)
      .get() as { value: string } | undefined;
    drizzleDb.delete(ssoSamlCache).where(eq(ssoSamlCache.requestId, key)).run();
    return row?.value ?? null;
  },
};
