import { Plus, Trash2 } from 'lucide-react';
import type { HrefTextItem } from './hrefTextList';
import styles from './HrefTextListField.module.css';

export type { HrefTextItem } from './hrefTextList';

export interface HrefTextListFieldProps {
  /** Section heading shown above the list. */
  label: string;
  /** Short help text under the heading. */
  hint?: string;
  /** Podcasting 2.0 docs URL shown under the heading. */
  docsUrl?: string;
  value: HrefTextItem[];
  onChange: (next: HrefTextItem[]) => void;
  hrefPlaceholder?: string;
  textPlaceholder?: string;
  addLabel?: string;
  hrefAriaLabel?: string;
  textAriaLabel?: string;
  hrefMaxLength?: number;
  textMaxLength?: number;
}

export function HrefTextListField({
  label,
  hint,
  docsUrl,
  value,
  onChange,
  hrefPlaceholder = 'https://…',
  textPlaceholder = 'Optional label',
  addLabel = 'Add link',
  hrefAriaLabel = 'URL',
  textAriaLabel = 'Link text',
  hrefMaxLength = 2000,
  textMaxLength = 2000,
}: HrefTextListFieldProps) {
  function updateRow(index: number, patch: Partial<HrefTextItem>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...value, { href: '', text: '' }]);
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
              <label className={styles.fieldLabel}>
                URL
                <input
                  type="url"
                  className={styles.input}
                  value={row.href}
                  onChange={(e) => updateRow(index, { href: e.target.value })}
                  placeholder={hrefPlaceholder}
                  maxLength={hrefMaxLength}
                  aria-label={`${hrefAriaLabel} ${index + 1}`}
                />
              </label>
              <label className={styles.fieldLabel}>
                Link text
                <input
                  type="text"
                  className={styles.input}
                  value={row.text}
                  onChange={(e) => updateRow(index, { text: e.target.value })}
                  placeholder={textPlaceholder}
                  maxLength={textMaxLength}
                  aria-label={`${textAriaLabel} ${index + 1}`}
                />
              </label>
            </div>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => removeRow(index)}
              aria-label={`Remove link ${index + 1}`}
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
