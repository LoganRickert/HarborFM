import { Plus, Trash2 } from 'lucide-react';
import {
  emptyValueBlock,
  emptyValueRecipient,
  type ValueBlockForm,
  type ValueRecipientForm,
} from './valueBlocksForm';
import styles from './HrefTextListField.module.css';

export type { ValueBlockForm, ValueRecipientForm } from './valueBlocksForm';

export interface ValueBlocksFieldProps {
  value: ValueBlockForm[];
  onChange: (next: ValueBlockForm[]) => void;
}

export function ValueBlocksField({ value, onChange }: ValueBlocksFieldProps) {
  function updateBlock(index: number, patch: Partial<ValueBlockForm>) {
    onChange(value.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function updateRecipient(
    blockIndex: number,
    recipientIndex: number,
    patch: Partial<ValueRecipientForm>,
  ) {
    onChange(
      value.map((b, i) => {
        if (i !== blockIndex) return b;
        return {
          ...b,
          recipients: b.recipients.map((r, j) =>
            j === recipientIndex ? { ...r, ...patch } : r,
          ),
        };
      }),
    );
  }

  function removeBlock(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addBlock() {
    onChange([...value, emptyValueBlock()]);
  }

  function addRecipient(blockIndex: number) {
    onChange(
      value.map((b, i) =>
        i === blockIndex
          ? { ...b, recipients: [...b.recipients, emptyValueRecipient()] }
          : b,
      ),
    );
  }

  function removeRecipient(blockIndex: number, recipientIndex: number) {
    onChange(
      value.map((b, i) => {
        if (i !== blockIndex) return b;
        const next = b.recipients.filter((_, j) => j !== recipientIndex);
        return {
          ...b,
          recipients: next.length > 0 ? next : [emptyValueRecipient()],
        };
      }),
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>Value (Value 4 Value)</div>
      <a
        className={styles.docsLink}
        href="https://podcasting2.org/docs/podcast-namespace/tags/value"
        target="_blank"
        rel="noopener noreferrer"
      >
        Podcasting 2.0 Docs
      </a>
      <p className={styles.hint}>
        Podcast 2.0 payment splits. Each block needs a type/method and at least one recipient with
        address and split shares.
      </p>
      <div className={styles.list}>
        {value.map((block, blockIndex) => (
          <div key={blockIndex} className={styles.row} style={{ flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', width: '100%', alignItems: 'flex-start' }}>
              <div className={styles.fields}>
                <label className={styles.fieldLabel}>
                  Type
                  <input
                    className={styles.input}
                    value={block.type}
                    onChange={(e) => updateBlock(blockIndex, { type: e.target.value })}
                    placeholder="lightning"
                    maxLength={64}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Method
                  <input
                    className={styles.input}
                    value={block.method}
                    onChange={(e) => updateBlock(blockIndex, { method: e.target.value })}
                    placeholder="keysend"
                    maxLength={64}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Suggested amount
                  <input
                    className={styles.input}
                    value={block.suggested}
                    onChange={(e) => updateBlock(blockIndex, { suggested: e.target.value })}
                    placeholder="0.00000005000"
                    maxLength={64}
                  />
                </label>
              </div>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeBlock(blockIndex)}
                aria-label={`Remove value block ${blockIndex + 1}`}
                title="Remove block"
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden />
              </button>
            </div>

            <div className={styles.heading} style={{ fontSize: '0.8125rem' }}>
              Recipients
            </div>
            {block.recipients.map((r, recipientIndex) => (
              <div
                key={recipientIndex}
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  border: '1px dashed var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div className={styles.fields}>
                  <label className={styles.fieldLabel}>
                    Type
                    <input
                      className={styles.input}
                      value={r.type}
                      onChange={(e) =>
                        updateRecipient(blockIndex, recipientIndex, { type: e.target.value })
                      }
                      placeholder="node or lnaddress"
                      maxLength={64}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Address
                    <input
                      className={styles.input}
                      value={r.address}
                      onChange={(e) =>
                        updateRecipient(blockIndex, recipientIndex, { address: e.target.value })
                      }
                      placeholder="pubkey or name@domain"
                      maxLength={512}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Split
                    <input
                      type="number"
                      className={styles.input}
                      value={r.split}
                      onChange={(e) =>
                        updateRecipient(blockIndex, recipientIndex, { split: e.target.value })
                      }
                      min={0}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Name
                    <input
                      className={styles.input}
                      value={r.name}
                      onChange={(e) =>
                        updateRecipient(blockIndex, recipientIndex, { name: e.target.value })
                      }
                      placeholder="Optional"
                      maxLength={128}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Custom key
                    <input
                      className={styles.input}
                      value={r.customKey}
                      onChange={(e) =>
                        updateRecipient(blockIndex, recipientIndex, { customKey: e.target.value })
                      }
                      maxLength={128}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Custom value
                    <input
                      className={styles.input}
                      value={r.customValue}
                      onChange={(e) =>
                        updateRecipient(blockIndex, recipientIndex, {
                          customValue: e.target.value,
                        })
                      }
                      maxLength={512}
                    />
                  </label>
                  <label className="toggle" style={{ marginTop: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={r.fee}
                      onChange={(e) =>
                        updateRecipient(blockIndex, recipientIndex, { fee: e.target.checked })
                      }
                    />
                    <span className="toggle__track" aria-hidden="true" />
                    <span>Fee recipient</span>
                  </label>
                </div>
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => removeRecipient(blockIndex, recipientIndex)}
                  aria-label={`Remove recipient ${recipientIndex + 1}`}
                  title="Remove recipient"
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => addRecipient(blockIndex)}
            >
              <Plus size={16} strokeWidth={2.25} aria-hidden />
              Add recipient
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={styles.addBtn} onClick={addBlock}>
        <Plus size={16} strokeWidth={2.25} aria-hidden />
        Add value block
      </button>
    </div>
  );
}
