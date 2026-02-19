import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

export function FinalOutputSection({ form, onFormChange }: SettingsFormProps) {
  return (
    <SectionCard
      title="Final Episode Output"
      subtitle="Choose the format and quality for the final audio file."
    >
      <label className={styles.label}>
        Bitrate (kbps)
        <input
          type="number"
          min={16}
          max={320}
          step={1}
          className={styles.input}
          value={form.finalBitrateKbps}
          onChange={(e) => onFormChange({ finalBitrateKbps: Number(e.target.value) })}
        />
      </label>

      <div className={styles.label}>
        Channels
        <div className={styles.llmToggle} role="group" aria-label="Output channels">
          <button
            type="button"
            className={form.finalChannels === 'mono' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ finalChannels: 'mono' })}
          >
            Mono
          </button>
          <button
            type="button"
            className={form.finalChannels === 'stereo' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ finalChannels: 'stereo' })}
          >
            Stereo
          </button>
        </div>
      </div>

      <div className={styles.label}>
        Format
        <div className={styles.llmToggle} role="group" aria-label="Output format">
          <button
            type="button"
            className={form.finalFormat === 'mp3' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ finalFormat: 'mp3' })}
          >
            MP3
          </button>
          <button
            type="button"
            className={form.finalFormat === 'm4a' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ finalFormat: 'm4a' })}
          >
            M4A
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
