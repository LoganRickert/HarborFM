import { useMemo } from 'react';
import { AppSettings } from '../api/settings';

export function useFormDirtyTracking(
  currentForm: AppSettings,
  savedForm: string | null
): boolean {
  const isDirty = useMemo(() => {
    if (savedForm === null) return false;
    return JSON.stringify(currentForm) !== savedForm;
  }, [currentForm, savedForm]);

  return isDirty;
}
