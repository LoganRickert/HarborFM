import { useState, useEffect } from 'react';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Returns a debounced version of the value. Updates to the debounced value
 * are delayed by SEARCH_DEBOUNCE_MS. Empty string updates immediately.
 */
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    // Empty/falsy values update immediately (e.g. clearing search)
    if (value === '' || value === null || value === undefined) {
      setDebouncedValue(value);
      return;
    }
    const id = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return debouncedValue;
}
