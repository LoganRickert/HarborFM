import styles from '../EpisodeEditor.module.css';
import type { PublishFormFields } from './utils';

export type { PublishFormFields };

export interface EpisodePublishControlsProps {
  values: PublishFormFields;
  onChange: (fields: Partial<PublishFormFields>) => void;
  /** When true, show read-only badges instead of inputs. */
  readOnly?: boolean;
  /** 'form' for Episode Details dialog; 'compact' for collapsible publish panel. */
  variant?: 'form' | 'compact';
}

const STATUSES = ['draft', 'scheduled', 'published'] as const;

function statusLabel(status: string): string {
  return status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Draft';
}

function statusBadgeClass(status: string): string {
  if (status === 'published') return styles.detailsSummaryStatusBadgePublished;
  if (status === 'scheduled') return styles.detailsSummaryStatusBadgeScheduled;
  return styles.detailsSummaryStatusBadgeDraft;
}

export function EpisodePublishControls({
  values,
  onChange,
  readOnly = false,
  variant = 'form',
}: EpisodePublishControlsProps) {
  const isCompact = variant === 'compact';

  if (readOnly) {
    const metaParts: string[] = [];
    const season = values.seasonNumber === '' ? null : parseInt(values.seasonNumber, 10);
    const episode = values.episodeNumber === '' ? null : parseInt(values.episodeNumber, 10);
    if (season != null || episode != null) {
      metaParts.push(`S${season ?? '?'} E${episode ?? '?'}`);
    }
    if (values.publishAt) {
      try {
        metaParts.push(new Date(values.publishAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
      } catch {
        // ignore
      }
    }
    return (
      <div className={isCompact ? styles.publishControlsReadOnly : undefined}>
        <span className={`${styles.detailsSummaryStatusBadge} ${statusBadgeClass(values.status)}`}>
          {statusLabel(values.status)}
        </span>
        {metaParts.length > 0 && (
          <span className={styles.publishPanelSummaryMeta}>{metaParts.join(' · ')}</span>
        )}
      </div>
    );
  }

  const statusToggle = (
    <div className={styles.publishStatusToggle} role="group" aria-label="Episode status">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          className={values.status === s ? styles.publishStatusActive : styles.publishStatusBtn}
          onClick={() => onChange({ status: s })}
          aria-pressed={values.status === s}
          aria-label={`Status: ${statusLabel(s)}`}
        >
          {statusLabel(s)}
        </button>
      ))}
    </div>
  );

  if (isCompact) {
    return (
      <div className={styles.publishControlsCompact}>
        <div className={styles.publishControlsRow}>
          <span className={styles.publishControlsFieldLabel}>Status</span>
          {statusToggle}
        </div>
        <div className={styles.publishControlsRow}>
          <span className={styles.publishControlsFieldLabel}>Season & Episode</span>
          <div className={styles.publishSeasonEpisodeGroup}>
            <label className={styles.publishSeasonEpisodeField}>
              <span className={styles.publishSeasonEpisodeFieldLabel}>Season</span>
              <input
                type="number"
                min={0}
                value={values.seasonNumber}
                onChange={(e) => onChange({ seasonNumber: e.target.value })}
                className={styles.publishSeasonEpisodeInput}
                aria-label="Season number"
              />
            </label>
            <div className={styles.publishSeasonEpisodeDivider} aria-hidden />
            <label className={styles.publishSeasonEpisodeField}>
              <span className={styles.publishSeasonEpisodeFieldLabel}>Episode</span>
              <input
                type="number"
                min={0}
                value={values.episodeNumber}
                onChange={(e) => onChange({ episodeNumber: e.target.value })}
                className={styles.publishSeasonEpisodeInput}
                aria-label="Episode number"
              />
            </label>
          </div>
        </div>
        <div className={styles.publishControlsRow}>
          <label className={styles.publishControlsDatetimeLabel}>
            <span className={styles.publishControlsFieldLabel}>Publish at</span>
            <input
              type="datetime-local"
              value={values.publishAt}
              onChange={(e) => onChange({ publishAt: e.target.value })}
              className={styles.publishControlsDatetimeInput}
              aria-label="Publish at date and time"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <>
      <label className={styles.label}>
        Status
        <div className={styles.statusToggle} role="group" aria-label="Episode status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={values.status === s ? styles.statusToggleActive : styles.statusToggleBtn}
              onClick={() => onChange({ status: s })}
              aria-pressed={values.status === s}
              aria-label={`Status: ${statusLabel(s)}`}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      </label>
      <label className={styles.label}>
        Publish at (optional)
        <input
          type="datetime-local"
          value={values.publishAt}
          onChange={(e) => onChange({ publishAt: e.target.value })}
          className={styles.input}
        />
      </label>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <label className={styles.label} style={{ flex: '1 1 80px' }}>
          Season
          <input
            type="number"
            min={0}
            value={values.seasonNumber}
            onChange={(e) => onChange({ seasonNumber: e.target.value })}
            className={styles.input}
            placeholder="e.g. 1"
          />
        </label>
        <label className={styles.label} style={{ flex: '1 1 80px' }}>
          Episode
          <input
            type="number"
            min={0}
            value={values.episodeNumber}
            onChange={(e) => onChange({ episodeNumber: e.target.value })}
            className={styles.input}
            placeholder="e.g. 1"
          />
        </label>
      </div>
    </>
  );
}
