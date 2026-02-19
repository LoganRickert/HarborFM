import { and, eq, exists, or, sql } from "drizzle-orm";
import {
  ROLE_MIN_EDIT_SEGMENTS,
  ROLE_MIN_EDIT_METADATA,
  ROLE_MIN_MANAGE_COLLABORATORS,
} from "../config.js";
import type { ShareRole } from "../utils/roles.js";
import { drizzleDb } from "../db/index.js";
import {
  episodes,
  episodeSegments,
  podcasts,
  podcastShares,
  reusableAssets,
  users,
} from "../db/schema.js";

/** Known share roles (string; new roles can be added in code). */
export const KNOWN_ROLES = new Set<string>(["view", "editor", "manager"]);
const ROLE_ORDER: Record<string, number> = {
  view: 0,
  editor: 1,
  manager: 2,
  owner: 3,
};

/**
 * Returns true if the user has the admin role. Use for route-level checks
 * (e.g. allow admin to access any podcast/episode).
 */
export function isAdmin(userId: string): boolean {
  const user = drizzleDb
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  return user?.role === "admin";
}

/**
 * Returns the user's role on the podcast: 'owner', a share role (view/editor/manager), or null.
 * Admins are treated as 'owner' for permission checks.
 */
export function getPodcastRole(
  userId: string,
  podcastId: string,
): string | null {
  const ownerRow = drizzleDb
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.ownerUserId, userId)))
    .limit(1)
    .get();
  if (ownerRow) return "owner";
  if (isAdmin(userId)) return "owner";
  const share = drizzleDb
    .select({ role: podcastShares.role })
    .from(podcastShares)
    .where(
      and(
        eq(podcastShares.podcastId, podcastId),
        eq(podcastShares.userId, userId),
      ),
    )
    .limit(1)
    .get();
  return share?.role ?? null;
}

/**
 * Returns true if the user has any access to the podcast (owner or shared).
 */
export function canAccessPodcast(userId: string, podcastId: string): boolean {
  return getPodcastRole(userId, podcastId) !== null;
}

export interface CanAccessEpisodeResult {
  podcastId: string;
  role: string | null;
  episode?: Record<string, unknown>;
}

/**
 * Returns episode access for the user: owner, admin, or shared role.
 * When includeEpisode is true, the full episode row is included.
 */
export function canAccessEpisode(
  userId: string,
  episodeId: string,
  options?: { includeEpisode?: boolean },
): CanAccessEpisodeResult | null {
  const includeEpisode = options?.includeEpisode === true;
  const episodeRow = includeEpisode
    ? drizzleDb
        .select()
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .limit(1)
        .get()
    : drizzleDb
        .select({ podcast_id: episodes.podcastId })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .limit(1)
        .get();
  if (!episodeRow) return null;
  const podcastId =
    "podcastId" in episodeRow
      ? episodeRow.podcastId
      : (episodeRow as { podcast_id: string }).podcast_id;
  const role = getPodcastRole(userId, podcastId);
  if (role === null) return null;
  return {
    podcastId,
    role,
    ...(includeEpisode && episodeRow
      ? { episode: episodeRow as Record<string, unknown> }
      : {}),
  };
}

/**
 * Returns true if the user's role is at least the required level (view < editor < manager < owner).
 */
export function hasRoleAtLeast(
  role: string | null,
  required: ShareRole,
): boolean {
  if (role === null) return false;
  const a = ROLE_ORDER[role] ?? -1;
  const b = ROLE_ORDER[required] ?? -1;
  return a >= b;
}

export function canEditSegments(role: string | null): boolean {
  return hasRoleAtLeast(role, ROLE_MIN_EDIT_SEGMENTS);
}

export function canEditEpisodeOrPodcastMetadata(role: string | null): boolean {
  return hasRoleAtLeast(role, ROLE_MIN_EDIT_METADATA);
}

export function canManageCollaborators(role: string | null): boolean {
  return hasRoleAtLeast(role, ROLE_MIN_MANAGE_COLLABORATORS);
}

/** Owner or manager can add/edit/delete hosts. */
export function canAddEditHost(role: string | null): boolean {
  return canManageCollaborators(role);
}

/** Editor, manager, or owner can add/edit/delete guests. */
export function canAddEditGuest(role: string | null): boolean {
  return canEditSegments(role);
}

/** Editor, manager, or owner can assign cast to episodes. */
export function canAssignCastToEpisode(role: string | null): boolean {
  return canEditSegments(role);
}

/**
 * Returns true if the user can edit DNS-related fields on a podcast.
 * Only owner or admin may set link_domain, managed_domain, managed_sub_domain, cloudflare_api_key.
 */
export function canEditDnsSettings(userId: string, podcastId: string): boolean {
  const role = getPodcastRole(userId, podcastId);
  return role === "owner" || isAdmin(userId);
}

/**
 * Returns true if the user can read the library asset (stream, waveform, metadata).
 * Allowed: admin, owner of asset, global asset, or asset used in a podcast the user has view+ access to.
 */
export function canReadLibraryAsset(userId: string, assetId: string): boolean {
  const asset = drizzleDb
    .select({
      owner_user_id: reusableAssets.ownerUserId,
      global_asset: sql<number>`COALESCE(${reusableAssets.globalAsset}, 0)`.as(
        "global_asset",
      ),
    })
    .from(reusableAssets)
    .where(eq(reusableAssets.id, assetId))
    .limit(1)
    .get();
  if (!asset) return false;
  if (isAdmin(userId)) return true;
  if (asset.owner_user_id === userId) return true;
  if (asset.global_asset === 1) return true;
  const usedInAccessiblePodcast = drizzleDb
    .select({ one: sql`1` })
    .from(episodeSegments)
    .innerJoin(episodes, eq(episodes.id, episodeSegments.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(
      and(
        eq(episodeSegments.reusableAssetId, assetId),
        or(
          eq(podcasts.ownerUserId, userId),
          exists(
            drizzleDb
              .select()
              .from(podcastShares)
              .where(
                and(
                  eq(podcastShares.podcastId, podcasts.id),
                  eq(podcastShares.userId, userId),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1)
    .get();
  return !!usedInAccessiblePodcast;
}

/**
 * Returns true if the user can attach this asset to a segment in this podcast.
 * Allowed: user owns asset, asset is global, or asset is already used in this podcast.
 */
export function canUseAssetInSegment(
  userId: string,
  assetId: string,
  podcastId: string,
): boolean {
  const asset = drizzleDb
    .select({
      owner_user_id: reusableAssets.ownerUserId,
      global_asset: sql<number>`COALESCE(${reusableAssets.globalAsset}, 0)`.as(
        "global_asset",
      ),
    })
    .from(reusableAssets)
    .where(eq(reusableAssets.id, assetId))
    .limit(1)
    .get();
  if (!asset) return false;
  if (asset.owner_user_id === userId) return true;
  if (asset.global_asset === 1) return true;
  const alreadyUsed = drizzleDb
    .select({ one: sql`1` })
    .from(episodeSegments)
    .innerJoin(episodes, eq(episodes.id, episodeSegments.episodeId))
    .where(
      and(
        eq(episodeSegments.reusableAssetId, assetId),
        eq(episodes.podcastId, podcastId),
      ),
    )
    .limit(1)
    .get();
  return !!alreadyUsed;
}

/** Returns the podcast owner's user id (for storage accounting). */
export function getPodcastOwnerId(podcastId: string): string | undefined {
  const row = drizzleDb
    .select({ owner_user_id: podcasts.ownerUserId })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row?.owner_user_id;
}
