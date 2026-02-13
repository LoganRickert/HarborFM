import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { startImportPodcast, getImportStatus } from '../api/podcasts';
import styles from './ImportPodcastDialog.module.css';

export interface ImportPodcastDialogProps {
  open: boolean;
  /** When set (e.g. after refresh), dialog opens in polling mode for this podcast. */
  initialPodcastId?: string | null;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 5000;

export function ImportPodcastDialog({ open, initialPodcastId, onClose }: ImportPodcastDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'polling'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const podcastIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setError(null);
      setStatusMessage(null);
      podcastIdRef.current = null;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }
    if (initialPodcastId?.trim()) {
      podcastIdRef.current = initialPodcastId.trim();
      setPhase('polling');
      setStatusMessage('Importing…');
    }
  }, [open, initialPodcastId]);

  useEffect(() => {
    if (phase !== 'polling' || !podcastIdRef.current) return;
    const poll = () => {
      getImportStatus(podcastIdRef.current!)
        .then((data) => {
          setStatusMessage(data.message ?? null);
          if (data.status === 'done') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            queryClient.invalidateQueries({ queryKey: ['podcasts'] });
            onClose();
            const id = podcastIdRef.current;
            if (id) navigate(`/podcasts/${id}`);
          } else if (data.status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setError(data.error ?? 'Import failed');
            setPhase('idle');
          }
        })
        .catch(() => {
          // keep polling on network error
        });
    };
    poll();
    pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [phase, onClose, queryClient, navigate]);

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
      const { podcast_id } = await startImportPodcast(feedUrl);
      podcastIdRef.current = podcast_id;
      setPhase('polling');
      setStatusMessage('Starting import…');
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

  const canClose = phase === 'idle';

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && canClose && onClose()}>
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
                disabled={!canClose}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.importDialogDescription}>
            Enter the RSS or Atom feed URL of the podcast you want to import. Episodes will be downloaded and added as a new show.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={styles.importDialogForm}>
            {(canClose || error) && (
              <>
                <label className={styles.importDialogLabel}>
                  Feed URL
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className={styles.importDialogInput}
                    placeholder="https://example.com/feed.xml"
                    disabled={!canClose}
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
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.importDialogPrimary}
                    disabled={!canClose || !url.trim()}
                  >
                    Import
                  </button>
                </div>
              </>
            )}
            {(phase === 'submitting' || phase === 'polling') && !error && (
              <div className={styles.importDialogProgress}>
                <div className={styles.loadingSpinner} aria-hidden="true" />
                <p className={styles.importDialogProgressText}>
                  {phase === 'submitting' ? 'Importing…' : (statusMessage ?? 'Importing…')}
                </p>
              </div>
            )}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
