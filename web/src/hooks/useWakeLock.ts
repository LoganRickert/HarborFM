import { useEffect, useRef } from 'react';

/** Request a screen wake lock to prevent the device from sleeping (e.g. during a call).
 * Re-requests when the document becomes visible again since the lock is auto-released
 * when the tab is hidden. Only runs when active is true and when the Wake Lock API is supported.
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) {
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
      return;
    }

    if (!('wakeLock' in navigator)) return;

    function requestLock() {
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          sentinelRef.current = sentinel;
        })
        .catch(() => {
          /* API may reject (e.g. low battery, document not visible) */
        });
    }

    requestLock();

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && active) {
        requestLock();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, [active]);
}
