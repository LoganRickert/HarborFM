import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Opens the subscription dialog when `?manage=true` is present.
 * Setting open also writes the query param; closing clears it.
 */
export function useManageSubscriptionDialog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const manageRequested = searchParams.get('manage') === 'true';
  const [open, setOpen] = useState(manageRequested);

  useEffect(() => {
    if (manageRequested) setOpen(true);
  }, [manageRequested]);

  const setManageOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set('manage', 'true');
          else params.delete('manage');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [open, setManageOpen] as const;
}
