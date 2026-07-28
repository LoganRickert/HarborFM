import { useEffect, useRef, useState } from 'react';

const MIC_ACTIVITY_THRESHOLD = 5;
const MIC_SILENCE_WARN_MS = 10_000;

export const MIC_SILENCE_WARNING =
  'No microphone audio detected. Check that the correct microphone is selected in Settings.';

/**
 * One-time UI warning when local mic level stays near zero after join.
 * Cleared if the user speaks; skipped while muted.
 */
export function useMicSilenceWarning(
  micLevel: number,
  ready: boolean,
  muted: boolean,
): string | null {
  const [warning, setWarning] = useState<string | null>(null);
  const heardRef = useRef(false);
  const warnedRef = useRef(false);

  useEffect(() => {
    if (micLevel < MIC_ACTIVITY_THRESHOLD) return;
    heardRef.current = true;
    setWarning((prev) => (prev ? null : prev));
  }, [micLevel]);

  useEffect(() => {
    if (!ready || muted || heardRef.current || warnedRef.current) return;
    const timer = setTimeout(() => {
      if (heardRef.current || warnedRef.current) return;
      warnedRef.current = true;
      setWarning(MIC_SILENCE_WARNING);
    }, MIC_SILENCE_WARN_MS);
    return () => clearTimeout(timer);
  }, [ready, muted]);

  useEffect(() => {
    return () => {
      heardRef.current = false;
      warnedRef.current = false;
      setWarning(null);
    };
  }, []);

  return warning;
}
