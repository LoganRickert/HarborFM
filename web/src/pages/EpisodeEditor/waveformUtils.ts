/** Utilities for waveform trim ranges and time mapping. */

export function isInTrimRange(time: number, trimRanges: Array<[number, number]>): boolean {
  for (const [start, end] of trimRanges) {
    if (time >= start && time < end) return true;
  }
  return false;
}

/** Get total trimmed duration. */
export function getTrimmedDuration(trimRanges: Array<[number, number]>): number {
  return trimRanges.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** Map actual time to effective (playable) time. */
export function toEffectiveTime(actualTime: number, trimRanges: Array<[number, number]>): number {
  let trimmed = 0;
  for (const [start, end] of trimRanges) {
    if (end <= actualTime) trimmed += end - start;
    else if (start < actualTime) trimmed += actualTime - start;
  }
  return actualTime - trimmed;
}

/** Map effective time back to actual time. */
export function toActualTime(effectiveTime: number, trimRanges: Array<[number, number]>, durationSec: number): number {
  if (trimRanges.length === 0) return effectiveTime;
  const sorted = [...trimRanges].sort((a, b) => a[0] - b[0]);
  let eff = 0;
  let prevEnd = 0;
  for (const [start, end] of sorted) {
    const segmentLen = start - prevEnd;
    if (eff + segmentLen >= effectiveTime) return prevEnd + (effectiveTime - eff);
    eff += segmentLen;
    prevEnd = end;
  }
  const segmentLen = durationSec - prevEnd;
  if (eff + segmentLen >= effectiveTime) return prevEnd + (effectiveTime - eff);
  return durationSec;
}
