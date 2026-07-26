import { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import {
  fetchWorkerJobStats,
  regenerateWorkerSecrets,
  type WorkerJobStat,
} from '../../api/settings';
import { apiGet } from '../../api/client';
import { formatBytes, formatDurationMs } from '../../utils/format';
import styles from '../../pages/Settings.module.css';

type WorkersStatus = {
  connected: number;
  idle: number;
  busy: number;
  workers: Array<{ id: string; name: string; state: string }>;
};

function kindLabel(kind: string): string {
  if (kind === 'video_generate') return 'Video';
  if (kind === 'transcribe') return 'Transcribe';
  return kind;
}

function formatFinishedAt(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function WorkersSection({ form, onFormChange }: SettingsFormProps) {
  const queryClient = useQueryClient();
  const [pathCopied, setPathCopied] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [wsCopied, setWsCopied] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['settings', 'workers-status'],
    queryFn: () => apiGet<WorkersStatus>('/settings/workers-status'),
    enabled: form.workersEnabled,
    refetchInterval: form.workersEnabled ? 5000 : false,
  });

  const { data: jobStats } = useQuery({
    queryKey: ['settings', 'workers-job-stats'],
    queryFn: () => fetchWorkerJobStats(50),
    enabled: form.workersEnabled,
    refetchInterval: form.workersEnabled ? 10000 : false,
  });

  const regenerateMutation = useMutation({
    mutationFn: regenerateWorkerSecrets,
    onSuccess: (data) => {
      onFormChange({
        workersWsPath: data.workersWsPath,
        workersSharedSecret: data.workersSharedSecret,
      });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'workers-status'] });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'workers-job-stats'] });
    },
  });

  useEffect(() => {
    if (
      form.workersEnabled &&
      (!form.workersWsPath || !form.workersSharedSecret)
    ) {
      onFormChange({
        workersWsPath: form.workersWsPath || randomToken(18),
        workersSharedSecret: form.workersSharedSecret || randomToken(32),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.workersEnabled]);

  const hostname = (form.hostname || '').trim();
  const publicBase = hostname
    ? hostname.startsWith('http')
      ? hostname.replace(/\/$/, '')
      : `https://${hostname}`
    : typeof window !== 'undefined'
      ? window.location.origin
      : '';
  const wsUrl =
    publicBase && form.workersWsPath
      ? `${publicBase.replace(/^http/, 'ws')}/api/workers/ws/${form.workersWsPath}`
      : form.workersWsPath
        ? `/api/workers/ws/${form.workersWsPath}`
        : '';

  const copy = async (text: string, which: 'path' | 'secret' | 'ws') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'path') {
        setPathCopied(true);
        setTimeout(() => setPathCopied(false), 1000);
      } else if (which === 'secret') {
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 1000);
      } else {
        setWsCopied(true);
        setTimeout(() => setWsCopied(false), 1000);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <SectionCard
      title="Compute Workers"
      subtitle="Offload video generation and self-hosted Whisper transcription to one or more worker machines. Workers connect over a secret WebSocket path."
    >
      <label className="toggle" data-settings-label="Enable remote compute workers">
        <input
          type="checkbox"
          checked={Boolean(form.workersEnabled)}
          onChange={(e) => onFormChange({ workersEnabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable remote compute workers</span>
      </label>
      {form.workersEnabled && (
        <>
          <p className={styles.inputHelp}>
            Connected: {status?.connected ?? 0} (idle {status?.idle ?? 0}, busy{' '}
            {status?.busy ?? 0})
          </p>

          <div className={styles.workerJobStatsBlock}>
            <div className={styles.workerJobStatsHeading}>Recent jobs</div>
            {(jobStats?.jobs?.length ?? 0) === 0 ? (
              <p className={styles.inputHelp}>No worker jobs recorded yet.</p>
            ) : (
              <ul className={styles.ssoProviderList}>
                {(jobStats?.jobs ?? []).map((job: WorkerJobStat) => (
                  <li key={job.id} className={styles.ssoProviderItem}>
                    <div className={styles.ssoProviderRow}>
                      <div className={styles.ssoProviderMeta}>
                        <span>
                          {job.workerName?.trim() || 'Unknown worker'}
                        </span>
                        <span className={styles.workerJobKind}>
                          {kindLabel(job.kind)}
                        </span>
                        <span
                          className={
                            job.status === 'completed'
                              ? styles.workerJobStatusOk
                              : styles.workerJobStatusFail
                          }
                        >
                          {job.status}
                        </span>
                      </div>
                      <div className={styles.workerJobWhen}>
                        {formatFinishedAt(job.finishedAt)}
                      </div>
                    </div>
                    <div className={styles.workerJobMetaRow}>
                      <span>Duration {formatDurationMs(job.durationMs)}</span>
                      <span>To worker {formatBytes(job.bytesDownloaded)}</span>
                      <span>From worker {formatBytes(job.bytesUploaded)}</span>
                    </div>
                    {job.status === 'failed' && job.error && (
                      <p className={styles.workerJobError} title={job.error}>
                        {job.error}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className={styles.label} data-settings-label="Worker WebSocket path">
            WebSocket path
            <div className={styles.callbackUrlRow}>
              <input
                type="text"
                className={styles.input}
                style={{ flex: 1, minWidth: 0 }}
                value={form.workersWsPath}
                onChange={(e) => onFormChange({ workersWsPath: e.target.value })}
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.callbackUrlCopyBtn}
                onClick={() => void copy(form.workersWsPath, 'path')}
                aria-label="Copy path"
              >
                {pathCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </label>

          {wsUrl && (
            <div className={styles.callbackUrlCard}>
              <div className={styles.callbackUrlLabel}>Worker connection URL</div>
              <div className={styles.callbackUrlRow}>
                <code className={styles.callbackUrlValue}>{wsUrl}</code>
                <button
                  type="button"
                  className={styles.callbackUrlCopyBtn}
                  onClick={() => void copy(wsUrl, 'ws')}
                  aria-label="Copy WebSocket URL"
                >
                  {wsCopied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          )}

          <label className={styles.label} data-settings-label="Worker shared secret">
            Shared secret
            <div className={styles.callbackUrlRow}>
              <input
                type="text"
                className={styles.input}
                style={{ flex: 1, minWidth: 0 }}
                value={form.workersSharedSecret}
                onChange={(e) =>
                  onFormChange({ workersSharedSecret: e.target.value })
                }
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.callbackUrlCopyBtn}
                onClick={() => void copy(form.workersSharedSecret, 'secret')}
                aria-label="Copy secret"
              >
                {secretCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </label>

          <button
            type="button"
            className={styles.submit}
            style={{ marginTop: '0.75rem' }}
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            aria-label="Regenerate worker path and secret"
          >
            <RefreshCw size={14} aria-hidden style={{ marginRight: 6 }} />
            {regenerateMutation.isPending
              ? 'Regenerating...'
              : 'Regenerate path and secret'}
          </button>
          <p className={styles.inputHelp}>
            Regenerating saves new credentials immediately and disconnects all
            connected workers.
          </p>
          {regenerateMutation.isError && (
            <p className={styles.inputHelp} role="alert">
              {regenerateMutation.error instanceof Error
                ? regenerateMutation.error.message
                : 'Failed to regenerate credentials'}
            </p>
          )}

          <label className={styles.label} data-settings-label="Dispatch attempts">
            Dispatch attempts
            <input
              type="number"
              className={styles.input}
              min={1}
              max={30}
              value={form.workersDispatchAttempts}
              onChange={(e) =>
                onFormChange({
                  workersDispatchAttempts: Math.max(
                    1,
                    Math.min(30, Number(e.target.value) || 3),
                  ),
                })
              }
            />
          </label>
          <p className={styles.inputHelp}>
            How many times to wait for an idle worker before giving up (default 3).
          </p>

          <label
            className={styles.label}
            data-settings-label="Wait between attempts"
          >
            Wait between attempts (seconds)
            <input
              type="number"
              className={styles.input}
              min={1}
              max={3600}
              value={form.workersDispatchRetrySec}
              onChange={(e) =>
                onFormChange({
                  workersDispatchRetrySec: Math.max(
                    1,
                    Math.min(3600, Number(e.target.value) || 60),
                  ),
                })
              }
            />
          </label>

          <label
            className="toggle"
            data-settings-label="Fall back to this server"
            style={{ marginTop: '1rem' }}
          >
            <input
              type="checkbox"
              checked={Boolean(form.workersFallbackLocal)}
              onChange={(e) =>
                onFormChange({ workersFallbackLocal: e.target.checked })
              }
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Fall back to this server if no worker accepts</span>
          </label>

          <p className={styles.inputHelp}>
            Configure the worker with HARBORFM_URL, WORKER_WS_PATH, and WORKER_SECRET.
          </p>
        </>
      )}
    </SectionCard>
  );
}
