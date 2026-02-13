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
          value={form.default_max_podcasts ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ default_max_podcasts: v === '' ? null : Number(v) });
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
          value={form.default_max_episodes ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ default_max_episodes: v === '' ? null : Number(v) });
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
          value={form.default_storage_mb ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ default_storage_mb: v === '' ? null : Number(v) });
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
          value={form.default_max_collaborators ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ default_max_collaborators: v === '' ? null : Number(v) });
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
          value={form.default_max_subscriber_tokens ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onFormChange({ default_max_subscriber_tokens: v === '' ? null : Number(v) });
          }}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.default_can_transcribe}
          onChange={(e) => onFormChange({ default_can_transcribe: e.target.checked })}
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
