export interface SrtEntry {
  start: string;
  end: string;
  text: string;
}

export function parseSrt(srtText: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = srtText.split(/\n\s*\n/).filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1]?.trim();
    if (!timeLine || !timeLine.includes('-->')) continue;
    const [start, end] = timeLine.split('-->').map((s) => s.trim());
    const text = lines.slice(2).join('\n').trim();
    if (start && end && text) {
      entries.push({ start, end, text });
    }
  }
  return entries;
}

/**
 * Format SRT time for display. HH:MM:SS,mmm -> MM:SS.mmm or HH:MM:SS.mmm if hours > 0.
 */
export function formatSrtTime(timeStr: string): string {
  const normalized = timeStr.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0] || '0', 10);
    const minutes = parts[1] || '00';
    const seconds = parts[2] || '00.000';
    if (hours === 0) {
      return `${minutes}:${seconds}`;
    }
    return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
  }
  return timeStr;
}

export function parseSrtTimeToSeconds(timeStr: string): number {
  const normalized = timeStr.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length !== 3) return 0;
  const hours = parseFloat(parts[0] || '0');
  const minutes = parseFloat(parts[1] || '0');
  const seconds = parseFloat(parts[2] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatSrtTimeFromSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}
