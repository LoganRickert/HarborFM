import { X } from 'lucide-react';
import type { ShowNotesItem } from '@harborfm/shared';
import styles from '../../pages/CallJoin.module.css';

export interface CallShowNotesDialogProps {
  open: boolean;
  onClose: () => void;
  items: ShowNotesItem[];
}

export function CallShowNotesDialog({ open, onClose, items }: CallShowNotesDialogProps) {
  if (!open) return null;

  return (
    <div
      className={styles.showNotesOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-show-notes-title"
    >
      <div className={styles.showNotesPopover} onClick={(e) => e.stopPropagation()}>
        <div className={styles.showNotesPopoverHeader}>
          <h2 id="call-show-notes-title" className={styles.showNotesPopoverTitle}>
            Show Notes
          </h2>
          <button type="button" className={styles.showNotesPopoverClose} onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className={styles.showNotesPopoverBody}>
          {items.length === 0 ? (
            <p className={styles.showNotesEmpty}>No topics left to discuss.</p>
          ) : (
            <ul className={styles.showNotesGuestList}>
              {items.map((item) => (
                <li key={item.id} className={styles.showNotesGuestItem}>
                  {item.durationMin != null && (
                    <span className={styles.showNotesGuestDuration}>{item.durationMin} min</span>
                  )}
                  <span className={styles.showNotesGuestText}>{item.text.trim() || 'Untitled topic'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
