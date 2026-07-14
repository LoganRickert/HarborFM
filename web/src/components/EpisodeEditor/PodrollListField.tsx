import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { previewFeedChannel } from '../../api/podcasts';
import { emptyPodrollItem, type PodrollFormItem } from './podrollForm';
import styles from './HrefTextListField.module.css';
import podrollStyles from './PodrollListField.module.css';

export type { PodrollFormItem } from './podrollForm';

export interface PodrollListFieldProps {
  label?: string;
  hint?: string;
  docsUrl?: string;
  value: PodrollFormItem[];
  onChange: (next: PodrollFormItem[]) => void;
  addLabel?: string;
}

export function PodrollListField({
  label = 'Podroll',
  hint,
  docsUrl,
  value,
  onChange,
  addLabel = 'Add recommendation',
}: PodrollListFieldProps) {
  const [fetchingIndex, setFetchingIndex] = useState<number | null>(null);
  const [fetchErrors, setFetchErrors] = useState<Record<number, string>>({});

  function updateRow(index: number, patch: Partial<PodrollFormItem>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
    setFetchErrors((prev) => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const ki = Number(k);
        if (ki < index) next[ki] = v;
        else if (ki > index) next[ki - 1] = v;
      }
      return next;
    });
  }

  function addRow() {
    onChange([...value, emptyPodrollItem()]);
  }

  async function handleFetch(index: number) {
    const url = value[index]?.feedUrl.trim() ?? '';
    if (!url) {
      setFetchErrors((prev) => ({ ...prev, [index]: 'Paste an RSS feed URL first.' }));
      return;
    }
    setFetchingIndex(index);
    setFetchErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    try {
      const preview = await previewFeedChannel(url);
      updateRow(index, {
        feedGuid: preview.feedGuid ?? '',
        feedUrl: preview.feedUrl ?? url,
        title: preview.title ?? '',
        coverArtUrl: preview.coverArtUrl ?? '',
        homeUrl: preview.homeUrl ?? '',
      });
      if (!preview.feedGuid) {
        setFetchErrors((prev) => ({
          ...prev,
          [index]:
            'Feed has no podcast GUID. Fill Feed GUID manually before saving.',
        }));
      }
    } catch (err) {
      setFetchErrors((prev) => ({
        ...prev,
        [index]: err instanceof Error ? err.message : 'Failed to fetch feed',
      }));
    } finally {
      setFetchingIndex(null);
    }
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
              <div className={podrollStyles.rssRow}>
                <label className={`${styles.fieldLabel} ${podrollStyles.rssField}`}>
                  Feed URL
                  <input
                    type="url"
                    className={styles.input}
                    value={row.feedUrl}
                    onChange={(e) => updateRow(index, { feedUrl: e.target.value })}
                    placeholder="https://example.com/feed.xml"
                    maxLength={2000}
                    aria-label={`Feed URL ${index + 1}`}
                  />
                </label>
                <button
                  type="button"
                  className={podrollStyles.fetchBtn}
                  onClick={() => void handleFetch(index)}
                  disabled={fetchingIndex === index}
                  aria-label={`Fetch feed metadata ${index + 1}`}
                >
                  {fetchingIndex === index ? 'Fetching…' : 'Fetch'}
                </button>
              </div>

              {fetchErrors[index] ? (
                <p className={podrollStyles.error} role="alert">
                  {fetchErrors[index]}
                </p>
              ) : null}

              <label className={styles.fieldLabel}>
                Feed GUID
                <input
                  type="text"
                  className={styles.input}
                  value={row.feedGuid}
                  onChange={(e) => updateRow(index, { feedGuid: e.target.value })}
                  placeholder="Required podcast GUID"
                  maxLength={256}
                  aria-label={`Feed GUID ${index + 1}`}
                />
              </label>
              <label className={styles.fieldLabel}>
                Home Page URL
                <input
                  type="url"
                  className={styles.input}
                  value={row.homeUrl}
                  onChange={(e) => updateRow(index, { homeUrl: e.target.value })}
                  placeholder="https://… (optional website)"
                  maxLength={2000}
                  aria-label={`Home Page URL ${index + 1}`}
                />
              </label>
              <label className={styles.fieldLabel}>
                Title
                <input
                  type="text"
                  className={styles.input}
                  value={row.title}
                  onChange={(e) => updateRow(index, { title: e.target.value })}
                  placeholder="Show title"
                  maxLength={256}
                  aria-label={`Title ${index + 1}`}
                />
              </label>
              <label className={styles.fieldLabel}>
                Cover art URL
                <input
                  type="url"
                  className={styles.input}
                  value={row.coverArtUrl}
                  onChange={(e) => updateRow(index, { coverArtUrl: e.target.value })}
                  placeholder="https://…/cover.jpg"
                  maxLength={2000}
                  aria-label={`Cover art URL ${index + 1}`}
                />
              </label>
              {row.coverArtUrl.trim() ? (
                <img
                  src={row.coverArtUrl.trim()}
                  alt=""
                  className={podrollStyles.coverPreview}
                />
              ) : null}
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
