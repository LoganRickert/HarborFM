import { useEffect, type RefObject } from 'react';

/**
 * Auto-resize a textarea to fit its content. Runs on value change and when
 * the component mounts (for existing content). Use with overflow: hidden and
 * resize: none on the textarea.
 */
export function useAutoResizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  options?: { minHeight?: number }
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    const min = options?.minHeight ?? 0;
    const h = min ? Math.max(el.scrollHeight, min) : el.scrollHeight;
    el.style.height = `${h}px`;
  }, [ref, value, options?.minHeight]);
}
