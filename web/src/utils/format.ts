export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatSeasonEpisode(
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined
): string {
  if (seasonNumber != null && episodeNumber != null) {
    return `S${seasonNumber} E${episodeNumber}`;
  }
  if (seasonNumber != null) {
    return `S${seasonNumber}`;
  }
  if (episodeNumber != null) {
    return `E${episodeNumber}`;
  }
  return '';
}
