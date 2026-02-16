import { Settings, Minimize2, Maximize2, X } from 'lucide-react';
import styles from './CallSettingsPanel.module.css';

export interface CallSettingsPanelProps {
  devices: MediaDeviceInfo[];
  deviceId: string;
  onDeviceChange: (deviceId: string) => void;
  onClose?: () => void;
  minimized: boolean;
  onMinimizeToggle: () => void;
}

export function CallSettingsPanel({
  devices,
  deviceId,
  onDeviceChange,
  onClose,
  minimized,
  onMinimizeToggle,
}: CallSettingsPanelProps) {
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
      {!minimized && (
        <div className={styles.body}>
          {devices.length > 0 ? (
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
          ) : (
            <p className={styles.emptyHint}>
              No microphones found. Grant microphone permission and refresh.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
