import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

export function DefaultLimitsSection({ form, onFormChange }: SettingsFormProps) {
  return (
    <SectionCard
      title="Default Limits for New Users"
      subtitle="Optional. When set, new users get these limits. Leave empty for no limit."
    >
      <label className={styles.label}>
        Default max podcasts
        <input
          type="number"
          min={0}
          step={1}
          className={styles.input}
          placeholder="No limit"
          value={form.defaultMaxPodcasts ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ defaultMaxPodcasts: v === '' ? null : Number(v) });
          }}
        />
      </label>
      <label className={styles.label}>
        Default Max Episodes
        <input
          type="number"
          min={0}
          step={1}
          className={styles.input}
          placeholder="No limit"
          value={form.defaultMaxEpisodes ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ defaultMaxEpisodes: v === '' ? null : Number(v) });
          }}
        />
      </label>
      <label className={styles.label}>
        Default Storage Space (MB)
        <input
          type="number"
          min={0}
          step={1}
          className={styles.input}
          placeholder="No limit"
          value={form.defaultStorageMb ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ defaultStorageMb: v === '' ? null : Number(v) });
          }}
        />
      </label>
      <label className={styles.label}>
        Default Max Collaborators
        <input
          type="number"
          min={0}
          step={1}
          className={styles.input}
          placeholder="No limit"
          value={form.defaultMaxCollaborators ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ defaultMaxCollaborators: v === '' ? null : Number(v) });
          }}
        />
      </label>
      <label className={styles.label}>
        Default Max Subscriber Tokens
        <input
          type="number"
          min={0}
          step={1}
          className={styles.input}
          placeholder="No limit"
          value={form.defaultMaxSubscriberTokens ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ defaultMaxSubscriberTokens: v === '' ? null : Number(v) });
          }}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.defaultCanTranscribe}
          onChange={(e) => onFormChange({ defaultCanTranscribe: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Default Can Transcribe</span>
      </label>
      <p className={styles.toggleHelp}>
        When enabled, new users get transcription permission by default. When disabled, new users cannot generate transcripts until an admin enables it.
      </p>
    </SectionCard>
  );
}
