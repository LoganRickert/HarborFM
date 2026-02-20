import * as SiIcons from 'react-icons/si';
import type { IconType } from 'react-icons';

/** Convert Simple Icons slug to possible react-icons export names. Try each until one exists. */
function slugToIconNames(slug: string): string[] {
  const s = slug.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return [];
  const candidates: string[] = [];
  // "google" -> SiGoogle; "about.me" -> SiAboutdotme;
  const withDot = s.replace(/\./g, '-dot-');
  const parts = withDot.split('-');
  const pascal = parts.map((p) => (p === 'dot' ? 'dot' : p.charAt(0).toUpperCase() + p.slice(1))).join('');
  candidates.push('Si' + pascal);
  // Fallback: simple capitalize "google" -> SiGoogle
  if (candidates[0] !== 'Si' + s.charAt(0).toUpperCase() + s.slice(1)) {
    candidates.push('Si' + s.charAt(0).toUpperCase() + s.slice(1));
  }
  return candidates;
}

export function SsoButtonIcon({
  slug,
  size = 18,
}: {
  slug?: string | null;
  size?: number;
}) {
  if (!slug?.trim()) return null;
  const names = slugToIconNames(slug);
  const iconName = names.find((n) => n in SiIcons && typeof (SiIcons as Record<string, unknown>)[n] === 'function');
  if (!iconName) return null;
  const Component = (SiIcons as Record<string, IconType>)[iconName];
  return <Component size={size} aria-hidden />;
}
