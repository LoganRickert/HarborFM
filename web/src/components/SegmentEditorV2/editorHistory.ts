import type { Marker } from '@harborfm/shared';
import type { EditorClip } from './clipOps';

export type EditorHistorySnapshot = {
  clips: EditorClip[];
  trimRanges: Array<[number, number]>;
  markers: Marker[];
  selectedId: string | null;
  rippleStartSec: number | null;
};

const MAX_HISTORY = 50;

export function cloneEditorSnapshot(
  snap: EditorHistorySnapshot,
): EditorHistorySnapshot {
  return {
    clips: snap.clips.map((c) => ({ ...c })),
    trimRanges: snap.trimRanges.map(([a, b]) => [a, b] as [number, number]),
    markers: snap.markers.map((m) => ({ ...m })),
    selectedId: snap.selectedId,
    rippleStartSec: snap.rippleStartSec,
  };
}

export function createEditorHistory() {
  const past: EditorHistorySnapshot[] = [];
  const future: EditorHistorySnapshot[] = [];

  return {
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past.length = 0;
      future.length = 0;
    },
    push(current: EditorHistorySnapshot) {
      past.push(cloneEditorSnapshot(current));
      if (past.length > MAX_HISTORY) past.shift();
      future.length = 0;
    },
    undo(current: EditorHistorySnapshot): EditorHistorySnapshot | null {
      const prev = past.pop();
      if (!prev) return null;
      future.push(cloneEditorSnapshot(current));
      return prev;
    },
    redo(current: EditorHistorySnapshot): EditorHistorySnapshot | null {
      const next = future.pop();
      if (!next) return null;
      past.push(cloneEditorSnapshot(current));
      return next;
    },
  };
}

export type EditorHistory = ReturnType<typeof createEditorHistory>;
