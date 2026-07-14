import { Plus, Trash2 } from 'lucide-react';
import styles from './HrefTextListField.module.css';

export type StructuredFieldType = 'text' | 'url' | 'number' | 'select';

export type StructuredFieldDef<K extends string = string> = {
  key: K;
  label: string;
  type?: StructuredFieldType;
  placeholder?: string;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
};

export interface StructuredListFieldProps<T extends Record<string, string>> {
  label: string;
  hint?: string;
  docsUrl?: string;
  value: T[];
  onChange: (next: T[]) => void;
  fields: StructuredFieldDef<Extract<keyof T, string>>[];
  emptyRow: () => T;
  addLabel?: string;
}

export function StructuredListField<T extends Record<string, string>>({
  label,
  hint,
  docsUrl,
  value,
  onChange,
  fields,
  emptyRow,
  addLabel = 'Add',
}: StructuredListFieldProps<T>) {
  function updateRow(index: number, key: keyof T, nextVal: string) {
    onChange(
      value.map((row, i) => (i === index ? { ...row, [key]: nextVal } : row)),
    );
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...value, emptyRow()]);
  }

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
      <div className={styles.list}>
        {value.map((row, index) => (
          <div key={index} className={styles.row}>
            <div className={styles.fields}>
              {fields.map((field) => (
                <label key={field.key} className={styles.fieldLabel}>
                  {field.label}
                  {field.type === 'select' ? (
                    <select
                      className={styles.input}
                      value={row[field.key] ?? ''}
                      onChange={(e) => updateRow(index, field.key, e.target.value)}
                      aria-label={`${field.label} ${index + 1}`}
                    >
                      {(field.options ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
                      className={styles.input}
                      value={row[field.key] ?? ''}
                      onChange={(e) => updateRow(index, field.key, e.target.value)}
                      placeholder={field.placeholder}
                      maxLength={field.maxLength}
                      aria-label={`${field.label} ${index + 1}`}
                    />
                  )}
                </label>
              ))}
            </div>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => removeRow(index)}
              aria-label={`Remove ${label} ${index + 1}`}
              title="Remove"
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={styles.addBtn} onClick={addRow}>
        <Plus size={16} strokeWidth={2.25} aria-hidden />
        {addLabel}
      </button>
    </div>
  );
}
