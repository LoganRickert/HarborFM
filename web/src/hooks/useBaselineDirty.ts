import { useMemo } from 'react';

/** True when baseline is set and JSON of current differs from baseline. */
export function useBaselineDirty(
  baseline: string | null,
  current: unknown,
): boolean {
  return useMemo(() => {
    if (baseline === null) return false;
    return JSON.stringify(current) !== baseline;
  }, [baseline, current]);
}

export function snapshotForDirty(value: unknown): string {
  return JSON.stringify(value);
}
