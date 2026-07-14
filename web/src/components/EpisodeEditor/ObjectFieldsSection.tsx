import styles from './HrefTextListField.module.css';

export type ObjectFieldDef = {
  key: string;
  label: string;
  type?: 'text' | 'url';
  placeholder?: string;
  maxLength?: number;
  hint?: string;
};

export interface ObjectFieldsSectionProps {
  label: string;
  hint?: string;
  docsUrl?: string;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  fields: ObjectFieldDef[];
}

/** Compact single-object editor (license, chat) matching list-card styling. */
export function ObjectFieldsSection({
  label,
  hint,
  docsUrl,
  value,
  onChange,
  fields,
}: ObjectFieldsSectionProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>{label}</div>
      {docsUrl ? (
        <a
          className={styles.docsLink}
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Podcasting 2.0 Docs
        </a>
      ) : null}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      <div className={styles.row}>
        <div className={styles.fields}>
          {fields.map((field) => (
            <label key={field.key} className={styles.fieldLabel}>
              {field.label}
              <input
                type={field.type === 'url' ? 'url' : 'text'}
                className={styles.input}
                value={value[field.key] ?? ''}
                onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                maxLength={field.maxLength}
              />
              {field.hint ? <span className={styles.hint}>{field.hint}</span> : null}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
