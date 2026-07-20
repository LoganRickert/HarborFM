import { eq, and, sql, desc } from "drizzle-orm";
import { drizzleDb } from "../../db/drizzle.js";
import { feedThemes, podcasts, users } from "../../db/schema.js";
import { sqlNow } from "../../db/utils.js";

export type FeedThemeScope = "user" | "server";

export type FeedThemeRow = {
  id: string;
  ownerUserId: string | null;
  scope: FeedThemeScope;
  packageId: string;
  name: string;
  version: string;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
};

const themeSelect = {
  id: feedThemes.id,
  ownerUserId: feedThemes.ownerUserId,
  scope: feedThemes.scope,
  packageId: feedThemes.packageId,
  name: feedThemes.name,
  version: feedThemes.version,
  byteSize: feedThemes.byteSize,
  createdAt: feedThemes.createdAt,
  updatedAt: feedThemes.updatedAt,
};

function mapRow(row: {
  id: string;
  ownerUserId: string | null;
  scope: string;
  packageId: string;
  name: string;
  version: string;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
}): FeedThemeRow {
  return {
    ...row,
    scope: row.scope === "server" ? "server" : "user",
  };
}

export function listThemesForUser(userId: string): FeedThemeRow[] {
  return drizzleDb
    .select(themeSelect)
    .from(feedThemes)
    .where(and(eq(feedThemes.ownerUserId, userId), eq(feedThemes.scope, "user")))
    .orderBy(desc(feedThemes.updatedAt))
    .all()
    .map(mapRow);
}

export function listServerThemes(): FeedThemeRow[] {
  return drizzleDb
    .select(themeSelect)
    .from(feedThemes)
    .where(eq(feedThemes.scope, "server"))
    .orderBy(feedThemes.name)
    .all()
    .map(mapRow);
}

export function getThemeById(themeId: string): FeedThemeRow | undefined {
  const row = drizzleDb
    .select(themeSelect)
    .from(feedThemes)
    .where(eq(feedThemes.id, themeId))
    .limit(1)
    .get();
  return row ? mapRow(row) : undefined;
}

export function getServerThemeById(themeId: string): FeedThemeRow | undefined {
  const row = drizzleDb
    .select(themeSelect)
    .from(feedThemes)
    .where(and(eq(feedThemes.id, themeId), eq(feedThemes.scope, "server")))
    .limit(1)
    .get();
  return row ? mapRow(row) : undefined;
}

export function getServerThemeByPackageId(packageId: string): FeedThemeRow | undefined {
  const row = drizzleDb
    .select(themeSelect)
    .from(feedThemes)
    .where(and(eq(feedThemes.packageId, packageId), eq(feedThemes.scope, "server")))
    .limit(1)
    .get();
  return row ? mapRow(row) : undefined;
}

export function isServerWideThemeId(themeId: string): boolean {
  return !!getServerThemeById(themeId);
}

export function isServerWidePackageId(packageId: string): boolean {
  return !!getServerThemeByPackageId(packageId);
}

export function getThemeByOwnerAndPackage(
  ownerUserId: string,
  packageId: string,
): FeedThemeRow | undefined {
  const row = drizzleDb
    .select(themeSelect)
    .from(feedThemes)
    .where(
      and(
        eq(feedThemes.ownerUserId, ownerUserId),
        eq(feedThemes.packageId, packageId),
        eq(feedThemes.scope, "user"),
      ),
    )
    .limit(1)
    .get();
  return row ? mapRow(row) : undefined;
}

export function insertTheme(row: {
  id: string;
  ownerUserId: string | null;
  scope: FeedThemeScope;
  packageId: string;
  name: string;
  version: string;
  byteSize: number;
}): void {
  drizzleDb
    .insert(feedThemes)
    .values({
      id: row.id,
      ownerUserId: row.ownerUserId,
      scope: row.scope,
      packageId: row.packageId,
      name: row.name,
      version: row.version,
      byteSize: row.byteSize,
      createdAt: sqlNow(),
      updatedAt: sqlNow(),
    })
    .run();
}

export function upsertServerTheme(row: {
  id: string;
  packageId: string;
  name: string;
  version: string;
}): void {
  const existing = getServerThemeById(row.id);
  if (existing) {
    drizzleDb
      .update(feedThemes)
      .set({
        packageId: row.packageId,
        name: row.name,
        version: row.version,
        updatedAt: sqlNow(),
      })
      .where(and(eq(feedThemes.id, row.id), eq(feedThemes.scope, "server")))
      .run();
    return;
  }
  insertTheme({
    id: row.id,
    ownerUserId: null,
    scope: "server",
    packageId: row.packageId,
    name: row.name,
    version: row.version,
    byteSize: 0,
  });
}

export function deleteServerThemesNotIn(packageIds: string[]): number {
  const keep = new Set(packageIds);
  const current = listServerThemes();
  let removed = 0;
  for (const theme of current) {
    if (keep.has(theme.packageId) || keep.has(theme.id)) continue;
    drizzleDb
      .delete(feedThemes)
      .where(and(eq(feedThemes.id, theme.id), eq(feedThemes.scope, "server")))
      .run();
    removed += 1;
  }
  return removed;
}

export function updateTheme(
  themeId: string,
  patch: { name: string; version: string; byteSize: number },
): void {
  drizzleDb
    .update(feedThemes)
    .set({
      name: patch.name,
      version: patch.version,
      byteSize: patch.byteSize,
      updatedAt: sqlNow(),
    })
    .where(eq(feedThemes.id, themeId))
    .run();
}

export function deleteTheme(themeId: string): void {
  drizzleDb.delete(feedThemes).where(eq(feedThemes.id, themeId)).run();
}

/** Reset podcasts using this theme back to default. */
export function clearPodcastsUsingTheme(themeId: string): number {
  const result = drizzleDb
    .update(podcasts)
    .set({ feedTheme: "default", updatedAt: sqlNow() })
    .where(eq(podcasts.feedTheme, themeId))
    .run();
  return result.changes ?? 0;
}

export function themeOwnedByPodcastOwner(
  themeId: string,
  podcastOwnerUserId: string,
): boolean {
  const row = drizzleDb
    .select({ id: feedThemes.id })
    .from(feedThemes)
    .where(
      and(
        eq(feedThemes.id, themeId),
        eq(feedThemes.ownerUserId, podcastOwnerUserId),
        eq(feedThemes.scope, "user"),
      ),
    )
    .limit(1)
    .get();
  return !!row;
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
