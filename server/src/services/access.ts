import {
  ROLE_MIN_EDIT_SEGMENTS,
  ROLE_MIN_EDIT_METADATA,
  ROLE_MIN_MANAGE_COLLABORATORS,
} from "../config.js";
import type { ShareRole } from "../utils/roles.js";
import { db } from "../db/index.js";

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
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined;
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
  const ownerRow = db
    .prepare("SELECT id FROM podcasts WHERE id = ? AND owner_user_id = ?")
    .get(podcastId, userId);
  if (ownerRow) return "owner";
  if (isAdmin(userId)) return "owner";
  const share = db
    .prepare(
      "SELECT role FROM podcast_shares WHERE podcast_id = ? AND user_id = ?",
    )
    .get(podcastId, userId) as { role: string } | undefined;
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
  const episodeRow = db
    .prepare(
      includeEpisode
        ? "SELECT * FROM episodes WHERE id = ?"
        : "SELECT podcast_id FROM episodes WHERE id = ?",
    )
    .get(episodeId) as
    | ({ podcast_id: string } & Record<string, unknown>)
    | undefined;
  if (!episodeRow) return null;
  const podcastId = episodeRow.podcast_id;
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
  const asset = db
    .prepare(
      "SELECT owner_user_id, COALESCE(global_asset, 0) AS global_asset FROM reusable_assets WHERE id = ?",
    )
    .get(assetId) as
    | { owner_user_id: string; global_asset: number }
    | undefined;
  if (!asset) return false;
  if (isAdmin(userId)) return true;
  if (asset.owner_user_id === userId) return true;
  if (asset.global_asset === 1) return true;
  const usedInAccessiblePodcast = db
    .prepare(
      `SELECT 1 FROM episode_segments es
       JOIN episodes e ON e.id = es.episode_id
       JOIN podcasts p ON p.id = e.podcast_id
       WHERE es.reusable_asset_id = ?
         AND (p.owner_user_id = ? OR EXISTS (SELECT 1 FROM podcast_shares WHERE podcast_id = p.id AND user_id = ?))
       LIMIT 1`,
    )
    .get(assetId, userId, userId);
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
  const asset = db
    .prepare(
      "SELECT owner_user_id, COALESCE(global_asset, 0) AS global_asset FROM reusable_assets WHERE id = ?",
    )
    .get(assetId) as
    | { owner_user_id: string; global_asset: number }
    | undefined;
  if (!asset) return false;
  if (asset.owner_user_id === userId) return true;
  if (asset.global_asset === 1) return true;
  const alreadyUsed = db
    .prepare(
      `SELECT 1 FROM episode_segments es
       JOIN episodes e ON e.id = es.episode_id
       WHERE es.reusable_asset_id = ? AND e.podcast_id = ?
       LIMIT 1`,
    )
    .get(assetId, podcastId);
  return !!alreadyUsed;
}

/** Returns the podcast owner's user id (for storage accounting). */
export function getPodcastOwnerId(podcastId: string): string | undefined {
  const row = db
    .prepare("SELECT owner_user_id FROM podcasts WHERE id = ?")
    .get(podcastId) as { owner_user_id: string } | undefined;
  return row?.owner_user_id;
}
