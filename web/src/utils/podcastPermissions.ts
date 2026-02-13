/**
 * Check if user can create a new podcast
 */
export function canCreatePodcast(readOnly: boolean, atLimit: boolean): boolean {
  return !readOnly && !atLimit;
}

/**
 * Check if user can manage a show (edit settings)
 */
export function canManageShow(readOnly: boolean, role?: string): boolean {
  if (readOnly) return false;
  return role === 'owner' || role === 'manager';
}

/**
 * Check if user can create an episode for a show
 */
export function canCreateEpisode(
  readOnly: boolean,
  role?: string,
  atLimit?: boolean
): boolean {
  if (readOnly) return false;
  if (atLimit) return false;
  return role === 'owner' || role === 'manager';
}
