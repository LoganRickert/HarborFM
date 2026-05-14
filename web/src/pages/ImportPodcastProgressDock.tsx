import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getImportStatus, type ImportStatus } from '../api/podcasts';
import styles from './ImportPodcastProgressDock.module.css';

export interface ImportPodcastProgressDockProps {
  podcastId: string;
  onDismiss: () => void;
}

const POLL_INTERVAL_MS = 5000;

function progressPercent(data: ImportStatus): { value: number; determinate: boolean } {
  const total = data.totalEpisodes;
  if (total != null && total > 0) {
    if (data.status === 'pending') {
      return { value: 0, determinate: true };
    }
    if (data.status === 'importing') {
      const cur = data.currentEpisode ?? 0;
      return {
        value: Math.min(100, Math.round(((cur + 1) / total) * 100)),
        determinate: true,
      };
    }
  }
  if (data.status === 'pending' || data.status === 'importing') {
    return { value: 0, determinate: false };
  }
  return { value: 0, determinate: true };
}

export function ImportPodcastProgressDock({ podcastId, onDismiss }: ImportPodcastProgressDockProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<ImportStatus | null>(null);
  const [failedError, setFailedError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const podcastIdRef = useRef(podcastId);

  podcastIdRef.current = podcastId;

  useEffect(() => {
    setSnapshot(null);
    setFailedError(null);
  }, [podcastId]);

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const poll = () => {
      getImportStatus(podcastIdRef.current)
        .then((data) => {
          setSnapshot(data);
          if (data.status === 'done') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            queryClient.invalidateQueries({ queryKey: ['podcasts'] });
            queryClient.invalidateQueries({ queryKey: ['activeImport'] });
            const id = podcastIdRef.current;
            onDismissRef.current();
            if (id) navigate(`/podcasts/${id}`);
          } else if (data.status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setFailedError(data.error ?? 'Import failed');
            queryClient.invalidateQueries({ queryKey: ['activeImport'] });
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
  }, [queryClient, navigate]);

  const { value, determinate } = snapshot
    ? progressPercent(snapshot)
    : { value: 0, determinate: false };

  const statusLine =
    failedError != null
      ? 'Import failed'
      : snapshot?.message ?? 'Starting import…';

  return (
    <aside className={styles.dock} aria-label="Podcast import progress">
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Importing podcast</h2>
        <button
          type="button"
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label="Hide import progress until you refresh the page"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <p className={styles.status} aria-live="polite">
        {statusLine}
      </p>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? value : undefined}
        aria-valuetext={determinate ? `${value}%` : 'In progress'}
      >
        {determinate ? (
          <div className={styles.fill} style={{ width: `${value}%` }} />
        ) : (
          <div className={`${styles.fill} ${styles.fillIndeterminate}`} />
        )}
      </div>
      {failedError && (
        <div className={styles.errorCard} role="alert">
          <p className={styles.errorText}>{failedError}</p>
        </div>
      )}
    </aside>
  );
}
