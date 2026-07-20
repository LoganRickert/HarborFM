import { FEED_DEFAULT_THEME } from '@harborfm/shared';

/** True when the podcast uses a packaged page theme (not the default SPA feed). */
export function isLiquidFeedTheme(feedTheme: string | null | undefined): boolean {
  const t = (feedTheme || FEED_DEFAULT_THEME).trim();
  return !!t && t !== FEED_DEFAULT_THEME;
}

/** Normalize a theme page public path (lowercase `name.html`), or null if invalid. */
export function normalizeThemePageFile(raw: string | undefined): string | null {
  if (!raw) return null;
  const decoded = decodeURIComponent(raw).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*\.html$/.test(decoded)) return null;
  return decoded;
}

/** True when a path segment is a theme page public path (ends with .html). */
export function isThemePageFileSegment(segment: string | undefined): boolean {
  return Boolean(segment && normalizeThemePageFile(segment));
}
