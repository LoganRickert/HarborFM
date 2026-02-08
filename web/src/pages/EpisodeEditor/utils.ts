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
