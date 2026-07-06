export const DEFAULT_SITE_NAME = 'HarborFM';

export function getSiteDisplayName(whiteLabel?: string | null): string {
  const trimmed = whiteLabel?.trim();
  return trimmed || DEFAULT_SITE_NAME;
}
