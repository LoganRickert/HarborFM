import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { CancelWorkerJobConfirmDialog } from './CancelWorkerJobConfirmDialog';
import {
  cancelWorkerJob,
  fetchWorkerJobStats,
  regenerateWorkerSecrets,
  type WorkerJobStat,
} from '../../api/settings';
import { apiGet } from '../../api/client';
import { formatBytes, formatDurationMs } from '../../utils/format';
import styles from '../../pages/Settings.module.css';

type WorkerStatusCurrentJob = {
  id: string;
  kind: string;
  startedAt: string | null;
  podcastId: string | null;
  episodeId: string | null;
  segmentId: string | null;
  podcastTitle: string | null;
  episodeTitle: string | null;
};

type WorkerStatusEntry = {
  id: string;
  name: string;
  state: string;
  remoteIp: string | null;
  connectedAt: string;
  lastSeenAt: string;
  currentJob: WorkerStatusCurrentJob | null;
  lastJob: {
    kind: string | null;
    status: string | null;
    finishedAt: string | null;
  } | null;
};

type WorkersStatus = {
  connected: number;
  idle: number;
  busy: number;
  workers: WorkerStatusEntry[];
};

function kindLabel(kind: string): string {
  if (kind === 'video_generate') return 'Video';
  if (kind === 'transcribe') return 'Transcribe';
  if (kind === 'episode_render') return 'Final episode';
  if (kind === 'segment_remake') return 'Multi-track segment';
  return kind;
}

function formatFinishedAt(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatRelativeAgo(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return formatFinishedAt(iso);
}

type AvgMaxPair = { avg: string | null; max: string | null };

function formatPct(n: number): string {
  return `${Number.isInteger(n) ? String(n) : n.toFixed(1)}%`;
}

function formatAvgMaxPct(
  avg: number | null | undefined,
  peak: number | null | undefined,
): AvgMaxPair | null {
  if (avg == null && peak == null) return null;
  return {
    avg: avg != null ? formatPct(avg) : null,
    max: peak != null ? formatPct(peak) : null,
  };
}

function formatAvgMaxBytes(
  avg: number | null | undefined,
  peak: number | null | undefined,
): AvgMaxPair | null {
  if (avg == null && peak == null) return null;
  return {
    avg: avg != null ? formatBytes(avg) : null,
    max: peak != null ? formatBytes(peak) : null,
  };
}

function AvgMaxValue({ pair }: { pair: AvgMaxPair }) {
  return (
    <span className={styles.workerJobAvgMax}>
      {pair.avg ? (
        <span className={styles.workerJobAvgMaxReading}>
          <span className={styles.workerJobFeedMetricValue}>{pair.avg}</span>
          <span className={styles.workerJobAvgMaxHint}>avg</span>
        </span>
      ) : null}
      {pair.max ? (
        <span className={styles.workerJobAvgMaxReading}>
          <span className={styles.workerJobFeedMetricValue}>{pair.max}</span>
          <span className={styles.workerJobAvgMaxHint}>max</span>
        </span>
      ) : null}
    </span>
  );
}

function formatJobUser(job: {
  userUsername: string | null;
  userEmail: string | null;
}): { label: string; title: string } | null {
  const username = job.userUsername?.trim() || null;
  const email = job.userEmail?.trim() || null;
  const autoUsername = Boolean(username && /^user_[A-Za-z0-9_-]+$/.test(username));
  if (email && (!username || autoUsername)) {
    return { label: email, title: username ? `${username} (${email})` : email };
  }
  if (username && email) {
    return { label: username, title: `${username} (${email})` };
  }
  const label = username || email;
  return label ? { label, title: label } : null;
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
  const [jobsRefreshing, setJobsRefreshing] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{
    jobId: string;
    workerName: string;
    jobLabel: string;
  } | null>(null);

  const { data: status, isFetching: statusFetching } = useQuery({
    queryKey: ['settings', 'workers-status'],
    queryFn: () => apiGet<WorkersStatus>('/settings/workers-status'),
    enabled: form.workersEnabled,
    refetchInterval: form.workersEnabled ? 5000 : false,
  });

  const { data: jobStats, isFetching: jobStatsFetching } = useQuery({
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

  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => cancelWorkerJob(jobId),
    onSuccess: () => {
      setCancelTarget(null);
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

  const refreshWorkers = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'workers-status'] });
  };

  const refreshJobs = async () => {
    setJobsRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: ['settings', 'workers-job-stats'],
      });
      await queryClient.refetchQueries({
        queryKey: ['settings', 'workers-job-stats'],
      });
    } finally {
      setJobsRefreshing(false);
    }
  };

  const workers = status?.workers ?? [];

  return (
    <SectionCard
      title="Compute Workers"
      subtitle="Offload video generation, self-hosted Whisper transcription, Build Final Episode, and Build Multi-Track Segment to one or more worker machines. Workers connect over a secret WebSocket path."
    >
      <CancelWorkerJobConfirmDialog
        open={cancelTarget != null}
        workerName={cancelTarget?.workerName ?? 'this worker'}
        jobLabel={cancelTarget?.jobLabel ?? 'current'}
        pending={cancelJobMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !cancelJobMutation.isPending) setCancelTarget(null);
        }}
        onConfirm={() => {
          if (cancelTarget) cancelJobMutation.mutate(cancelTarget.jobId);
        }}
      />
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
          <div className={styles.workerListBlock}>
            <div className={styles.workerJobStatsHeadingRow}>
              <div className={styles.workerJobStatsHeading}>Connected workers</div>
              <button
                type="button"
                className={styles.workerRefreshBtn}
                onClick={refreshWorkers}
                disabled={statusFetching}
                aria-label="Refresh connected workers"
                title="Refresh"
              >
                <RefreshCw
                  size={14}
                  className={statusFetching ? styles.workerRefreshBtnSpinning : undefined}
                  aria-hidden
                />
              </button>
            </div>
            <p className={`${styles.inputHelp} ${styles.workerListSummary}`}>
              Connected: {status?.connected ?? 0} (idle {status?.idle ?? 0}, busy{' '}
              {status?.busy ?? 0})
            </p>
            {workers.length === 0 ? (
              <p className={styles.inputHelp}>No workers connected.</p>
            ) : (
              <ul className={styles.workerJobFeed}>
                {workers.map((w) => {
                  const busy = w.state === 'busy';
                  const showLabel = w.currentJob?.podcastTitle?.trim() || null;
                  const episodeLabel =
                    w.currentJob?.episodeTitle?.trim() ||
                    (w.currentJob?.episodeId
                      ? `Episode ${w.currentJob.episodeId.slice(0, 8)}`
                      : null);
                  const podcastHref = w.currentJob?.podcastId
                    ? `/podcasts/${w.currentJob.podcastId}`
                    : null;
                  const episodeHref = w.currentJob?.episodeId
                    ? `/episodes/${w.currentJob.episodeId}`
                    : null;
                  const lastJobLabel = w.lastJob?.finishedAt
                    ? `${w.lastJob.kind ? kindLabel(w.lastJob.kind) : 'Job'} ${formatRelativeAgo(w.lastJob.finishedAt)}`
                    : null;

                  return (
                    <li key={w.id} className={styles.workerJobFeedItem}>
                      <span
                        className={
                          busy ? styles.workerJobDotBusy : styles.workerJobDotOk
                        }
                        aria-hidden
                      />
                      <div className={styles.workerJobFeedBody}>
                        <div className={styles.workerListItemTop}>
                          <div className={styles.workerJobFeedTitle}>
                            <span className={styles.workerJobFeedKind}>
                              {w.name?.trim() || 'Unnamed worker'}
                            </span>
                            <span className={styles.workerJobFeedStatus}>
                              {busy ? 'Busy' : 'Idle'}
                            </span>
                            {w.currentJob ? (
                              <span className={styles.workerJobFeedStatus}>
                                {kindLabel(w.currentJob.kind)}
                              </span>
                            ) : null}
                          </div>
                          {w.currentJob ? (
                            <button
                              type="button"
                              className={styles.workerCancelBtn}
                              onClick={() => {
                                cancelJobMutation.reset();
                                setCancelTarget({
                                  jobId: w.currentJob!.id,
                                  workerName: w.name?.trim() || 'Unnamed worker',
                                  jobLabel: kindLabel(w.currentJob!.kind),
                                });
                              }}
                              disabled={
                                cancelJobMutation.isPending &&
                                cancelTarget?.jobId === w.currentJob.id
                              }
                              aria-label={`Cancel job on ${w.name?.trim() || 'worker'}`}
                            >
                              Cancel job
                            </button>
                          ) : null}
                        </div>
                        {w.currentJob ? (
                          <>
                            {(episodeLabel || showLabel) && (
                              <div className={styles.workerJobFeedSubject}>
                                {episodeLabel ? (
                                  episodeHref ? (
                                    <Link
                                      to={episodeHref}
                                      className={styles.link}
                                    >
                                      {episodeLabel}
                                    </Link>
                                  ) : (
                                    <span>{episodeLabel}</span>
                                  )
                                ) : null}
                                {showLabel ? (
                                  podcastHref ? (
                                    <Link
                                      to={podcastHref}
                                      className={`${styles.link} ${styles.workerJobShowLink}`}
                                    >
                                      {showLabel}
                                    </Link>
                                  ) : (
                                    <span className={styles.workerJobShowLink}>
                                      {showLabel}
                                    </span>
                                  )
                                ) : null}
                              </div>
                            )}
                            {w.currentJob.startedAt ? (
                              <div className={styles.workerJobFeedContext}>
                                Started {formatRelativeAgo(w.currentJob.startedAt)}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        <div className={styles.workerJobFeedMetrics}>
                          <span className={styles.workerJobFeedMetric}>
                            <span className={styles.workerJobFeedMetricLabel}>
                              IP
                            </span>
                            <span className={styles.workerJobFeedMetricValue}>
                              {w.remoteIp?.trim() || '-'}
                            </span>
                          </span>
                          <span className={styles.workerJobFeedMetric}>
                            <span className={styles.workerJobFeedMetricLabel}>
                              Connected
                            </span>
                            <span className={styles.workerJobFeedMetricValue}>
                              {formatRelativeAgo(w.connectedAt)}
                            </span>
                          </span>
                          <span className={styles.workerJobFeedMetric}>
                            <span className={styles.workerJobFeedMetricLabel}>
                              Last seen
                            </span>
                            <span className={styles.workerJobFeedMetricValue}>
                              {formatRelativeAgo(w.lastSeenAt)}
                            </span>
                          </span>
                          {lastJobLabel ? (
                            <span className={styles.workerJobFeedMetric}>
                              <span className={styles.workerJobFeedMetricLabel}>
                                Last job
                              </span>
                              <span className={styles.workerJobFeedMetricValue}>
                                {lastJobLabel}
                              </span>
                            </span>
                          ) : null}
                        </div>
                        {cancelJobMutation.isError &&
                        cancelTarget?.jobId === w.currentJob?.id ? (
                          <p className={styles.inputHelp} role="alert">
                            {cancelJobMutation.error instanceof Error
                              ? cancelJobMutation.error.message
                              : 'Failed to cancel job'}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={styles.workerJobStatsHeading} style={{ marginTop: '0.75rem' }}>
            Offload to workers
          </div>
          <label
            className="toggle"
            data-settings-label="Offload transcripts to workers"
          >
            <input
              type="checkbox"
              checked={form.workersUseForTranscripts !== false}
              onChange={(e) =>
                onFormChange({ workersUseForTranscripts: e.target.checked })
              }
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Transcripts</span>
          </label>
          <label
            className="toggle"
            data-settings-label="Offload videos to workers"
          >
            <input
              type="checkbox"
              checked={form.workersUseForVideos !== false}
              onChange={(e) =>
                onFormChange({ workersUseForVideos: e.target.checked })
              }
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Episode Videos</span>
          </label>
          <label
            className="toggle"
            data-settings-label="Offload final episodes to workers"
          >
            <input
              type="checkbox"
              checked={form.workersUseForFinalEpisodes !== false}
              onChange={(e) =>
                onFormChange({ workersUseForFinalEpisodes: e.target.checked })
              }
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Build Final Episode</span>
          </label>
          <label
            className="toggle"
            data-settings-label="Offload multi-track segment builds to workers"
          >
            <input
              type="checkbox"
              checked={form.workersUseForSegmentRemakes !== false}
              onChange={(e) =>
                onFormChange({ workersUseForSegmentRemakes: e.target.checked })
              }
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Build Multi-Track Segment</span>
          </label>

          <div className={styles.workerJobStatsBlock}>
            <div className={styles.workerJobStatsHeadingRow}>
              <div className={styles.workerJobStatsHeading}>Recent jobs</div>
              <button
                type="button"
                className={styles.workerRefreshBtn}
                onClick={() => void refreshJobs()}
                disabled={jobsRefreshing || jobStatsFetching}
                aria-label="Refresh recent jobs"
                title="Refresh"
              >
                <RefreshCw
                  size={14}
                  className={
                    jobsRefreshing || jobStatsFetching
                      ? styles.workerRefreshBtnSpinning
                      : undefined
                  }
                  aria-hidden
                />
              </button>
            </div>
            {(jobStats?.jobs?.length ?? 0) === 0 ? (
              <p className={styles.inputHelp}>No worker jobs recorded yet.</p>
            ) : (
              <ul className={styles.workerJobFeed}>
                {(jobStats?.jobs ?? []).map((job: WorkerJobStat) => {
                  const ranBy = formatJobUser(job);
                  const whenIso = job.finishedAt || job.startedAt;
                  const ok = job.status === 'completed';
                  const failed = job.status === 'failed';
                  const statusLabel = ok
                    ? 'Completed'
                    : failed
                      ? 'Failed'
                      : job.status;
                  const showLabel = job.podcastTitle?.trim() || null;
                  const episodeLabel =
                    job.episodeTitle?.trim() ||
                    (job.episodeId
                      ? `Episode ${job.episodeId.slice(0, 8)}`
                      : null);
                  const podcastHref = job.podcastId
                    ? `/podcasts/${job.podcastId}`
                    : null;
                  const episodeHref = job.episodeId
                    ? `/episodes/${job.episodeId}`
                    : null;
                  const cpu = formatAvgMaxPct(
                    job.avgCpuPercent,
                    job.peakCpuPercent,
                  );
                  const mem = formatAvgMaxBytes(
                    job.avgMemoryBytes,
                    job.peakMemoryBytes,
                  );
                  const workerLabel = job.workerName?.trim() || 'Unknown worker';
                  const transferMetrics: Array<{
                    label: string;
                    value?: string;
                    pair?: AvgMaxPair;
                  }> = [
                    { label: 'Duration', value: formatDurationMs(job.durationMs) },
                    {
                      label: 'Download',
                      value: formatBytes(job.bytesDownloaded),
                    },
                    { label: 'Upload', value: formatBytes(job.bytesUploaded) },
                  ];
                  const resourceMetrics: Array<{
                    label: string;
                    pair: AvgMaxPair;
                  }> = [];
                  if (cpu) resourceMetrics.push({ label: 'CPU', pair: cpu });
                  if (mem) resourceMetrics.push({ label: 'Memory', pair: mem });

                  const renderMetric = (m: {
                    label: string;
                    value?: string;
                    pair?: AvgMaxPair;
                  }) => (
                    <span key={m.label} className={styles.workerJobFeedMetric}>
                      <span className={styles.workerJobFeedMetricLabel}>
                        {m.label}
                      </span>
                      {m.pair ? (
                        <AvgMaxValue pair={m.pair} />
                      ) : (
                        <span className={styles.workerJobFeedMetricValue}>
                          {m.value}
                        </span>
                      )}
                    </span>
                  );

                  return (
                    <li key={job.id} className={styles.workerJobFeedItem}>
                      <span
                        className={
                          ok
                            ? styles.workerJobDotOk
                            : styles.workerJobDotFail
                        }
                        aria-hidden
                      />
                      <div className={styles.workerJobFeedBody}>
                        <div className={styles.workerJobFeedTop}>
                          <div className={styles.workerJobFeedTitle}>
                            <span className={styles.workerJobFeedKind}>
                              {kindLabel(job.kind)}
                            </span>
                            <span className={styles.workerJobFeedStatus}>
                              {statusLabel}
                            </span>
                          </div>
                          <time
                            className={styles.workerJobWhen}
                            dateTime={whenIso || undefined}
                            title={formatFinishedAt(whenIso)}
                          >
                            {formatRelativeAgo(whenIso)}
                          </time>
                        </div>
                        {(episodeLabel || showLabel) && (
                          <div className={styles.workerJobFeedSubject}>
                            {episodeLabel ? (
                              episodeHref ? (
                                <Link
                                  to={episodeHref}
                                  className={styles.link}
                                >
                                  {episodeLabel}
                                </Link>
                              ) : (
                                <span>{episodeLabel}</span>
                              )
                            ) : null}
                            {showLabel ? (
                              podcastHref ? (
                                <Link
                                  to={podcastHref}
                                  className={`${styles.link} ${styles.workerJobShowLink}`}
                                >
                                  {showLabel}
                                </Link>
                              ) : (
                                <span className={styles.workerJobShowLink}>
                                  {showLabel}
                                </span>
                              )
                            ) : null}
                          </div>
                        )}
                        <div className={styles.workerJobFeedContext}>
                          <span>{workerLabel}</span>
                          {ranBy ? (
                            <span title={ranBy.title}>by {ranBy.label}</span>
                          ) : null}
                        </div>
                        <div className={styles.workerJobFeedMetrics}>
                          {transferMetrics.map(renderMetric)}
                        </div>
                        {resourceMetrics.length > 0 ? (
                          <div className={styles.workerJobFeedMetrics}>
                            {resourceMetrics.map(renderMetric)}
                          </div>
                        ) : null}
                        {failed && job.error ? (
                          <p className={styles.workerJobError} title={job.error}>
                            {job.error}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
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
