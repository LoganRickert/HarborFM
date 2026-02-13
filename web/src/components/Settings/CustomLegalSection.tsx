import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

export function CustomLegalSection({ form, onFormChange }: SettingsFormProps) {
  return (
    <SectionCard
      title="Custom Terms & Privacy"
      subtitle="Optional. When set, the public Terms of Service and Privacy Policy pages show your custom text instead of the default. Markdown is supported."
    >
      <label className={styles.label}>
        Custom Terms of Service (Markdown)
        <textarea
          className={`${styles.input} ${styles.textareaLarge}`}
          rows={8}
          placeholder="Paste or write your terms in Markdown. Leave empty to use the default terms."
          value={form.custom_terms}
          onChange={(e) => onFormChange({ custom_terms: e.target.value })}
        />
      </label>
      <label className={styles.label}>
        Custom Privacy Policy (Markdown)
        <textarea
          className={`${styles.input} ${styles.textareaLarge}`}
          rows={8}
          placeholder="Paste or write your privacy policy in Markdown. Leave empty to use the default policy."
          value={form.custom_privacy}
          onChange={(e) => onFormChange({ custom_privacy: e.target.value })}
        />
      </label>
    </SectionCard>
  );
}
