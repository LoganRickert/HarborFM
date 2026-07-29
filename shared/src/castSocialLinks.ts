/**
 * Cast member social / profile URL helpers and platform detection.
 * Used by API, themes, and the default feed UI.
 */

export const CAST_SOCIAL_LINKS_MAX = 20;

export type CastSocialPlatformKey =
  | 'facebook'
  | 'x'
  | 'instagram'
  | 'patreon'
  | 'tiktok'
  | 'youtube'
  | 'discord'
  | 'link';

export type CastSocialPlatform = {
  key: CastSocialPlatformKey;
  label: string;
  /** HarborFM-hosted SVG when known; empty for generic links. */
  icon_url: string;
};

const PLATFORM_BY_HOST: Array<{
  hosts: string[];
  key: Exclude<CastSocialPlatformKey, 'link'>;
  label: string;
}> = [
  { hosts: ['facebook.com', 'fb.com'], key: 'facebook', label: 'Facebook' },
  { hosts: ['x.com', 'twitter.com'], key: 'x', label: 'X' },
  { hosts: ['instagram.com'], key: 'instagram', label: 'Instagram' },
  { hosts: ['patreon.com'], key: 'patreon', label: 'Patreon' },
  { hosts: ['tiktok.com'], key: 'tiktok', label: 'TikTok' },
  { hosts: ['youtube.com', 'youtu.be'], key: 'youtube', label: 'YouTube' },
  { hosts: ['discord.com', 'discord.gg'], key: 'discord', label: 'Discord' },
];

const RESERVED_SEGMENTS = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'status',
  'watch',
  'channel',
  'c',
  'user',
  'users',
  'share',
  'live',
  'explore',
  'tags',
  't',
  'i',
  'intent',
  'home',
  'login',
  'signup',
  'posts',
  'about',
  'photo',
  'photos',
  'videos',
  'people',
  'groups',
  'pages',
  'profile.php',
  'invite',
  '@',
]);

function hostMatches(hostname: string, candidates: string[]): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return candidates.some((c) => h === c || h.endsWith(`.${c}`));
}

function parseSocialUrl(url: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** Detect platform from a social URL for icons / labels. */
export function detectCastSocialPlatform(url: string): CastSocialPlatform {
  const parsed = parseSocialUrl(url);
  if (!parsed) return { key: 'link', label: 'Link', icon_url: '' };
  const hostname = parsed.hostname.toLowerCase();
  for (const entry of PLATFORM_BY_HOST) {
    if (hostMatches(hostname, entry.hosts)) {
      return {
        key: entry.key,
        label: entry.label,
        icon_url: `/platform-icons/${entry.key}.svg`,
      };
    }
  }
  return { key: 'link', label: 'Link', icon_url: '' };
}

function withAt(handle: string): string {
  const h = handle.replace(/^@+/, '').trim();
  return h ? `@${h}` : '';
}

/**
 * Best-effort profile handle / slug for display (e.g. "@jane").
 * Returns null when the URL does not look like a profile page.
 */
export function extractCastSocialHandle(
  url: string,
  key: CastSocialPlatformKey = detectCastSocialPlatform(url).key,
): string | null {
  const parsed = parseSocialUrl(url);
  if (!parsed) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const first = parts[0] ? decodeURIComponent(parts[0]) : '';
  const second = parts[1] ? decodeURIComponent(parts[1]) : '';

  if (key === 'instagram' || key === 'x') {
    if (!first || RESERVED_SEGMENTS.has(first.toLowerCase())) return null;
    return withAt(first);
  }
  if (key === 'tiktok') {
    if (first.startsWith('@')) return withAt(first);
    if (first && !RESERVED_SEGMENTS.has(first.toLowerCase())) return withAt(first);
    return null;
  }
  if (key === 'youtube') {
    if (first.startsWith('@')) return withAt(first);
    if ((first === 'c' || first === 'user' || first === 'channel') && second) {
      return first === 'channel' ? second : withAt(second);
    }
    if (parsed.hostname.replace(/^www\./, '') === 'youtu.be') return null;
    return null;
  }
  if (key === 'patreon') {
    if (!first || RESERVED_SEGMENTS.has(first.toLowerCase())) return null;
    return first;
  }
  if (key === 'facebook') {
    if (first === 'profile.php') {
      const id = parsed.searchParams.get('id');
      return id ? id : null;
    }
    if (!first || RESERVED_SEGMENTS.has(first.toLowerCase())) return null;
    return first;
  }
  if (key === 'discord') {
    if ((first === 'invite' || first === 'channels') && second) return second;
    if (first && !RESERVED_SEGMENTS.has(first.toLowerCase())) return first;
    return null;
  }
  return null;
}

/** Short fallback label when no handle can be extracted. */
export function castSocialLinkFallbackDisplay(url: string): string {
  const trimmed = url.trim();
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path && path !== '/') {
      const short = `${host}${path}`.replace(/\/+/g, '/');
      return short.length > 36 ? `${short.slice(0, 33)}...` : short;
    }
    return host;
  } catch {
    return trimmed.length > 36 ? `${trimmed.slice(0, 33)}...` : trimmed;
  }
}

/**
 * Trim, drop empties, exact-URL case-insensitive dedupe (keep first), cap at max.
 * Does not collapse multiple links from the same platform.
 */
export function normalizeCastSocialLinks(
  input: unknown,
  max = CAST_SOCIAL_LINKS_MAX,
): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const url = item.trim();
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** Parse social_links JSON from DB; invalid/null -> []. */
export function parseCastSocialLinks(raw: unknown): string[] {
  if (Array.isArray(raw)) return normalizeCastSocialLinks(raw);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    return normalizeCastSocialLinks(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeCastSocialLinks(links: string[]): string {
  return JSON.stringify(normalizeCastSocialLinks(links));
}

export type CastSocialLinkItem = CastSocialPlatform & {
  url: string;
  /** Profile handle/slug when extractable (often includes @). */
  handle: string | null;
  /** Preferred UI label: handle, else a shortened URL. */
  display: string;
};

/** Build theme/feed link objects (order preserved). */
export function castSocialLinkItems(urls: string[]): CastSocialLinkItem[] {
  return normalizeCastSocialLinks(urls).map((url) => {
    const platform = detectCastSocialPlatform(url);
    const handle = extractCastSocialHandle(url, platform.key);
    return {
      url,
      ...platform,
      handle,
      display: handle || castSocialLinkFallbackDisplay(url),
    };
  });
}
