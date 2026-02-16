import { createContext, useContext } from 'react';

type RetryFn = () => void;

export type AudioUnlockContextValue = {
  register: (id: string, retryFn: RetryFn) => () => void;
  setNeedsUnlock: (id: string, needs: boolean) => void;
  hasAnyNeedingUnlock: boolean;
  triggerUnlock: () => void;
};

export const AudioUnlockContext = createContext<AudioUnlockContextValue | null>(null);

export function useAudioUnlock() {
  return useContext(AudioUnlockContext);
}
