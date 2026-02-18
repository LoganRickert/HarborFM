import { Settings, Minimize2, Maximize2, X, Mic, Volume2 } from 'lucide-react';
import styles from './CallSettingsPanel.module.css';

export interface CallSettingsPanelProps {
  devices: MediaDeviceInfo[];
  deviceId: string;
  onDeviceChange: (deviceId: string) => void;
  onClose?: () => void;
  minimized: boolean;
  onMinimizeToggle: () => void;
  listenToSelf?: boolean;
  onListenToSelfToggle?: () => void;
  listenToSelfDisabled?: boolean;
  autoGainControl?: boolean;
  onAutoGainControlChange?: (enabled: boolean) => void;
  micVolume?: number;
  onMicVolumeChange?: (volume: number) => void;
  /** When true, only render body (settings form) without header/panel chrome. Used on mobile inside call panel. */
  embedded?: boolean;
}

export function CallSettingsPanel({
  devices,
  deviceId,
  onDeviceChange,
  onClose,
  minimized,
  onMinimizeToggle,
  listenToSelf = false,
  onListenToSelfToggle,
  listenToSelfDisabled = false,
  autoGainControl = true,
  onAutoGainControlChange,
  micVolume = 1,
  onMicVolumeChange,
  embedded = false,
}: CallSettingsPanelProps) {
  const bodyContent = (
    <>
      {devices.length > 0 ? (
        <>
          <div className={styles.micSelector}>
            <label className={styles.label} htmlFor="call-settings-mic">
              Microphone
            </label>
            <select
              id="call-settings-mic"
              className={styles.select}
              value={deviceId}
              onChange={(e) => onDeviceChange(e.target.value)}
              aria-label="Microphone"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
          {onAutoGainControlChange && (
            <div className={styles.agcRow}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={autoGainControl}
                  onChange={(e) => onAutoGainControlChange(e.target.checked)}
                  aria-label="Auto Gain Control"
                />
                <span className="toggle__track" aria-hidden="true" />
                <span>Auto Gain Control</span>
              </label>
            </div>
          )}
          {!autoGainControl && onMicVolumeChange && (
            <>
              <div className={styles.volumeRow}>
                <label className={styles.label} htmlFor="call-settings-mic-volume">Volume</label>
                <input
                  id="call-settings-mic-volume"
                  type="range"
                  min={0}
                  max={800}
                  value={Math.round((micVolume ?? 1) * 100)}
                  onChange={(e) => onMicVolumeChange(parseInt(e.target.value, 10) / 100)}
                  className={styles.volumeSlider}
                  aria-label="Microphone volume"
                />
                <span className={styles.volumeValue}>{Math.round((micVolume ?? 1) * 100)}%</span>
              </div>
              <p className={styles.agcHint} title="Chrome may still apply AGC. If volume still pumps, try chrome://flags → search 'WebRTC input volume' → Disabled.">
                Use headphones to avoid feedback. If volume pumps, try disabling &quot;Allow WebRTC to adjust input volume&quot; in chrome://flags.
              </p>
            </>
          )}
          {onListenToSelfToggle && (
            <div className={styles.listenRow}>
              <button
                type="button"
                className={styles.listenBtn}
                onClick={onListenToSelfToggle}
                disabled={listenToSelfDisabled}
                aria-pressed={listenToSelf}
                aria-label={listenToSelf ? 'Stop listening to yourself' : 'Listen to yourself'}
              >
                {listenToSelf ? <Volume2 size={16} /> : <Mic size={16} />}
                {listenToSelf ? ' Stop listening' : ' Listen to yourself'}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className={styles.emptyHint}>
          No microphones found. Grant microphone permission and refresh.
        </p>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className={styles.body} role="region" aria-label="Settings">
        {bodyContent}
      </div>
    );
  }

  return (
    <div className={styles.panel} role="region" aria-label="Settings" data-minimized={minimized || undefined}>
      <div className={styles.header}>
        <Settings size={18} strokeWidth={2} aria-hidden />
        <span className={styles.title}>Settings</span>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onMinimizeToggle}
          aria-label={minimized ? 'Maximize' : 'Minimize'}
          title={minimized ? 'Maximize' : 'Minimize'}
        >
          {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
        </button>
        {onClose && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close settings"
            title="Close settings"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
      {!minimized && <div className={styles.body}>{bodyContent}</div>}
    </div>
  );
}
