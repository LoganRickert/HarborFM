/** Utilities for transcript–trim integration (soft delete, restore). */

/** Merge overlapping or adjacent trim ranges. E.g. [[0,5],[4,10],[15,20]] to [[0,10],[15,20]]. */
export function mergeTrimRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [[sorted[0]![0], sorted[0]![1]]];
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Returns the index of the trim range that wholly contains the entry [entryStart, entryEnd],
 * or -1 if no trim fully contains it.
 * Entry is wholly in trim [ts, te] iff entryStart >= ts && entryEnd <= te.
 */
export function getTrimContainingEntry(
  entryStart: number,
  entryEnd: number,
  trimRanges: Array<[number, number]>
): number {
  for (let i = 0; i < trimRanges.length; i++) {
    const [ts, te] = trimRanges[i]!;
    if (entryStart >= ts && entryEnd <= te) return i;
  }
  return -1;
}

/**
 * Adjusts trim ranges so the entry [entryStart, entryEnd] is no longer trimmed.
 * The entry must be wholly within the trim at trimIndex.
 * Returns new trim array with empty ranges filtered out.
 */
export function restoreTrimForEntry(
  trimRanges: Array<[number, number]>,
  trimIndex: number,
  entryStart: number,
  entryEnd: number
): Array<[number, number]> {
  const [tStart, tEnd] = trimRanges[trimIndex]!;
  let replacement: Array<[number, number]>;

  if (entryStart <= tStart && entryEnd >= tEnd) {
    // Entry equals trim: remove it
    replacement = [];
  } else if (entryStart <= tStart) {
    // Entry at start: keep [entryEnd, tEnd]
    replacement = entryEnd < tEnd ? [[entryEnd, tEnd]] : [];
  } else if (entryEnd >= tEnd) {
    // Entry at end: keep [tStart, entryStart]
    replacement = tStart < entryStart ? [[tStart, entryStart]] : [];
  } else {
    // Entry in middle: split into [tStart, entryStart] and [entryEnd, tEnd]
    replacement = [
      [tStart, entryStart],
      [entryEnd, tEnd],
    ];
  }

  const newRanges = [
    ...trimRanges.slice(0, trimIndex),
    ...replacement,
    ...trimRanges.slice(trimIndex + 1),
  ].filter(([s, e]) => s < e);

  return mergeTrimRanges(newRanges);
}
