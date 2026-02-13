import { Trash2, Calendar, Ban, Power } from 'lucide-react';
import sharedStyles from './PodcastDetail/shared.module.css';
import tokenStyles from './SubscriberTokens/SubscriberTokens.module.css';

const styles = { ...sharedStyles, ...tokenStyles };

export type TokenStatus = 'active' | 'disabled' | 'expired';

export interface TokenListRowProps {
  name: string;
  status: TokenStatus;
  metaText: string;
  readOnly: boolean;
  extendEditing: boolean;
  extendValue: string;
  onExtendValueChange: (value: string) => void;
  onExtendSave: () => void;
  onExtendCancel: () => void;
  onExtendClick: () => void;
  onEnableDisable: () => void;
  enableDisableDisabled: boolean;
  onRevoke: () => void;
  revokeDisabled: boolean;
  updatePending: boolean;
  revokeLabel?: string;
}

export function TokenListRow({
  name,
  status,
  metaText,
  readOnly,
  extendEditing,
  extendValue,
  onExtendValueChange,
  onExtendSave,
  onExtendCancel,
  onExtendClick,
  onEnableDisable,
  enableDisableDisabled,
  onRevoke,
  revokeDisabled,
  updatePending,
  revokeLabel = 'Revoke',
}: TokenListRowProps) {
  const statusLabel = status === 'expired' ? 'Expired' : status === 'disabled' ? 'Disabled' : 'Active';
  const statusClass =
    status === 'active' ? styles.statusBadgeActive : styles.statusBadgeDisabledDanger;

  return (
    <li className={styles.exportCard}>
      <div className={styles.exportCardRow}>
        <div className={styles.tokenCardMeta}>
          <strong>{name}</strong>
          <div className={styles.tokenCardMetaRow}>
            <span className={statusClass}>{statusLabel}</span>
            <span className={styles.tokenMetaText}>{metaText}</span>
          </div>
        </div>
        {!readOnly && (
          <div className={styles.tokenCardActions}>
            {extendEditing ? (
              <div className={styles.tokenExtendForm}>
                <input
                  type="datetime-local"
                  value={extendValue}
                  onChange={(e) => onExtendValueChange(e.target.value)}
                  className={styles.tokenExtendInput}
                />
                <div className={styles.tokenExtendActions}>
                  <button
                    type="button"
                    className={styles.tokenExtendSave}
                    onClick={onExtendSave}
                    disabled={updatePending}
                  >
                    Save
                  </button>
                  <button type="button" className={styles.tokenExtendCancel} onClick={onExtendCancel}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.tokenActionBtn}
                  onClick={onExtendClick}
                  aria-label="Extend"
                >
                  <Calendar size={16} aria-hidden />
                  Extend
                </button>
                <button
                  type="button"
                  className={styles.tokenActionBtn}
                  onClick={onEnableDisable}
                  disabled={enableDisableDisabled}
                  aria-label={
                    enableDisableDisabled
                      ? 'Expired token cannot be modified'
                      : status === 'disabled' || status === 'expired'
                        ? 'Enable'
                        : 'Disable'
                  }
                  title={
                    enableDisableDisabled
                      ? 'Expired tokens cannot be enabled or disabled. Extend the expiration date first.'
                      : undefined
                  }
                >
                  {status === 'disabled' || status === 'expired' ? (
                    <Power size={16} aria-hidden />
                  ) : (
                    <Ban size={16} aria-hidden />
                  )}
                  {status === 'disabled' || status === 'expired' ? 'Enable' : 'Disable'}
                </button>
                <button
                  type="button"
                  className={styles.tokenDeleteBtn}
                  onClick={onRevoke}
                  disabled={revokeDisabled}
                  aria-label={`${revokeLabel} ${name}`}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
