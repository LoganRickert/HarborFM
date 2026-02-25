import styles from "./Popup.module.css";

export interface AlertPopupProps {
  open: boolean;
  message: string;
  title?: string;
  onClose: () => void;
}

export function AlertPopup({ open, message, title = "Notice", onClose }: AlertPopupProps) {
  if (!open) return null;
  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="popup-title">
      <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
        <h2 id="popup-title" className={styles.title}>{title}</h2>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ConfirmPopupProps {
  open: boolean;
  message: string;
  title?: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPopup({
  open,
  message,
  title = "Confirm",
  confirmLabel = "Confirm",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmPopupProps) {
  if (!open) return null;
  return (
    <div className={styles.overlay} onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="popup-title">
      <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
        <h2 id="popup-title" className={styles.title}>{title}</h2>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={variant === "danger" ? styles.dangerBtn : styles.primaryBtn}
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
