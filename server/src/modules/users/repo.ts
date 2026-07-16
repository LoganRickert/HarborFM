import { and, asc, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import {
  passwordResetTokens,
  podcasts as podcastsTable,
  reusableAssets,
  settings,
  userIdentities,
  users as usersTable,
} from "../../db/schema.js";
import type { RawUserRow } from "./utils.js";
import { likeEscape } from "./utils.js";

const userSelectCols = {
  id: usersTable.id,
  email: usersTable.email,
  username: usersTable.username,
  createdAt: usersTable.createdAt,
  role: usersTable.role,
  disabled: sql<number>`COALESCE(${usersTable.disabled}, 0)`.as("disabled"),
  readOnly: sql<number>`COALESCE(${usersTable.readOnly}, 0)`.as("readOnly"),
  diskBytesUsed: sql<number>`COALESCE(${usersTable.diskBytesUsed}, 0)`.as(
    "diskBytesUsed",
  ),
  lastLoginAt: usersTable.lastLoginAt,
  lastLoginIp: usersTable.lastLoginIp,
  lastLoginLocation: usersTable.lastLoginLocation,
  maxPodcasts: usersTable.maxPodcasts,
  maxEpisodes: usersTable.maxEpisodes,
  maxStorageMb: usersTable.maxStorageMb,
  maxCollaborators: usersTable.maxCollaborators,
  maxSubscriberTokens: usersTable.maxSubscriberTokens,
  canTranscribe: sql<number>`COALESCE(${usersTable.canTranscribe}, 0)`.as(
    "canTranscribe",
  ),
  canGenerateVideo: sql<number>`COALESCE(${usersTable.canGenerateVideo}, 0)`.as(
    "canGenerateVideo",
  ),
  canStripe: sql<number>`COALESCE(${usersTable.canStripe}, 0)`.as("canStripe"),
  canEpisodeAlert: sql<number>`COALESCE(${usersTable.canEpisodeAlert}, 0)`.as(
    "canEpisodeAlert",
  ),
};

function normIssuer(s: string): string {
  return (s || "")
    .trim()
    .replace(/\/\.well-known\/.*$/i, "")
    .replace(/\/+$/, "");
}

export function getIssuerToNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const oidcRow = drizzleDb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "sso_oidc_providers"))
      .limit(1)
      .get();
    if (oidcRow?.value?.trim()) {
      const oidc = JSON.parse(oidcRow.value) as Array<{
        id?: string;
        issuer?: string;
        discoveryUrl?: string;
        name?: string;
      }>;
      for (const p of oidc) {
        const iss = normIssuer(p.issuer ?? p.discoveryUrl ?? "");
        if (iss) map.set(iss, p.name ?? p.id ?? "OIDC");
      }
    }
    const samlRow = drizzleDb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "sso_saml_providers"))
      .limit(1)
      .get();
    if (samlRow?.value?.trim()) {
      const saml = JSON.parse(samlRow.value) as Array<{
        issuer?: string;
        name?: string;
        id?: string;
      }>;
      for (const p of saml) {
        const iss = normIssuer(p.issuer ?? "");
        if (iss) map.set(iss, p.name ?? p.id ?? "SAML");
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

export function listUsers({
  limit,
  offset,
  search,
}: {
  limit: number;
  offset: number;
  search: string;
}): { rows: RawUserRow[]; total: number } {
  const searchPattern = search ? `%${likeEscape(search)}%` : undefined;
  const searchWhere = searchPattern
    ? or(
        like(usersTable.email, searchPattern),
        like(usersTable.username, searchPattern),
      )
    : undefined;

  const totalRow = drizzleDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(usersTable)
    .where(searchWhere)
    .get();
  const total = totalRow?.count ?? 0;

  const rows = drizzleDb
    .select(userSelectCols)
    .from(usersTable)
    .where(searchWhere)
    .orderBy(asc(usersTable.createdAt))
    .limit(limit)
    .offset(offset)
    .all() as RawUserRow[];

  return { rows, total };
}

export function getIdentitiesByUserIds(
  userIds: string[],
): Array<{ userId: string; providerType: string; issuer: string }> {
  if (userIds.length === 0) return [];
  return drizzleDb
    .select({
      userId: userIdentities.userId,
      providerType: userIdentities.providerType,
      issuer: userIdentities.issuer,
    })
    .from(userIdentities)
    .where(inArray(userIdentities.userId, userIds))
    .all();
}

export function getUserById(userId: string): RawUserRow | undefined {
  const row = drizzleDb
    .select(userSelectCols)
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1)
    .get();
  return row as RawUserRow | undefined;
}

export function getIdentitiesForUser(
  userId: string,
): Array<{ providerType: string; issuer: string }> {
  return drizzleDb
    .select({
      providerType: userIdentities.providerType,
      issuer: userIdentities.issuer,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .all();
}

export function insertUser(values: {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  maxPodcasts: number | null;
  maxStorageMb: number | null;
  maxEpisodes: number | null;
  maxCollaborators: number | null;
  maxSubscriberTokens: number | null;
  canTranscribe: number;
  canGenerateVideo: number;
  canStripe: number;
  canEpisodeAlert: number;
  emailVerified: boolean;
}): void {
  drizzleDb.insert(usersTable).values(values).run();
}

export function emailExists(email: string): boolean {
  const row = drizzleDb
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1)
    .get();
  return !!row;
}

export function emailExistsExcludingUserId(
  userId: string,
  email: string,
): boolean {
  const row = drizzleDb
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(eq(usersTable.email, email), ne(usersTable.id, userId)),
    )
    .limit(1)
    .get();
  return !!row;
}

export function usernameTakenExcludingUserId(
  userId: string,
  canonicalUsername: string,
): boolean {
  const row = drizzleDb
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        sql`LOWER(${usersTable.username}) = ${canonicalUsername}`,
        ne(usersTable.id, userId),
      ),
    )
    .limit(1)
    .get();
  return !!row;
}

export function updateUser(
  userId: string,
  set: Record<string, unknown>,
): void {
  drizzleDb.update(usersTable).set(set).where(eq(usersTable.id, userId)).run();
}

export function getOwnedPodcastIds(userId: string): string[] {
  return drizzleDb
    .select({ id: podcastsTable.id })
    .from(podcastsTable)
    .where(eq(podcastsTable.ownerUserId, userId))
    .all()
    .map((r) => r.id);
}

export function getReusableAssetsForUser(
  userId: string,
): Array<{ id: string; audioPath: string | null }> {
  return drizzleDb
    .select({ id: reusableAssets.id, audioPath: reusableAssets.audioPath })
    .from(reusableAssets)
    .where(eq(reusableAssets.ownerUserId, userId))
    .all();
}

export function deleteReusableAsset(assetId: string): void {
  drizzleDb.delete(reusableAssets).where(eq(reusableAssets.id, assetId)).run();
}

export function decrementUserDiskBytes(userId: string, bytes: number): void {
  drizzleDb
    .update(usersTable)
    .set({
      diskBytesUsed: sql`CASE WHEN COALESCE(${usersTable.diskBytesUsed}, 0) - ${bytes} < 0 THEN 0 ELSE COALESCE(${usersTable.diskBytesUsed}, 0) - ${bytes} END`,
    })
    .where(eq(usersTable.id, userId))
    .run();
}

export function deleteUser(userId: string): void {
  drizzleDb.delete(usersTable).where(eq(usersTable.id, userId)).run();
}

export function insertPasswordResetToken(row: {
  email: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}): void {
  drizzleDb.insert(passwordResetTokens).values(row).run();
}
