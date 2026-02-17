export function episodeWebSocketUrl(episodeId: string): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/episodes/${encodeURIComponent(episodeId)}/ws`;
}
