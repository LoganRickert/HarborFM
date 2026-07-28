import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, Sparkles, Trash2, VolumeX, X } from 'lucide-react';
import styles from '../../pages/EpisodeEditor.module.css';
import {
  COMP_THRESHOLD_DB_MAX,
  COMP_THRESHOLD_DB_MIN,
  DEFAULT_TRACK_SETTINGS,
  EQ_DB_MAX,
  EQ_DB_MIN,
  GATE_THRESHOLD_DB_MAX,
  GATE_THRESHOLD_DB_MIN,
  type TrackSettingsUi,
  VOLUME_DB_MAX,
  VOLUME_DB_MIN,
} from './trackFx';
import {
  suggestCompFromPeaks,
  suggestGateFromPeaks,
  suggestVolumeFromPeaks,
  MIN_AUTO_PEAKS,
} from './trackFxAnalyze';

export type TrackSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackName: string;
  settings: TrackSettingsUi;
  onChange: (next: TrackSettingsUi) => void;
  onBeforeFirstEdit: () => void;
  /** Remove every clip on this track (track scope) or this clip (clip scope). */
  onDeleteTrack: () => void;
  /** False when this is the only remaining track/clip (save requires clips). */
  canDeleteTrack?: boolean;
  /**
   * Normalized peak envelope for Auto FX.
   * Track scope: full take(s). Clip scope: this clip's source region.
   */
  lanePeaks?: number[] | null;
  readOnly?: boolean;
  /** Defaults to track-wide settings. Clip scope edits one timeline clip. */
  scope?: 'track' | 'clip';
  /**
   * Clip scope: clear override and restore track FX.
   * Track scope: omit to reset to factory defaults via onChange.
   */
  onReset?: () => void;
};

function formatDb(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1);
  return `${rounded > 0 ? '+' : ''}${text}`;
}

function formatMs(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type ParamRowProps = {
  label: string;
  value: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  current: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function ParamRow({
  label,
  value,
  unit,
  min,
  max,
  step,
  current,
  disabled,
  onChange,
}: ParamRowProps) {
  return (
    <label className={styles.trackSettingsParam}>
      <span className={styles.trackSettingsParamLabel}>{label}</span>
      <input
        type="range"
        className={styles.trackSettingsSlider}
        min={min}
        max={max}
        step={step}
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={styles.trackSettingsParamValue}>
        {value}
        {unit ? (
          <span className={styles.trackSettingsParamUnit}>{unit}</span>
        ) : null}
      </span>
    </label>
  );
}

export function TrackSettingsDialog({
  open,
  onOpenChange,
  trackName,
  settings,
  onChange,
  onBeforeFirstEdit,
  onDeleteTrack,
  canDeleteTrack = true,
  lanePeaks = null,
  readOnly = false,
  scope = 'track',
  onReset,
}: TrackSettingsDialogProps) {
  const editedRef = useRef(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [analyzeHint, setAnalyzeHint] = useState<string | null>(null);
  const isClip = scope === 'clip';
  const title = isClip ? 'Clip Settings' : 'Track Settings';
  const deleteLabel = isClip ? 'Delete Clip' : 'Delete Track';
  const deleteConfirmTitle = isClip ? 'Delete clip?' : 'Delete track?';
  const autoWaveformTitle = isClip
    ? 'Need a loaded waveform for this clip'
    : 'Need a loaded take waveform for this track';

  useEffect(() => {
    if (open) {
      editedRef.current = false;
      setDeleteConfirmOpen(false);
      setAnalyzeHint(null);
    }
  }, [open]);

  const canAnalyze = Boolean(lanePeaks && lanePeaks.length >= MIN_AUTO_PEAKS);

  const patch = (partial: Partial<TrackSettingsUi>) => {
    if (readOnly) return;
    if (!editedRef.current) {
      editedRef.current = true;
      onBeforeFirstEdit();
    }
    onChange({ ...settings, ...partial });
  };

  const patchEq = (key: keyof TrackSettingsUi['eq'], value: number) => {
    if (readOnly) return;
    if (!editedRef.current) {
      editedRef.current = true;
      onBeforeFirstEdit();
    }
    onChange({ ...settings, eq: { ...settings.eq, [key]: value } });
  };

  const resetAll = () => {
    if (readOnly) return;
    if (!editedRef.current) {
      editedRef.current = true;
      onBeforeFirstEdit();
    }
    setAnalyzeHint(null);
    if (onReset) {
      onReset();
      return;
    }
    onChange({ ...DEFAULT_TRACK_SETTINGS });
  };

  const applyAutoComp = () => {
    if (readOnly || !lanePeaks) return;
    const suggested = suggestCompFromPeaks(lanePeaks);
    if (!suggested) {
      setAnalyzeHint('Not enough waveform signal to suggest a compressor.');
      return;
    }
    setAnalyzeHint(null);
    patch(suggested);
  };

  const applyAutoGate = () => {
    if (readOnly || !lanePeaks) return;
    const suggested = suggestGateFromPeaks(lanePeaks);
    if (!suggested) {
      setAnalyzeHint('Not enough waveform signal to suggest a gate.');
      return;
    }
    setAnalyzeHint(null);
    patch(suggested);
  };

  const applyAutoVolume = () => {
    if (readOnly || !lanePeaks) return;
    const suggested = suggestVolumeFromPeaks(lanePeaks);
    if (!suggested) {
      setAnalyzeHint('Not enough waveform signal to suggest a volume.');
      return;
    }
    setAnalyzeHint(null);
    patch(suggested);
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay
            className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`}
          />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentOnModal} ${styles.trackSettingsDialog}`}
            onEscapeKeyDown={(e) => e.stopPropagation()}
            aria-describedby={undefined}
          >
            <div className={styles.trackSettingsHeader}>
              <div className={styles.trackSettingsHeaderText}>
                <Dialog.Title className={styles.trackSettingsTitle}>
                  {title}
                </Dialog.Title>
                <p className={styles.trackSettingsTrackName} title={trackName}>
                  {trackName}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.dialogClose}
                  aria-label="Close"
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>

            <div className={styles.trackSettingsBody}>
              <section className={styles.trackSettingsCard}>
                <div className={styles.trackSettingsCardHead}>
                  <h3 className={styles.trackSettingsSectionTitle}>Output</h3>
                  <div className={styles.trackSettingsCardActions}>
                    {!readOnly ? (
                      <button
                        type="button"
                        className={styles.trackSettingsAutoBtn}
                        onClick={applyAutoVolume}
                        disabled={!canAnalyze}
                        title={
                          canAnalyze
                            ? isClip
                              ? 'Set volume from this clip\'s waveform region (prefers 0 dB when already healthy)'
                              : 'Set volume from the full take waveform (prefers 0 dB when already healthy)'
                            : autoWaveformTitle
                        }
                      >
                        <Sparkles size={13} strokeWidth={2.25} aria-hidden />
                        Auto
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={
                        settings.muted
                          ? styles.trackSettingsMuteActive
                          : styles.trackSettingsMute
                      }
                      aria-pressed={settings.muted}
                      aria-label={settings.muted ? 'Unmute' : 'Mute'}
                      disabled={readOnly}
                      onClick={() => patch({ muted: !settings.muted })}
                    >
                      <VolumeX size={14} strokeWidth={2.25} aria-hidden />
                      Mute
                    </button>
                  </div>
                </div>
                <ParamRow
                  label="Volume"
                  value={formatDb(settings.volumeDb)}
                  unit="dB"
                  min={VOLUME_DB_MIN}
                  max={VOLUME_DB_MAX}
                  step={0.5}
                  current={settings.volumeDb}
                  disabled={readOnly || settings.muted}
                  onChange={(volumeDb) => patch({ volumeDb })}
                />
              </section>

              <section className={styles.trackSettingsCard}>
                <div className={styles.trackSettingsCardHead}>
                  <h3 className={styles.trackSettingsSectionTitle}>EQ</h3>
                </div>
                <div className={styles.trackSettingsEqGrid}>
                  {(
                    [
                      ['Low', 'lowDb', settings.eq.lowDb],
                      ['Mid', 'midDb', settings.eq.midDb],
                      ['High', 'highDb', settings.eq.highDb],
                    ] as const
                  ).map(([label, key, value]) => (
                    <label key={key} className={styles.trackSettingsEqBand}>
                      <span className={styles.trackSettingsEqValue}>
                        {formatDb(value)}
                      </span>
                      <input
                        type="range"
                        className={styles.trackSettingsEqSlider}
                        min={EQ_DB_MIN}
                        max={EQ_DB_MAX}
                        step={1}
                        value={value}
                        disabled={readOnly}
                        aria-label={`${label} EQ`}
                        onChange={(e) => patchEq(key, Number(e.target.value))}
                      />
                      <span className={styles.trackSettingsEqLabel}>{label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className={styles.trackSettingsCard}>
                <div className={styles.trackSettingsCardHead}>
                  <h3 className={styles.trackSettingsSectionTitle}>Compressor</h3>
                  <div className={styles.trackSettingsCardActions}>
                    {!readOnly ? (
                      <button
                        type="button"
                        className={styles.trackSettingsAutoBtn}
                        onClick={applyAutoComp}
                        disabled={!canAnalyze}
                        title={
                          canAnalyze
                            ? isClip
                              ? 'Guess compressor settings from this clip waveform'
                              : 'Guess compressor settings from this track waveform'
                            : isClip
                              ? 'Waveform not available for this clip yet'
                              : 'Waveform not available for this track yet'
                        }
                      >
                        <Sparkles size={13} strokeWidth={2.25} aria-hidden />
                        Auto
                      </button>
                    ) : null}
                    <label className={`toggle ${styles.trackSettingsSwitch}`}>
                      <input
                        type="checkbox"
                        checked={settings.compEnabled}
                        disabled={readOnly}
                        aria-label="Enable compressor"
                        onChange={(e) =>
                          patch({ compEnabled: e.target.checked })
                        }
                      />
                      <span className="toggle__track" aria-hidden="true" />
                      <span>{settings.compEnabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                </div>
                {settings.compEnabled ? (
                  <div className={styles.trackSettingsParams}>
                    <ParamRow
                      label="Thresh"
                      value={formatDb(settings.compThresholdDb)}
                      unit="dB"
                      min={COMP_THRESHOLD_DB_MIN}
                      max={COMP_THRESHOLD_DB_MAX}
                      step={1}
                      current={settings.compThresholdDb}
                      disabled={readOnly}
                      onChange={(compThresholdDb) =>
                        patch({ compThresholdDb })
                      }
                    />
                    <ParamRow
                      label="Ratio"
                      value={`${Math.round(settings.compRatio * 10) / 10}`}
                      unit=":1"
                      min={1}
                      max={20}
                      step={0.1}
                      current={settings.compRatio}
                      disabled={readOnly}
                      onChange={(compRatio) => patch({ compRatio })}
                    />
                    <ParamRow
                      label="Attack"
                      value={formatMs(settings.compAttackMs)}
                      unit="ms"
                      min={0.1}
                      max={200}
                      step={0.1}
                      current={settings.compAttackMs}
                      disabled={readOnly}
                      onChange={(compAttackMs) => patch({ compAttackMs })}
                    />
                    <ParamRow
                      label="Release"
                      value={formatMs(settings.compReleaseMs)}
                      unit="ms"
                      min={10}
                      max={1000}
                      step={1}
                      current={settings.compReleaseMs}
                      disabled={readOnly}
                      onChange={(compReleaseMs) => patch({ compReleaseMs })}
                    />
                    <ParamRow
                      label="Makeup"
                      value={formatDb(settings.compMakeupDb)}
                      unit="dB"
                      min={0}
                      max={24}
                      step={0.5}
                      current={settings.compMakeupDb}
                      disabled={readOnly}
                      onChange={(compMakeupDb) => patch({ compMakeupDb })}
                    />
                  </div>
                ) : (
                  <p className={styles.trackSettingsHint}>
                    Softens peaks and evens out levels. Use Auto for a waveform-based starting point.
                  </p>
                )}
              </section>

              <section className={styles.trackSettingsCard}>
                <div className={styles.trackSettingsCardHead}>
                  <h3 className={styles.trackSettingsSectionTitle}>Gate</h3>
                  <div className={styles.trackSettingsCardActions}>
                    {!readOnly ? (
                      <button
                        type="button"
                        className={styles.trackSettingsAutoBtn}
                        onClick={applyAutoGate}
                        disabled={!canAnalyze}
                        title={
                          canAnalyze
                            ? isClip
                              ? 'Guess gate settings from this clip waveform'
                              : 'Guess gate settings from this track waveform'
                            : isClip
                              ? 'Waveform not available for this clip yet'
                              : 'Waveform not available for this track yet'
                        }
                      >
                        <Sparkles size={13} strokeWidth={2.25} aria-hidden />
                        Auto
                      </button>
                    ) : null}
                    <label className={`toggle ${styles.trackSettingsSwitch}`}>
                      <input
                        type="checkbox"
                        checked={settings.gateEnabled}
                        disabled={readOnly}
                        aria-label="Enable gate"
                        onChange={(e) =>
                          patch({ gateEnabled: e.target.checked })
                        }
                      />
                      <span className="toggle__track" aria-hidden="true" />
                      <span>{settings.gateEnabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                </div>
                {settings.gateEnabled ? (
                  <div className={styles.trackSettingsParams}>
                    <ParamRow
                      label="Thresh"
                      value={formatDb(settings.gateThresholdDb)}
                      unit="dB"
                      min={GATE_THRESHOLD_DB_MIN}
                      max={GATE_THRESHOLD_DB_MAX}
                      step={1}
                      current={settings.gateThresholdDb}
                      disabled={readOnly}
                      onChange={(gateThresholdDb) =>
                        patch({ gateThresholdDb })
                      }
                    />
                    <ParamRow
                      label="Attack"
                      value={formatMs(settings.gateAttackMs)}
                      unit="ms"
                      min={0.1}
                      max={100}
                      step={0.1}
                      current={settings.gateAttackMs}
                      disabled={readOnly}
                      onChange={(gateAttackMs) => patch({ gateAttackMs })}
                    />
                    <ParamRow
                      label="Hold"
                      value={formatMs(settings.gateHoldMs)}
                      unit="ms"
                      min={0}
                      max={500}
                      step={1}
                      current={settings.gateHoldMs}
                      disabled={readOnly}
                      onChange={(gateHoldMs) => patch({ gateHoldMs })}
                    />
                    <ParamRow
                      label="Release"
                      value={formatMs(settings.gateReleaseMs)}
                      unit="ms"
                      min={1}
                      max={1000}
                      step={1}
                      current={settings.gateReleaseMs}
                      disabled={readOnly}
                      onChange={(gateReleaseMs) => patch({ gateReleaseMs })}
                    />
                  </div>
                ) : (
                  <p className={styles.trackSettingsHint}>
                    Cuts noise when the track is quiet. Use Auto for a waveform-based starting point.
                  </p>
                )}
              </section>

              {analyzeHint ? (
                <p className={styles.trackSettingsAnalyzeHint} role="status">
                  {analyzeHint}
                </p>
              ) : null}
            </div>

            {!readOnly ? (
              <div className={styles.trackSettingsFooter}>
                <button
                  type="button"
                  className={styles.trackSettingsDeleteBtn}
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={!canDeleteTrack}
                  title={
                    canDeleteTrack
                      ? isClip
                        ? 'Delete this clip'
                        : 'Delete this track and all of its clips'
                      : isClip
                        ? 'Keep at least one clip'
                        : 'Keep at least one track'
                  }
                >
                  <Trash2 size={14} strokeWidth={2.25} aria-hidden />
                  {deleteLabel}
                </button>
                <button
                  type="button"
                  className={styles.trackSettingsResetBtn}
                  onClick={resetAll}
                  title={
                    isClip
                      ? 'Clear this clip override and follow track settings again'
                      : 'Reset mute, volume, EQ, compressor, and gate to defaults'
                  }
                >
                  <RotateCcw size={14} strokeWidth={2.25} aria-hidden />
                  Reset all FX
                </button>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={deleteConfirmOpen}
        onOpenChange={(o) => !o && setDeleteConfirmOpen(false)}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className={`${styles.dialogOverlay} ${styles.dialogOverlayOnStackedModal}`}
          />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentOnStackedModal}`}
            onEscapeKeyDown={(e) => e.stopPropagation()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>
                {deleteConfirmTitle}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.dialogClose}
                  aria-label="Close"
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {isClip
                ? `Remove "${trackName}" from this segment? This can be undone until you save.`
                : `Remove "${trackName}" and all of its clips from this segment? This can be undone until you save.`}
            </Dialog.Description>
            <div
              className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}
            >
              <button
                type="button"
                className={styles.cancel}
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  onDeleteTrack();
                }}
              >
                {deleteLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
