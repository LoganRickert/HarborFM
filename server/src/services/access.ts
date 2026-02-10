import { db } from '../db/index.js';

/**
 * Returns true if the user has the admin role. Use for route-level checks
 * (e.g. allow admin to access any podcast/episode).
 */
export function isAdmin(userId: string): boolean {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  return user?.role === 'admin';
}

/**
 * Returns true if the user owns the podcast (or is admin; call isAdmin separately if needed).
 */
export function canAccessPodcast(userId: string, podcastId: string): boolean {
  const row = db.prepare('SELECT id FROM podcasts WHERE id = ? AND owner_user_id = ?').get(podcastId, userId);
  return !!row;
}

export interface CanAccessEpisodeResult {
  podcastId: string;
  episode?: Record<string, unknown>;
}

/**
 * Returns episode access for the user: owner of the podcast gets access; admins get access to any episode.
 * When includeEpisode is true, the full episode row is included (e.g. for audio routes that need path info).
 */
export function canAccessEpisode(
  userId: string,
  episodeId: string,
  options?: { includeEpisode?: boolean }
): CanAccessEpisodeResult | null {
  const includeEpisode = options?.includeEpisode === true;
  const ownerRow = db
    .prepare(
      includeEpisode
        ? `SELECT e.* FROM episodes e
           JOIN podcasts p ON p.id = e.podcast_id
           WHERE e.id = ? AND p.owner_user_id = ?`
        : `SELECT e.podcast_id FROM episodes e
           JOIN podcasts p ON p.id = e.podcast_id
           WHERE e.id = ? AND p.owner_user_id = ?`
    )
    .get(episodeId, userId) as { podcast_id: string } & Record<string, unknown> | undefined;

  if (ownerRow) {
    const podcastId = ownerRow.podcast_id;
    return includeEpisode ? { podcastId, episode: ownerRow as Record<string, unknown> } : { podcastId };
  }

  if (!isAdmin(userId)) return null;

  const adminRow = db
    .prepare(includeEpisode ? 'SELECT * FROM episodes WHERE id = ?' : 'SELECT podcast_id FROM episodes WHERE id = ?')
    .get(episodeId) as { podcast_id: string } & Record<string, unknown> | undefined;

  if (!adminRow) return null;
  const podcastId = adminRow.podcast_id;
  return includeEpisode ? { podcastId, episode: adminRow as Record<string, unknown> } : { podcastId };
}
