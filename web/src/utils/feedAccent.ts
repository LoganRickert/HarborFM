import type { FeedAccent } from '@harborfm/shared';

export type FeedAccentColors = {
  accent: string;
  accentDim: string;
  accentGlow: string;
};

export const FEED_ACCENT_OPTIONS: Array<{
  id: FeedAccent;
  label: string;
  colors: FeedAccentColors;
}> = [
  {
    id: 'green',
    label: 'Green',
    colors: {
      accent: '#00d4aa',
      accentDim: '#00a884',
      accentGlow: 'rgba(0, 212, 170, 0.25)',
    },
  },
  {
    id: 'cyan',
    label: 'Cyan',
    colors: {
      accent: '#22d3ee',
      accentDim: '#0891b2',
      accentGlow: 'rgba(34, 211, 238, 0.25)',
    },
  },
  {
    id: 'blue',
    label: 'Blue',
    colors: {
      accent: '#3b82f6',
      accentDim: '#2563eb',
      accentGlow: 'rgba(59, 130, 246, 0.25)',
    },
  },
  {
    id: 'indigo',
    label: 'Indigo',
    colors: {
      accent: '#6366f1',
      accentDim: '#4f46e5',
      accentGlow: 'rgba(99, 102, 241, 0.25)',
    },
  },
  {
    id: 'violet',
    label: 'Violet',
    colors: {
      accent: '#a855f7',
      accentDim: '#9333ea',
      accentGlow: 'rgba(168, 85, 247, 0.25)',
    },
  },
  {
    id: 'pink',
    label: 'Pink',
    colors: {
      accent: '#ec4899',
      accentDim: '#db2777',
      accentGlow: 'rgba(236, 72, 153, 0.25)',
    },
  },
  {
    id: 'red',
    label: 'Red',
    colors: {
      accent: '#ef4444',
      accentDim: '#dc2626',
      accentGlow: 'rgba(239, 68, 68, 0.25)',
    },
  },
  {
    id: 'orange',
    label: 'Orange',
    colors: {
      accent: '#f97316',
      accentDim: '#ea580c',
      accentGlow: 'rgba(249, 115, 22, 0.25)',
    },
  },
  {
    id: 'amber',
    label: 'Amber',
    colors: {
      accent: '#f59e0b',
      accentDim: '#d97706',
      accentGlow: 'rgba(245, 158, 11, 0.25)',
    },
  },
  {
    id: 'lime',
    label: 'Lime',
    colors: {
      accent: '#84cc16',
      accentDim: '#65a30d',
      accentGlow: 'rgba(132, 204, 22, 0.25)',
    },
  },
];

const BY_ID = Object.fromEntries(
  FEED_ACCENT_OPTIONS.map((o) => [o.id, o.colors]),
) as Record<FeedAccent, FeedAccentColors>;

export function resolveFeedAccent(accent: string | null | undefined): FeedAccentColors {
  const key = (accent?.trim() || 'green') as FeedAccent;
  return BY_ID[key] ?? BY_ID.green;
}

export function isFeedAccent(value: string): value is FeedAccent {
  return FEED_ACCENT_OPTIONS.some((o) => o.id === value);
}

/** Inline CSS variables for a themed public feed page wrapper. */
export function feedAccentCssVars(
  accent: string | null | undefined,
): Record<string, string> {
  const colors = resolveFeedAccent(accent);
  return {
    '--accent': colors.accent,
    '--accent-dim': colors.accentDim,
    '--accent-glow': colors.accentGlow,
    '--success': colors.accent,
  };
}
