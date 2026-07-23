/**
 * Extract subscriber token from various input formats.
 * Accepts either a raw token (hfm_sub_...) or a full RSS URL containing the token.
 * 
 * @param input - Token string or RSS URL
 * @returns Extracted token or null if invalid
 */
export function extractTokenFromInput(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // Check if it's already a token (starts with hfm_sub_)
  if (trimmed.startsWith('hfm_sub_')) {
    return trimmed;
  }

  // Try to extract token from URL
  // Pattern: /private/{token}/rss or /private/{token}/
  const urlMatch = trimmed.match(/\/private\/(hfm_sub_[a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  return null;
}

/**
 * Absolute private RSS feed URL. Prefers managed/linked domain when canonicalFeedUrl is set.
 */
export function buildPrivateRssFeedUrl(
  podcastSlug: string,
  token: string,
  canonicalFeedUrl?: string | null,
): string {
  const path = `/api/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/rss`;
  const canonical = canonicalFeedUrl?.trim();
  if (canonical) {
    try {
      return `${new URL(canonical).origin}${path}`;
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

/**
 * Validate that a token has the correct format.
 * 
 * @param token - Token to validate
 * @returns True if token format is valid
 */
export function isValidTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // Token should start with hfm_sub_ and contain only alphanumeric chars, underscores, and hyphens
  return /^hfm_sub_[a-zA-Z0-9_-]+$/.test(token);
}
