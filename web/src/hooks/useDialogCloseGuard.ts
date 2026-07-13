import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseDialogCloseGuardOptions {
  isDirty: boolean;
  onClose: () => void;
}

/**
 * Guard Radix dialog close when the form is dirty: show confirm instead of discarding.
 * Includes a short suppress window after dismissing the confirm (mobile ghost clicks).
 */
export function useDialogCloseGuard({ isDirty, onClose }: UseDialogCloseGuardOptions) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const suppressParentCloseRef = useRef(false);
  const suppressParentCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const armSuppressParentClose = useCallback(() => {
    suppressParentCloseRef.current = true;
    if (suppressParentCloseTimerRef.current) clearTimeout(suppressParentCloseTimerRef.current);
    suppressParentCloseTimerRef.current = setTimeout(() => {
      suppressParentCloseRef.current = false;
      suppressParentCloseTimerRef.current = null;
    }, 400);
  }, []);

  useEffect(() => {
    return () => {
      if (suppressParentCloseTimerRef.current) clearTimeout(suppressParentCloseTimerRef.current);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (confirmOpen || suppressParentCloseRef.current) return;
    if (isDirtyRef.current) {
      setConfirmOpen(true);
    } else {
      onCloseRef.current();
    }
  }, [confirmOpen]);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      requestClose();
    },
    [requestClose],
  );

  const handleConfirmOpenChange = useCallback(
    (open: boolean) => {
      setConfirmOpen(open);
      if (!open) armSuppressParentClose();
    },
    [armSuppressParentClose],
  );

  const handleDiscard = useCallback(() => {
    setConfirmOpen(false);
    onCloseRef.current();
  }, []);

  const dialogContentProps = {
    onPointerDownOutside: (e: Event) => {
      if (confirmOpen) e.preventDefault();
    },
    onInteractOutside: (e: Event) => {
      if (confirmOpen) e.preventDefault();
    },
    onEscapeKeyDown: (e: KeyboardEvent) => {
      if (confirmOpen) {
        e.preventDefault();
        return;
      }
      // Let Radix close; onOpenChange(false) will run requestClose.
    },
  };

  return {
    confirmOpen,
    requestClose,
    onOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
  };
}
