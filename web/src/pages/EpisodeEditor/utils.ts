import type { Episode } from '../../api/episodes';

/** Form-friendly episode fields (strings for inputs, booleans for checkboxes). */
export interface EpisodeForm {
  title: string;
  slug: string;
  description: string;
  artworkUrl: string;
  seasonNumber: string;
  episodeNumber: string;
  status: string;
  publishAt: string;
  explicit: boolean;
  episodeType: 'full' | 'trailer' | 'bonus' | '';
  episodeLink: string;
  guidIsPermalink: boolean;
}

export function episodeToForm(episode: Episode): EpisodeForm {
  return {
    title: episode.title,
    slug: episode.slug || slugify(episode.title),
    description: episode.description ?? '',
    artworkUrl: episode.artwork_url ?? '',
    seasonNumber: episode.season_number != null ? String(episode.season_number) : '',
    episodeNumber: episode.episode_number != null ? String(episode.episode_number) : '',
    status: episode.status,
    publishAt: episode.publish_at ? toDateTimeLocalValue(episode.publish_at) : '',
    explicit: !!episode.explicit,
    episodeType: (episode.episode_type as 'full' | 'trailer' | 'bonus') || 'full',
    episodeLink: episode.episode_link ?? '',
    guidIsPermalink: episode.guid_is_permalink === 1,
  };
}

/** Build API update payload from form. */
export function formToApiPayload(form: EpisodeForm) {
  return {
    title: form.title,
    slug: form.slug || slugify(form.title),
    description: form.description,
    season_number: form.seasonNumber === '' ? null : parseInt(form.seasonNumber, 10),
    episode_number: form.episodeNumber === '' ? null : parseInt(form.episodeNumber, 10),
    episode_type: form.episodeType || 'full',
    status: form.status,
    artwork_url: form.artworkUrl === '' ? null : form.artworkUrl,
    explicit: form.explicit ? 1 : 0,
    publish_at: form.publishAt ? new Date(form.publishAt).toISOString() : null,
    episode_link: form.episodeLink || null,
    guid_is_permalink: form.guidIsPermalink ? 1 : 0,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatLibraryDate(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    return Number.isFinite(d.getTime())
      ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : createdAt;
  } catch {
    return createdAt;
  }
}

/** Format ISO date string for datetime-local input (local time, with seconds for Safari). */
export function toDateTimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
