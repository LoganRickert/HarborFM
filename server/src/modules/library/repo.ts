import { and, eq, or, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { reusableAssets, users } from "../../db/schema.js";

export type LibraryAssetRow = typeof reusableAssets.$inferSelect;
export type LibraryAssetInsert = typeof reusableAssets.$inferInsert;

const listColumns = {
  id: reusableAssets.id,
  ownerUserId: reusableAssets.ownerUserId,
  name: reusableAssets.name,
  tag: reusableAssets.tag,
  durationSec: reusableAssets.durationSec,
  createdAt: reusableAssets.createdAt,
  globalAsset: reusableAssets.globalAsset,
  copyright: reusableAssets.copyright,
  license: reusableAssets.license,
};

/** List assets visible to user: owned by user or global. */
export function listForUser(userId: string) {
  return drizzleDb
    .select(listColumns)
    .from(reusableAssets)
    .where(
      or(
        eq(reusableAssets.ownerUserId, userId),
        eq(reusableAssets.globalAsset, true),
      ),
    )
    .orderBy(reusableAssets.name)
    .all();
}

/** List assets owned by a user (admin). */
export function listByOwner(userId: string) {
  return drizzleDb
    .select(listColumns)
    .from(reusableAssets)
    .where(eq(reusableAssets.ownerUserId, userId))
    .orderBy(reusableAssets.name)
    .all();
}

/** Get full asset row by id. */
export function getById(id: string): LibraryAssetRow | undefined {
  return drizzleDb
    .select()
    .from(reusableAssets)
    .where(eq(reusableAssets.id, id))
    .limit(1)
    .get();
}

/** Get id, ownerUserId, globalAsset for permission checks. */
export function getByIdForMeta(id: string): {
  id: string;
  ownerUserId: string;
  globalAsset: boolean | null;
} | undefined {
  const row = drizzleDb
    .select({
      id: reusableAssets.id,
      ownerUserId: reusableAssets.ownerUserId,
      globalAsset: reusableAssets.globalAsset,
    })
    .from(reusableAssets)
    .where(eq(reusableAssets.id, id))
    .limit(1)
    .get();
  return row as
    | { id: string; ownerUserId: string; globalAsset: boolean | null }
    | undefined;
}

/** Find asset by source URL (e.g. Pixabay duplicate check). */
export function findBySourceUrl(sourceUrl: string): LibraryAssetRow | undefined {
  return drizzleDb
    .select()
    .from(reusableAssets)
    .where(eq(reusableAssets.sourceUrl, sourceUrl))
    .limit(1)
    .get();
}

export function insertAsset(row: LibraryAssetInsert): void {
  drizzleDb.insert(reusableAssets).values(row).run();
}

export function updateAsset(
  id: string,
  set: Record<string, string | number | boolean | null>,
): void {
  drizzleDb.update(reusableAssets).set(set).where(eq(reusableAssets.id, id)).run();
}

export function updateAssetByIdAndOwner(
  id: string,
  ownerUserId: string,
  set: Record<string, string | number | boolean | null>,
): void {
  drizzleDb
    .update(reusableAssets)
    .set(set)
    .where(
      and(
        eq(reusableAssets.id, id),
        eq(reusableAssets.ownerUserId, ownerUserId),
      ),
    )
    .run();
}

export function deleteAsset(id: string): void {
  drizzleDb.delete(reusableAssets).where(eq(reusableAssets.id, id)).run();
}

export function deleteAssetByIdAndOwner(id: string, ownerUserId: string): void {
  drizzleDb
    .delete(reusableAssets)
    .where(
      and(
        eq(reusableAssets.id, id),
        eq(reusableAssets.ownerUserId, ownerUserId),
      ),
    )
    .run();
}

export function addUserDiskBytes(userId: string, bytes: number): void {
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`COALESCE(${users.diskBytesUsed}, 0) + ${bytes}`,
    })
    .where(eq(users.id, userId))
    .run();
}

export function subtractUserDiskBytes(userId: string, bytes: number): void {
  drizzleDb
    .update(users)
    .set({
      diskBytesUsed: sql`CASE
        WHEN COALESCE(${users.diskBytesUsed}, 0) - ${bytes} < 0 THEN 0
        ELSE COALESCE(${users.diskBytesUsed}, 0) - ${bytes}
      END`,
    })
    .where(eq(users.id, userId))
    .run();
}
