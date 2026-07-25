const STORAGE_KEY = 'harborfm.segmentEditorMode';

export type SegmentEditorMode = 'simple' | 'advanced';

/** Default is always simple; advanced is opt-in via the Advanced editor button. */
function detectDefaultMode(): SegmentEditorMode {
  return 'simple';
}

/** Read preference; seed to simple once if unset. */
export function getSegmentEditorMode(): SegmentEditorMode {
  if (typeof window === 'undefined') return 'simple';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'simple' || raw === 'advanced') return raw;
    const seeded = detectDefaultMode();
    window.localStorage.setItem(STORAGE_KEY, seeded);
    return seeded;
  } catch {
    return detectDefaultMode();
  }
}

export function setSegmentEditorMode(mode: SegmentEditorMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}
