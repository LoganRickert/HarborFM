import { useCallback, useRef, useState } from 'react';
import { AudioUnlockContext } from './audioUnlockContext';

type RetryFn = () => void;

export function AudioUnlockProvider({ children }: { children: React.ReactNode }) {
  const retryFnsRef = useRef<Map<string, RetryFn>>(new Map());
  const needingUnlockRef = useRef<Set<string>>(new Set());
  const [, setUnlockVersion] = useState(0);

  const register = useCallback((id: string, retryFn: RetryFn) => {
    retryFnsRef.current.set(id, retryFn);
    return () => {
      retryFnsRef.current.delete(id);
      needingUnlockRef.current.delete(id);
    };
  }, []);

  const setNeedsUnlock = useCallback((id: string, needs: boolean) => {
    const had = needingUnlockRef.current.has(id);
    if (needs && !had) {
      needingUnlockRef.current.add(id);
      setUnlockVersion((v) => v + 1);
    } else if (!needs && had) {
      needingUnlockRef.current.delete(id);
      setUnlockVersion((v) => v + 1);
    }
  }, []);

  const hasAnyNeedingUnlock = needingUnlockRef.current.size > 0;

  const triggerUnlock = useCallback(() => {
    retryFnsRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
  }, []);

  const value = {
    register,
    setNeedsUnlock,
    hasAnyNeedingUnlock,
    triggerUnlock,
  };

  return (
    <AudioUnlockContext.Provider value={value}>
      {children}
    </AudioUnlockContext.Provider>
  );
}
