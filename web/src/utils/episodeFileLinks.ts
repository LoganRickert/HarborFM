/** Detect embeddable / displayable Episode File link URLs. */

export type EpisodeLinkKind = 'youtube' | 'vimeo' | 'image' | 'other';

export function classifyEpisodeLinkUrl(url: string): EpisodeLinkKind {
  const trimmed = url.trim();
  if (!trimmed) return 'other';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'other';
  }
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtu.be'
  ) {
    return 'youtube';
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    return 'vimeo';
  }
  if (/\.(jpe?g|png|gif|webp|heic|heif)(\?|#|$)/i.test(path)) {
    return 'image';
  }
  return 'other';
}

export function youtubeEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (host.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/embed/')) {
        id = parsed.pathname.split('/')[2] ?? null;
      } else if (parsed.pathname.startsWith('/shorts/')) {
        id = parsed.pathname.split('/')[2] ?? null;
      } else {
        id = parsed.searchParams.get('v');
      }
    }
    if (!id || !/^[a-zA-Z0-9_-]{6,}$/.test(id)) return null;
    return `https://www.youtube.com/embed/${id}`;
  } catch {
    return null;
  }
}

export function vimeoEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    let id: string | null = null;
    if (host === 'player.vimeo.com') {
      id = parsed.pathname.split('/').filter(Boolean).pop() ?? null;
    } else if (host === 'vimeo.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      id = parts.find((p) => /^\d+$/.test(p)) ?? null;
    }
    if (!id || !/^\d+$/.test(id)) return null;
    return `https://player.vimeo.com/video/${id}`;
  } catch {
    return null;
  }
}

export function isImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime.startsWith('image/');
}

/** Short uppercase extension label for download UI (e.g. PDF, PNG). */
export function episodeFileExtensionLabel(
  originalFilename: string | null | undefined,
  mimeType: string | null | undefined,
): string | null {
  const name = originalFilename?.trim() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toUpperCase();
  }
  const mime = mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) {
    const subtype = mime.slice('image/'.length).split('+')[0] ?? '';
    if (subtype === 'jpeg') return 'JPG';
    return subtype ? subtype.toUpperCase() : null;
  }
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('wordprocessingml')) return 'DOCX';
  if (mime.includes('spreadsheetml')) return 'XLSX';
  if (mime.includes('presentationml')) return 'PPTX';
  if (mime === 'application/zip') return 'ZIP';
  if (mime === 'text/plain') return 'TXT';
  if (mime === 'text/csv') return 'CSV';
  if (mime === 'text/markdown') return 'MD';
  return null;
}
