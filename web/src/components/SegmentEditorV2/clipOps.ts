import type { SegmentTrackClip } from '@harborfm/shared';

export type EditorClip = SegmentTrackClip & {
  /** Stable UI id (segmentId or generated). */
  uiId: string;
};

export function clipStartMs(c: SegmentTrackClip): number {
  // Remake clamps negative startMs to 0 (adelay / concat). Keep the advanced
  // editor on that same mix timebase so soft trims line up with the simple editor.
  const raw =
    typeof c.startMs === 'number' && Number.isFinite(c.startMs) ? c.startMs : 0;
  return Math.max(0, raw);
}

export function clipLengthMs(c: SegmentTrackClip): number {
  if (typeof c.lengthMs === 'number' && c.lengthMs > 0) return c.lengthMs;
  const start = clipStartMs(c);
  if (typeof c.endMs === 'number' && c.endMs > start) return c.endMs - start;
  return 0;
}

export function clipEndMs(c: SegmentTrackClip): number {
  return clipStartMs(c) + clipLengthMs(c);
}

export function sourceOffsetMsOf(c: SegmentTrackClip): number {
  return typeof c.sourceOffsetMs === 'number' && c.sourceOffsetMs > 0
    ? c.sourceOffsetMs
    : 0;
}

function newUiId(): string {
  return `clip_${Math.random().toString(36).slice(2, 10)}`;
}

export function toEditorClips(clips: SegmentTrackClip[]): EditorClip[] {
  const seen = new Set<string>();
  const mapped = clips.map((c) => {
    let uiId =
      typeof c.segmentId === 'string' && c.segmentId ? c.segmentId : newUiId();
    // Clip Settings / selection keys must be unique even if segmentIds collide.
    if (seen.has(uiId)) uiId = newUiId();
    seen.add(uiId);
    return { ...c, uiId };
  });
  return trimOverlappingSoundboardClips(mapped);
}

export function toApiClips(clips: EditorClip[]): SegmentTrackClip[] {
  return clips.map(({ uiId, ...rest }) => {
    void uiId;
    return {
      ...rest,
      segmentId: rest.segmentId || uiId,
      startMs: clipStartMs(rest),
      lengthMs: clipLengthMs(rest),
      endMs: clipEndMs(rest),
      sourceOffsetMs: sourceOffsetMsOf(rest),
      filePath: rest.filePath,
    };
  });
}

export function timelineDurationMs(clips: EditorClip[]): number {
  let max = 0;
  for (const c of clips) max = Math.max(max, clipEndMs(c));
  return max;
}

/** Blade split at absolute timeline ms. Returns null if playhead not inside clip. */
export function bladeSplitClip(
  clip: EditorClip,
  atTimelineMs: number,
): [EditorClip, EditorClip] | null {
  const start = clipStartMs(clip);
  const len = clipLengthMs(clip);
  const local = atTimelineMs - start;
  if (local <= 1 || local >= len - 1) return null;
  const src = sourceOffsetMsOf(clip);
  const left: EditorClip = {
    ...clip,
    lengthMs: local,
    endMs: start + local,
  };
  const right: EditorClip = {
    ...clip,
    uiId: newUiId(),
    segmentId: newUiId(),
    startMs: atTimelineMs,
    sourceOffsetMs: src + local,
    lengthMs: len - local,
    endMs: atTimelineMs + (len - local),
  };
  return [left, right];
}

/** Trim left edge to new timeline start (keeps right edge fixed). */
export function trimClipLeft(clip: EditorClip, newStartMs: number): EditorClip {
  const end = clipEndMs(clip);
  const clamped = Math.max(0, Math.min(newStartMs, end - 1));
  const delta = clamped - clipStartMs(clip);
  const src = sourceOffsetMsOf(clip);
  const newLen = end - clamped;
  return {
    ...clip,
    startMs: clamped,
    sourceOffsetMs: Math.max(0, src + delta),
    lengthMs: newLen,
    endMs: end,
  };
}

/** Trim right edge to new timeline end (keeps left edge fixed). */
export function trimClipRight(clip: EditorClip, newEndMs: number): EditorClip {
  const start = clipStartMs(clip);
  const clamped = Math.max(start + 1, newEndMs);
  return {
    ...clip,
    lengthMs: clamped - start,
    endMs: clamped,
  };
}

/**
 * Resize left edge. Clamps timeline start to >= 0 and source offset to >= 0
 * (cannot reveal audio before the start of the take).
 */
export function resizeClipLeft(clip: EditorClip, newStartMs: number): EditorClip {
  const end = clipEndMs(clip);
  const start = clipStartMs(clip);
  const src = sourceOffsetMsOf(clip);
  // Earliest timeline start allowed by remaining source before the in-point.
  const minStartBySource = Math.max(0, start - src);
  const clamped = Math.max(
    minStartBySource,
    Math.min(Math.max(0, newStartMs), end - 1),
  );
  const delta = clamped - start;
  return {
    ...clip,
    startMs: clamped,
    sourceOffsetMs: Math.max(0, src + delta),
    lengthMs: end - clamped,
    endMs: end,
  };
}

/**
 * Resize right edge. Clamps length so sourceOffset + length does not exceed
 * takeDurationMs (max media length).
 */
export function resizeClipRight(
  clip: EditorClip,
  newEndMs: number,
  takeDurationMs: number,
): EditorClip {
  const start = clipStartMs(clip);
  const src = sourceOffsetMsOf(clip);
  const maxLen = Math.max(1, Math.floor(takeDurationMs) - src);
  let newLen = Math.max(1, Math.round(newEndMs) - start);
  newLen = Math.min(newLen, maxLen);
  return {
    ...clip,
    lengthMs: newLen,
    endMs: start + newLen,
  };
}

export function groupClipsByTake(clips: EditorClip[]): Map<string, EditorClip[]> {
  const map = new Map<string, EditorClip[]>();
  for (const c of clips) {
    const key = c.filePath.replace(/\\/g, '/').split('/').pop() || c.filePath;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => clipStartMs(a) - clipStartMs(b));
  }
  return map;
}

function takeBasename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

/**
 * Lane key for the advanced editor: named call hosts (with participantId)
 * share one lane so reconnects combine. All soundboard plays share one lane
 * (one-shots should not overlap). Unnamed / renamed file takes stay one lane
 * per media file so renaming a stub does not jump it into the host group.
 */
export function editorLaneKey(clip: EditorClip): string {
  const sbId =
    typeof clip.soundboardAssetId === 'string'
      ? clip.soundboardAssetId.trim()
      : '';
  const isSoundboard = clip.source === 'soundboard' || Boolean(sbId);
  if (isSoundboard) return 'sb:soundboard';
  const name =
    typeof clip.participantName === 'string' ? clip.participantName.trim() : '';
  const participantId =
    typeof clip.participantId === 'string' ? clip.participantId.trim() : '';
  if (
    name &&
    participantId &&
    !looksLikeOpaqueTakeLabel(name)
  ) {
    return `host:${name.toLowerCase()}`;
  }
  return `file:${takeBasename(clip.filePath)}`;
}

/** segment_/clip_ ids used as labels are not real host display names. */
function looksLikeOpaqueTakeLabel(name: string): boolean {
  const t = name.trim();
  return /^segment_[a-zA-Z0-9_-]+$/i.test(t) || /^clip_[a-zA-Z0-9]+$/i.test(t);
}

/**
 * Call hosts only (have participantId). Renaming an unnamed stub sets
 * participantName but must not promote it into the host sort group.
 */
export function clipIsCallHost(clip: EditorClip): boolean {
  if (clip.source === 'soundboard') return false;
  if (clip.source === 'import' || clip.source === 'library') return false;
  const pid =
    typeof clip.participantId === 'string' ? clip.participantId.trim() : '';
  return Boolean(pid);
}

export function isSoundboardClip(clip: SegmentTrackClip): boolean {
  if (clip.source === 'soundboard') return true;
  return (
    typeof clip.soundboardAssetId === 'string' &&
    clip.soundboardAssetId.trim().length > 0
  );
}

/**
 * Shared soundboard lane: when a later play starts before an earlier one ends,
 * trim the earlier clip's end to the later start (drop near-empty leftovers).
 */
export function trimOverlappingSoundboardClips(
  clips: EditorClip[],
): EditorClip[] {
  const sbIndices: number[] = [];
  for (let i = 0; i < clips.length; i++) {
    if (isSoundboardClip(clips[i]!)) sbIndices.push(i);
  }
  if (sbIndices.length < 2) return clips;

  const ordered = [...sbIndices].sort(
    (a, b) =>
      clipStartMs(clips[a]!) - clipStartMs(clips[b]!) || a - b,
  );

  const next = clips.map((c) => ({ ...c }));
  for (let i = 0; i < ordered.length - 1; i++) {
    const curI = ordered[i]!;
    const nxtI = ordered[i + 1]!;
    const cur = next[curI]!;
    const nextStart = clipStartMs(next[nxtI]!);
    const curStart = clipStartMs(cur);
    if (clipEndMs(cur) <= nextStart) continue;
    if (nextStart <= curStart) {
      next[curI] = { ...cur, lengthMs: 0, endMs: curStart };
      continue;
    }
    next[curI] = trimClipRight(cur, nextStart);
  }

  return next.filter((c) => !isSoundboardClip(c) || clipLengthMs(c) >= 1);
}

/** Lane sorts with call hosts (above soundboard / unnamed files / imports). */
export function laneIsHostLane(
  _laneKey: string,
  clips: EditorClip[],
  opts?: { participantLabel?: string; isSoundboard?: boolean },
): boolean {
  void opts?.participantLabel;
  if (opts?.isSoundboard) return false;
  if (
    clips.length > 0 &&
    clips.every((c) => c.source === 'import' || c.source === 'library')
  ) {
    return false;
  }
  return clips.some((c) => clipIsCallHost(c));
}

/** Group clips into editor lanes (hosts combined when named). */
export function groupClipsByLane(clips: EditorClip[]): Map<string, EditorClip[]> {
  const map = new Map<string, EditorClip[]>();
  for (const c of clips) {
    const key = editorLaneKey(c);
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => clipStartMs(a) - clipStartMs(b));
  }
  return map;
}

/**
 * Replace `dominant` in the list and trim / split / delete other same-lane
 * clips that overlap its time range.
 */
export function overwriteLaneWithClip(
  clips: EditorClip[],
  dominant: EditorClip,
): EditorClip[] {
  const lane = editorLaneKey(dominant);
  const start = clipStartMs(dominant);
  const end = clipEndMs(dominant);
  if (end <= start) return clips;

  const result: EditorClip[] = [];
  for (const c of clips) {
    if (c.uiId === dominant.uiId) {
      result.push(dominant);
      continue;
    }
    if (editorLaneKey(c) !== lane) {
      result.push(c);
      continue;
    }

    const os = clipStartMs(c);
    const oe = clipEndMs(c);
    // No overlap
    if (oe <= start || os >= end) {
      result.push(c);
      continue;
    }
    // Fully covered by the dominant clip
    if (os >= start && oe <= end) {
      continue;
    }
    // Dominant punches a hole in the middle of this clip
    if (os < start && oe > end) {
      result.push(trimClipRight(c, start));
      const rightBase: EditorClip = {
        ...c,
        uiId: newUiId(),
        segmentId: newUiId(),
      };
      result.push(trimClipLeft(rightBase, end));
      continue;
    }
    // Overlaps left edge of dominant (other ends inside)
    if (os < start && oe > start) {
      result.push(trimClipRight(c, start));
      continue;
    }
    // Overlaps right edge of dominant (other starts inside)
    if (os < end && oe > end) {
      result.push(trimClipLeft(c, end));
      continue;
    }
  }
  return result;
}

/**
 * Slide a clip horizontally on its lane (keeps length + source offset).
 * Other clips on the same lane that overlap are trimmed, split, or deleted.
 * Does not change lane (no vertical move).
 */
export function slideClipOnLane(
  clips: EditorClip[],
  movedUiId: string,
  newStartMs: number,
): EditorClip[] {
  const moved = clips.find((c) => c.uiId === movedUiId);
  if (!moved) return clips;

  const len = clipLengthMs(moved);
  if (len <= 0) return clips;

  const start = Math.max(0, Math.round(newStartMs));
  const movedNext: EditorClip = {
    ...moved,
    startMs: start,
    lengthMs: len,
    endMs: start + len,
  };
  return overwriteLaneWithClip(clips, movedNext);
}

/**
 * Resize a clip edge on its lane, then overwrite overlapping same-lane clips
 * (trim / split / delete), matching slide behavior.
 */
export function resizeClipOnLane(
  clips: EditorClip[],
  resizedUiId: string,
  edge: 'left' | 'right',
  newEdgeMs: number,
  takeDurationMs: number,
): EditorClip[] {
  const clip = clips.find((c) => c.uiId === resizedUiId);
  if (!clip) return clips;
  const resized =
    edge === 'left'
      ? resizeClipLeft(clip, newEdgeMs)
      : resizeClipRight(clip, newEdgeMs, takeDurationMs);
  return overwriteLaneWithClip(clips, resized);
}
