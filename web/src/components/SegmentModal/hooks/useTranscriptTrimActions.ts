import { parseSrtTimeToSeconds } from '../utils/srt';
import {
  mergeTrimRanges,
  getTrimContainingEntry,
  restoreTrimForEntry,
} from '../utils/transcriptTrimUtils';
import type { SrtEntry } from '../utils/srt';

export interface UseTranscriptTrimActionsParams {
  srtEntries: SrtEntry[] | null;
  trimRanges: Array<[number, number]>;
  setTrimRanges: (ranges: Array<[number, number]>) => void;
}

/** Local-only actions; no API calls. Persist via Save button.
 * Delete adds to trim_ranges but keeps the entry in the transcript (shows as collapsed with restore). */
export function useTranscriptTrimActions({
  srtEntries,
  trimRanges,
  setTrimRanges,
}: UseTranscriptTrimActionsParams) {
  function handleSoftDeleteEntry(entryIndex: number) {
    const entry = srtEntries?.[entryIndex];
    if (!entry) return;

    const startSec = parseSrtTimeToSeconds(entry.start);
    const endSec = parseSrtTimeToSeconds(entry.end);

    const alreadyTrimmed = getTrimContainingEntry(startSec, endSec, trimRanges) >= 0;
    if (!alreadyTrimmed) {
      const merged = mergeTrimRanges([...trimRanges, [startSec, endSec]]);
      setTrimRanges(merged);
    }
    /* Entry stays in transcript; UI shows it collapsed (1 line, ellipsis, restore) */
  }

  function handleRestoreEntry(entryIndex: number) {
    const entry = srtEntries?.[entryIndex];
    if (!entry) return;

    const startSec = parseSrtTimeToSeconds(entry.start);
    const endSec = parseSrtTimeToSeconds(entry.end);

    const trimIndex = getTrimContainingEntry(startSec, endSec, trimRanges);
    if (trimIndex < 0) return;

    const newRanges = restoreTrimForEntry(trimRanges, trimIndex, startSec, endSec);
    setTrimRanges(newRanges);
  }

  return {
    handleSoftDeleteEntry,
    handleRestoreEntry,
  };
}
