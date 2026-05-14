import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { startImportPodcast } from '../api/podcasts';
import styles from './ImportPodcastDialog.module.css';

export interface ImportPodcastDialogProps {
  open: boolean;
  onClose: () => void;
  onImportStarted: (podcastId: string) => void;
}

export function ImportPodcastDialog({ open, onClose, onImportStarted }: ImportPodcastDialogProps) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setError(null);
      setUrl('');
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const feedUrl = url.trim();
    if (!feedUrl) {
      setError('Enter a feed URL');
      return;
    }
    setError(null);
    setPhase('submitting');
    try {
      const { podcastId } = await startImportPodcast(feedUrl);
      onImportStarted(podcastId);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409
          ? 'You already have an import in progress. Wait for it to finish or refresh the page to see its status.'
          : err instanceof Error
            ? err.message
            : 'Import failed';
      setError(message);
      setPhase('idle');
    }
  }

  if (!open) return null;

  const busy = phase === 'submitting';

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.importDialogOverlay} />
        <Dialog.Content className={styles.importDialogContent}>
          <div className={styles.importDialogHeaderRow}>
            <Dialog.Title className={styles.importDialogTitle}>Import Podcast</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.importDialogClose}
                aria-label="Close"
                disabled={busy}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.importDialogDescription}>
            Enter the RSS or Atom feed URL of the podcast you want to import. Episodes will be downloaded and added as a new show. This will run in the background; you may close this page and the import will continue.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={styles.importDialogForm}>
            <label className={styles.importDialogLabel}>
              Feed URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={styles.importDialogInput}
                placeholder="https://example.com/feed.xml"
                disabled={busy}
                autoFocus
              />
            </label>
            {error && (
              <div className={styles.importDialogErrorCard} role="alert">
                <p className={styles.importDialogError}>{error}</p>
              </div>
            )}
            <div className={styles.importDialogActions}>
              <button
                type="button"
                className={styles.importDialogSecondary}
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className={styles.importDialogPrimary} disabled={busy || !url.trim()}>
                {busy ? 'Starting…' : 'Import'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
