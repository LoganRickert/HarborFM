import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberInfoDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SubscriberInfoDialog({ isOpen, onClose }: SubscriberInfoDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent} aria-describedby="subscriber-info-desc">
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>How subscriber feeds work</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div id="subscriber-info-desc" className={styles.subscriberInfoBody}>
            <p>
              <strong>Subscriber-only feeds</strong> let you share a private RSS feed with specific people. Each subscriber gets a unique feed URL that only they can use.
            </p>
            <p>
              You create <strong>tokens</strong> (one per subscriber or group). For each token you get a secret feed link. Share that link with the subscriber-they add it to their podcast app like any other feed. The feed can include <strong>subscriber-only episodes</strong> that you mark in the episode editor; those episodes do not appear in your public feed or on the public show page.
            </p>
            <p>
              You can set optional <strong>valid from</strong> and <strong>valid until</strong> dates to limit when a token works, and you can <strong>disable</strong> or <strong>delete</strong> tokens anytime. Disabled tokens stop working; deleted tokens are removed. The raw token is only shown once when you create it-copy the feed URL then.
            </p>
            <p>
              Enable subscriptions above to create tokens and start sharing a private feed.
            </p>
          </div>
          <div className={styles.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={styles.subscriberDialogConfirmBtn} aria-label="Close">Got it</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
