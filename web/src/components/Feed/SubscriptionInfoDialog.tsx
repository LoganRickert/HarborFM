import { useState } from 'react';
import { Lock, X, Unlock, LogOut } from 'lucide-react';
import { useSubscriberAuth } from '../../hooks/useSubscriberAuth';
import styles from './SubscriptionInfoDialog.module.css';

interface SubscriptionInfoDialogProps {
  open: boolean;
  onClose: () => void;
  isSubscriberOnly: boolean;
  podcastSlug: string;
}

export function SubscriptionInfoDialog({
  open,
  onClose,
  isSubscriberOnly,
  podcastSlug,
}: SubscriptionInfoDialogProps) {
  const [tokenInput, setTokenInput] = useState('');
  const { isAuthenticatedForPodcast, authenticate, logout, isLoading, error } = useSubscriberAuth();

  if (!open) return null;

  const isAuthenticated = isAuthenticatedForPodcast(podcastSlug);

  const dialogTitle = isAuthenticated
    ? 'Subscriber Access Granted'
    : isSubscriberOnly
    ? 'Subscription Required'
    : 'Premium Episodes Available';

  const lockMessage = isAuthenticated
    ? 'You have access to all subscriber-only content for this podcast.'
    : isSubscriberOnly
    ? 'This podcast is subscriber-only. You must subscribe to access all episodes.'
    : 'This podcast offers premium subscriber-only episodes alongside free content.';

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    await authenticate(tokenInput.trim(), podcastSlug);
  };

  const handleLogout = async () => {
    await logout(podcastSlug);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <Lock
            size={20}
            strokeWidth={2}
            className={isSubscriberOnly ? styles.lockIconGold : styles.lockIcon}
          />
          <h3 className={styles.title}>{dialogTitle}</h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        
        <p className={styles.message}>{lockMessage}</p>

        {!isAuthenticated && (
          <form onSubmit={handleUnlock} className={styles.form}>
            <label htmlFor="token-input" className={styles.label}>
              Enter your subscriber token or RSS feed URL
            </label>
            <input
              id="token-input"
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="hfm_sub_... or paste RSS URL"
              className={styles.input}
              disabled={isLoading}
            />
            <p className={styles.helpText}>
              Paste your private RSS feed URL or subscriber token
            </p>
            {error && <div className={styles.errorCard}>{error}</div>}
            <button
              type="submit"
              className={styles.unlockButton}
              disabled={isLoading || !tokenInput.trim()}
            >
              {isLoading ? (
                'Authenticating...'
              ) : (
                <>
                  <Unlock size={18} />
                  Unlock Content
                </>
              )}
            </button>
          </form>
        )}

        {isAuthenticated && (
          <button
            type="button"
            onClick={handleLogout}
            className={styles.logoutButton}
            disabled={isLoading}
          >
            <LogOut size={18} />
            {isLoading ? 'Logging out...' : 'Logout'}
          </button>
        )}
      </div>
    </div>
  );
}
