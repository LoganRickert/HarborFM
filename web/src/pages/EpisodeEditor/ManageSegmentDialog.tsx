import { useEffect, useRef, useState } from 'react';
import {
  Clapperboard,
  Download,
  FileUp,
  FolderInput,
  FolderDown,
  Upload,
  Trash2,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { PleaseWaitDialog } from '../../components/PleaseWaitDialog';
import {
  downloadSegmentMp3Url,
  downloadSegmentProjectUrl,
  getSegmentHostDuckingStatus,
  getSegmentOtioImportStatus,
  getSegmentProjectExportStatus,
  getSegmentProjectImportStatus,
  getSegmentReaperImportStatus,
  importSegmentMp3,
  startImportSegmentOtio,
  startImportSegmentProject,
  startImportSegmentReaper,
  startSegmentHostDucking,
  startSegmentProjectExport,
  updateSegment,
  type EpisodeSegment,
} from '../../api/segments';
import { downloadAuthenticatedBlob, pollUntil } from '../../utils/projectZipTransfer';
import styles from '../EpisodeEditor.module.css';

export interface ManageSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  segment: EpisodeSegment | null;
  readOnly?: boolean;
  onImported: () => void;
  onDeleteRequest: () => void;
  isDeleting: boolean;
}

type WaitKind =
  | 'export'
  | 'download-mp3'
  | 'import'
  | 'import-mp3'
  | 'reaper'
  | 'otio'
  | 'update'
  | null;

export function ManageSegmentDialog({
  open,
  onOpenChange,
  episodeId,
  segment,
  readOnly = false,
  onImported,
  onDeleteRequest,
  isDeleting,
}: ManageSegmentDialogProps) {
  const zipInputRef = useRef<HTMLInputElement>(null);
  const mp3InputRef = useRef<HTMLInputElement>(null);
  const rppInputRef = useRef<HTMLInputElement>(null);
  const otioInputRef = useRef<HTMLInputElement>(null);
  const [waitKind, setWaitKind] = useState<WaitKind>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  const [waitWarning, setWaitWarning] = useState<string | null>(null);
  const [importPhase, setImportPhase] = useState<'validating' | 'uploading' | 'importing'>(
    'validating',
  );
  const [duckingBusy, setDuckingBusy] = useState(false);
  const duckingGenRef = useRef(0);
  const duckingBusyRef = useRef(false);
  const busy = (waitKind != null && !waitError && !waitWarning) || duckingBusy;
  const duckingInProgressTitle = 'Host ducking update in progress';

  const hasAudio = Boolean(
    segment &&
      ((segment.type === 'recorded' && segment.audioPath) ||
        (segment.type === 'reusable' && segment.reusableAssetId) ||
        (segment.durationSec ?? 0) > 0),
  );
  const canProject = hasAudio;
  const duckingEnabled = Boolean(segment?.hostDuckingEnabled);
  const loudnessTargetingEnabled = segment?.loudnessTargetingEnabled !== false;
  const showLoudnessTargeting = Boolean(hasAudio) && !readOnly;
  const showHostDucking = Boolean(segment?.hasRecordings) && !readOnly;

  const FINAL_GAIN_DB_MIN = -24;
  const FINAL_GAIN_DB_MAX = 6;
  const FINAL_GAIN_DB_STEP = 0.5;

  function clampFinalGainDb(v: number): number {
    const stepped = Math.round(v / FINAL_GAIN_DB_STEP) * FINAL_GAIN_DB_STEP;
    return Math.min(FINAL_GAIN_DB_MAX, Math.max(FINAL_GAIN_DB_MIN, stepped));
  }

  const segmentFinalGainDb = clampFinalGainDb(
    typeof segment?.finalGainDb === 'number' && Number.isFinite(segment.finalGainDb)
      ? segment.finalGainDb
      : 0,
  );
  const [finalGainDraftDb, setFinalGainDraftDb] = useState(segmentFinalGainDb);
  const finalGainSavingRef = useRef(false);

  useEffect(() => {
    setFinalGainDraftDb(segmentFinalGainDb);
  }, [segment?.id, segmentFinalGainDb]);

  async function runHostDuckingJob(
    segmentId: string,
    start?: () => Promise<void>,
  ): Promise<void> {
    if (duckingBusyRef.current) return;
    duckingBusyRef.current = true;
    const gen = ++duckingGenRef.current;
    setDuckingBusy(true);
    setWaitError(null);
    try {
      if (start) await start();
      await pollUntil(() => getSegmentHostDuckingStatus(episodeId, segmentId), {
        pendingStatuses: ['remaking'],
        successStatuses: ['done', 'idle'],
      });
      if (duckingGenRef.current === gen) onImported();
    } catch (err) {
      if (duckingGenRef.current === gen) {
        setWaitError(err instanceof Error ? err.message : 'Failed to update host ducking');
        setWaitKind('import');
      }
    } finally {
      if (duckingGenRef.current === gen) {
        duckingBusyRef.current = false;
        setDuckingBusy(false);
      }
    }
  }

  // If a remake is already running when the dialog opens, lock the toggle and wait.
  useEffect(() => {
    if (!open || !segment || !showHostDucking) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await getSegmentHostDuckingStatus(episodeId, segment.id);
        if (cancelled || status.status !== 'remaking') return;
        await runHostDuckingJob(segment.id);
      } catch {
        // runHostDuckingJob surfaces errors via Please wait
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- probe once per open/segment
  }, [open, segment?.id, episodeId, showHostDucking]);

  function dismissWait() {
    const hadWarning = Boolean(waitWarning);
    setWaitKind(null);
    setWaitError(null);
    setWaitWarning(null);
    if (hadWarning) {
      onImported();
      onOpenChange(false);
    }
  }

  async function handleDownloadMp3() {
    if (!segment || busy || readOnly) return;
    setWaitError(null);
    setWaitKind('download-mp3');
    try {
      await downloadAuthenticatedBlob(
        downloadSegmentMp3Url(episodeId, segment.id),
        'segment.mp3',
      );
      dismissWait();
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Failed to download MP3');
    }
  }

  async function handleDownloadSegment() {
    if (!segment || busy || readOnly) return;
    setWaitError(null);
    setWaitKind('export');
    try {
      await startSegmentProjectExport(episodeId, segment.id);
      await pollUntil(() => getSegmentProjectExportStatus(episodeId, segment.id), {
        pendingStatuses: ['building'],
        successStatuses: ['ready', 'idle'],
      });
      await downloadAuthenticatedBlob(
        downloadSegmentProjectUrl(episodeId, segment.id),
        'segment-project.zip',
      );
      dismissWait();
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Failed to prepare download');
    }
  }

  async function handleImportZip(file: File | undefined) {
    if (!segment || !file || busy || readOnly) return;
    setWaitError(null);
    setWaitWarning(null);
    setImportPhase('validating');
    setWaitKind('import');
    try {
      await startImportSegmentProject(episodeId, segment.id, file, {
        onPhase: setImportPhase,
      });
      setImportPhase('importing');
      const result = await pollUntil(
        () => getSegmentProjectImportStatus(episodeId, segment.id),
        {
          pendingStatuses: ['importing'],
          successStatuses: ['done'],
        },
      );
      if (result.status !== 'done') {
        throw new Error('Import finished unexpectedly');
      }
      if (result.warning) {
        setWaitWarning(result.warning);
        return;
      }
      setWaitKind(null);
      onImported();
      onOpenChange(false);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  }

  async function handleImportMp3(file: File | undefined) {
    if (!segment || !file || busy || readOnly) return;
    setWaitError(null);
    setWaitWarning(null);
    setWaitKind('import-mp3');
    try {
      await importSegmentMp3(episodeId, segment.id, file);
      setWaitKind(null);
      onImported();
      onOpenChange(false);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (mp3InputRef.current) mp3InputRef.current.value = '';
    }
  }

  async function handleImportReaper(file: File | undefined) {
    if (!segment || !file || busy || readOnly) return;
    setWaitError(null);
    setWaitWarning(null);
    setWaitKind('reaper');
    try {
      await startImportSegmentReaper(episodeId, segment.id, file);
      const result = await pollUntil(
        () => getSegmentReaperImportStatus(episodeId, segment.id),
        {
          pendingStatuses: ['importing'],
          successStatuses: ['done'],
        },
      );
      if (result.status !== 'done') {
        throw new Error('Import finished unexpectedly');
      }
      setWaitKind(null);
      onImported();
      onOpenChange(false);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (rppInputRef.current) rppInputRef.current.value = '';
    }
  }

  async function handleImportOtio(file: File | undefined) {
    if (!segment || !file || busy || readOnly) return;
    setWaitError(null);
    setWaitWarning(null);
    setWaitKind('otio');
    try {
      await startImportSegmentOtio(episodeId, segment.id, file);
      const result = await pollUntil(
        () => getSegmentOtioImportStatus(episodeId, segment.id),
        {
          pendingStatuses: ['importing'],
          successStatuses: ['done'],
        },
      );
      if (result.status !== 'done') {
        throw new Error('Import finished unexpectedly');
      }
      setWaitKind(null);
      onImported();
      onOpenChange(false);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (otioInputRef.current) otioInputRef.current.value = '';
    }
  }

  async function handleHostDuckingToggle(enabled: boolean) {
    if (!segment || busy || readOnly) return;
    if (Boolean(segment.hostDuckingEnabled) === enabled) return;
    await runHostDuckingJob(segment.id, () =>
      startSegmentHostDucking(episodeId, segment.id, enabled),
    );
  }

  async function handleLoudnessTargetingToggle(enabled: boolean) {
    if (!segment || busy || readOnly) return;
    if ((segment.loudnessTargetingEnabled !== false) === enabled) return;
    setWaitError(null);
    try {
      await updateSegment(episodeId, segment.id, {
        loudnessTargetingEnabled: enabled,
      });
      onImported();
    } catch (err) {
      setWaitError(
        err instanceof Error ? err.message : 'Failed to update loudness targeting',
      );
      setWaitKind('update');
    }
  }

  async function commitFinalGainDb(nextDb: number) {
    if (!segment || busy || readOnly || finalGainSavingRef.current) return;
    const clamped = clampFinalGainDb(nextDb);
    setFinalGainDraftDb(clamped);
    if (clamped === segmentFinalGainDb) return;
    finalGainSavingRef.current = true;
    setWaitError(null);
    try {
      await updateSegment(episodeId, segment.id, { finalGainDb: clamped });
      onImported();
    } catch (err) {
      setFinalGainDraftDb(segmentFinalGainDb);
      setWaitError(
        err instanceof Error ? err.message : 'Failed to update final gain',
      );
      setWaitKind('update');
    } finally {
      finalGainSavingRef.current = false;
    }
  }

  function formatFinalGainDb(db: number): string {
    const rounded = Math.round(db * 10) / 10;
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded.toFixed(1)} dB`;
  }

  const waitDescription = duckingBusy
    ? 'Updating host ducking...'
    : waitKind === 'reaper'
      ? 'Importing Reaper project...'
      : waitKind === 'otio'
        ? 'Importing OTIO timeline...'
        : waitKind === 'import-mp3'
          ? 'Importing final mix...'
          : waitKind === 'import'
            ? importPhase === 'validating'
              ? 'Validating zip...'
              : importPhase === 'uploading'
                ? 'Uploading...'
                : 'Importing segment...'
            : waitKind === 'download-mp3'
              ? 'Preparing MP3...'
              : 'Preparing your download...';
  const waitErrorTitle =
    waitKind === 'export' || waitKind === 'download-mp3'
      ? 'Download failed'
      : waitKind === 'update'
        ? 'Update failed'
        : 'Import Failed';

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            if (busy) return;
            dismissWait();
            onOpenChange(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentScrollable}`}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Manage Segment</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.dialogClose}
                  aria-label="Close"
                  disabled={busy}
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <div className={styles.dialogBodyScroll}>
            <Dialog.Description className={styles.srOnly}>
              Download or import segment audio, manage tracks, or delete this section.
            </Dialog.Description>

            <div className={styles.manageSegmentActions}>
              <button
                type="button"
                className={styles.manageSegmentAction}
                disabled={!hasAudio || readOnly || busy}
                onClick={() => void handleDownloadMp3()}
                title={
                  readOnly
                    ? 'Read-only account'
                    : !hasAudio
                      ? 'No audio to download'
                      : undefined
                }
              >
                <Download size={18} aria-hidden />
                <span>Download MP3</span>
                <span className={styles.manageSegmentActionHint}>Trimmed final mix</span>
              </button>

              <button
                type="button"
                className={styles.manageSegmentAction}
                disabled={readOnly || busy}
                onClick={() => mp3InputRef.current?.click()}
                title={
                  readOnly
                    ? 'Read-only account'
                    : 'Replace the final mix (for example after enhancing externally)'
                }
              >
                <Upload size={18} aria-hidden />
                <span>Import MP3</span>
                <span className={styles.manageSegmentActionHint}>
                  Replace final mix
                </span>
              </button>
              <input
                ref={mp3InputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
                hidden
                onChange={(e) => void handleImportMp3(e.target.files?.[0])}
              />

              <button
                type="button"
                className={styles.manageSegmentAction}
                disabled={readOnly || busy}
                onClick={() => zipInputRef.current?.click()}
                title={readOnly ? 'Read-only account' : undefined}
              >
                <FolderInput size={18} aria-hidden />
                <span>Import Segment</span>
                <span className={styles.manageSegmentActionHint}>Overwrite this segment</span>
              </button>
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => void handleImportZip(e.target.files?.[0])}
              />

              <button
                type="button"
                className={styles.manageSegmentAction}
                disabled={readOnly || busy || !hasAudio}
                onClick={() => rppInputRef.current?.click()}
                title={
                  readOnly
                    ? 'Read-only account'
                    : !hasAudio
                      ? 'No audio to apply a Reaper project to'
                      : undefined
                }
              >
                <FileUp size={18} aria-hidden />
                <span>Import Reaper</span>
                <span className={styles.manageSegmentActionHint}>
                  Apply segment.rpp to existing tracks
                </span>
              </button>
              <input
                ref={rppInputRef}
                type="file"
                accept=".rpp,application/octet-stream"
                hidden
                onChange={(e) => void handleImportReaper(e.target.files?.[0])}
              />

              <button
                type="button"
                className={styles.manageSegmentAction}
                disabled={readOnly || busy || !hasAudio}
                onClick={() => otioInputRef.current?.click()}
                title={
                  readOnly
                    ? 'Read-only account'
                    : !hasAudio
                      ? 'No audio to apply a timeline to'
                      : undefined
                }
              >
                <Clapperboard size={18} aria-hidden />
                <span>Import OTIO</span>
                <span className={styles.manageSegmentActionHint}>
                  Apply timeline.otio to existing tracks
                </span>
              </button>
              <input
                ref={otioInputRef}
                type="file"
                accept=".otio,application/json,application/octet-stream"
                hidden
                onChange={(e) => void handleImportOtio(e.target.files?.[0])}
              />

              {canProject && !readOnly ? (
                <button
                  type="button"
                  className={styles.manageSegmentAction}
                  disabled={busy}
                  onClick={() => void handleDownloadSegment()}
                >
                  <FolderDown size={18} aria-hidden />
                  <span>Download Segment</span>
                  <span className={styles.manageSegmentActionHint}>
                    Source audio, tracks, and metadata
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.manageSegmentAction}
                  disabled
                  title={readOnly ? 'Read-only account' : 'No segment to download'}
                >
                  <FolderDown size={18} aria-hidden />
                  <span>Download Segment</span>
                  <span className={styles.manageSegmentActionHint}>
                    Source audio, tracks, and metadata
                  </span>
                </button>
              )}

              {showLoudnessTargeting ? (
                <div
                  className={styles.hostDuckingSetting}
                  title="When building the final episode. Ignored if loudness target is 0 in Settings."
                >
                  <span className={styles.hostDuckingSettingLabel}>
                    Loudness Targeting
                  </span>
                  <span className={styles.manageSegmentActionHint}>
                    Opt out for music or beds so final loudness does not reshape them
                  </span>
                  <div
                    className={styles.hostDuckingSegmented}
                    role="group"
                    aria-label="Loudness Targeting"
                  >
                    <button
                      type="button"
                      className={
                        !loudnessTargetingEnabled
                          ? styles.hostDuckingSegmentedActive
                          : styles.hostDuckingSegmentedBtn
                      }
                      aria-pressed={!loudnessTargetingEnabled}
                      disabled={busy}
                      onClick={() => void handleLoudnessTargetingToggle(false)}
                    >
                      Disabled
                    </button>
                    <button
                      type="button"
                      className={
                        loudnessTargetingEnabled
                          ? styles.hostDuckingSegmentedActive
                          : styles.hostDuckingSegmentedBtn
                      }
                      aria-pressed={loudnessTargetingEnabled}
                      disabled={busy}
                      onClick={() => void handleLoudnessTargetingToggle(true)}
                    >
                      Enabled
                    </button>
                  </div>
                  {!loudnessTargetingEnabled ? (
                    <div className={styles.finalGainSetting}>
                      <div className={styles.finalGainSettingHead}>
                        <span className={styles.finalGainSettingLabel}>
                          Final Gain
                        </span>
                        <span className={styles.finalGainSettingValue}>
                          {formatFinalGainDb(finalGainDraftDb)}
                        </span>
                      </div>
                      <input
                        type="range"
                        className={styles.finalGainSlider}
                        min={FINAL_GAIN_DB_MIN}
                        max={FINAL_GAIN_DB_MAX}
                        step={FINAL_GAIN_DB_STEP}
                        value={finalGainDraftDb}
                        disabled={busy}
                        aria-label="Final Gain"
                        onChange={(e) =>
                          setFinalGainDraftDb(Number(e.target.value))
                        }
                        onPointerUp={(e) =>
                          void commitFinalGainDb(Number(e.currentTarget.value))
                        }
                        onKeyUp={(e) =>
                          void commitFinalGainDb(Number(e.currentTarget.value))
                        }
                        onBlur={(e) =>
                          void commitFinalGainDb(Number(e.currentTarget.value))
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showHostDucking ? (
                <div
                  className={styles.hostDuckingSetting}
                  title={duckingBusy ? duckingInProgressTitle : undefined}
                >
                  <span className={styles.hostDuckingSettingLabel}>Host Ducking</span>
                  <div
                    className={styles.hostDuckingSegmented}
                    role="group"
                    aria-label="Host Ducking"
                    aria-busy={duckingBusy}
                  >
                    <button
                      type="button"
                      className={
                        !duckingEnabled
                          ? styles.hostDuckingSegmentedActive
                          : styles.hostDuckingSegmentedBtn
                      }
                      aria-pressed={!duckingEnabled}
                      disabled={busy}
                      title={duckingBusy ? duckingInProgressTitle : undefined}
                      onClick={() => handleHostDuckingToggle(false)}
                    >
                      Disabled
                    </button>
                    <button
                      type="button"
                      className={
                        duckingEnabled
                          ? styles.hostDuckingSegmentedActive
                          : styles.hostDuckingSegmentedBtn
                      }
                      aria-pressed={duckingEnabled}
                      disabled={busy}
                      title={duckingBusy ? duckingInProgressTitle : undefined}
                      onClick={() => handleHostDuckingToggle(true)}
                    >
                      Enabled
                    </button>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className={`${styles.manageSegmentAction} ${styles.manageSegmentActionDanger}`}
                disabled={readOnly || isDeleting || busy}
                onClick={() => {
                  onOpenChange(false);
                  onDeleteRequest();
                }}
                title={readOnly ? 'Read-only account' : undefined}
              >
                <Trash2 size={18} aria-hidden />
                <span>Delete</span>
                <span className={styles.manageSegmentActionHint}>Remove this section</span>
              </button>
            </div>
            </div>

            <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.cancel}
                  aria-label="Close manage segment"
                  disabled={busy}
                >
                  Close
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <PleaseWaitDialog
        open={waitKind != null || duckingBusy}
        title="Please wait"
        description={waitDescription}
        error={waitError}
        errorTitle={waitErrorTitle}
        warning={waitWarning}
        warningTitle="Import finished"
        onDismiss={dismissWait}
      />
    </>
  );
}
