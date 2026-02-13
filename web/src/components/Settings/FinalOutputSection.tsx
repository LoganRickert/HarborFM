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
          value={form.final_bitrate_kbps}
          onChange={(e) => onFormChange({ final_bitrate_kbps: Number(e.target.value) })}
        />
      </label>

      <div className={styles.label}>
        Channels
        <div className={styles.llmToggle} role="group" aria-label="Output channels">
          <button
            type="button"
            className={form.final_channels === 'mono' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ final_channels: 'mono' })}
          >
            Mono
          </button>
          <button
            type="button"
            className={form.final_channels === 'stereo' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ final_channels: 'stereo' })}
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
            className={form.final_format === 'mp3' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ final_format: 'mp3' })}
          >
            MP3
          </button>
          <button
            type="button"
            className={form.final_format === 'm4a' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
            onClick={() => onFormChange({ final_format: 'm4a' })}
          >
            M4A
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
