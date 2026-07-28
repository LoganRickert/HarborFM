import { useState, useEffect, useId } from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { EpisodePublishControls, type PublishFormFields } from './EpisodePublishControls';
import { isExpiresAtBeforePublishAt } from './utils';
import styles from '../EpisodeEditor.module.css';

function statusLabel(status: string): string {
  return status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Draft';
}

function statusBadgeClass(status: string): string {
  if (status === 'published') return styles.detailsSummaryStatusBadgePublished;
  if (status === 'scheduled') return styles.detailsSummaryStatusBadgeScheduled;
  return styles.detailsSummaryStatusBadgeDraft;
}

export interface CollapsiblePublishPanelProps {
  savedValues: PublishFormFields;
  readOnly?: boolean;
  onSave: (values: PublishFormFields) => void | Promise<void>;
  isSaving?: boolean;
  saveError?: string | null;
  hasFinalAudio: boolean;
  /** Public episode URL when scheduled or published. */
  episodeUrl?: string | null;
}

export function CollapsiblePublishPanel({
  savedValues,
  readOnly = false,
  onSave,
  isSaving = false,
  saveError,
  hasFinalAudio,
  episodeUrl,
}: CollapsiblePublishPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<PublishFormFields>(savedValues);
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!expanded) {
      setDraft(savedValues);
      setDirty(false);
    }
  }, [savedValues, expanded]);

  function openPanel() {
    setDraft(savedValues);
    setDirty(false);
    setExpanded(true);
  }

  function closePanel() {
    setDraft(savedValues);
    setDirty(false);
    setExpanded(false);
  }

  function handleChange(fields: Partial<PublishFormFields>) {
    setDraft((prev) => {
      const next = { ...prev, ...fields };
      setDirty(true);
      return next;
    });
  }

  async function handleSave() {
    if (isExpiresAtBeforePublishAt(draft)) return;
    try {
      await onSave(draft);
      setDirty(false);
      setExpanded(false);
    } catch {
      // keep panel open on error
    }
  }

  async function handleCopyUrl() {
    if (!episodeUrl) return;
    try {
      await navigator.clipboard.writeText(episodeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  const saveBlocked = isExpiresAtBeforePublishAt(draft);
  const showEpisodeLink =
    Boolean(episodeUrl?.trim()) &&
    (savedValues.status === 'scheduled' || savedValues.status === 'published');

  const episodeLinkRow = showEpisodeLink ? (
    <div className={styles.publishEpisodeLinkRow}>
      <a
        href={episodeUrl!}
        className={styles.publishEpisodeLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        {episodeUrl}
      </a>
      <button
        type="button"
        className={styles.publishEpisodeCopyBtn}
        onClick={() => void handleCopyUrl()}
        aria-label={copied ? 'Copied' : 'Copy episode link'}
        title={copied ? 'Copied' : 'Copy link'}
      >
        {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      </button>
    </div>
  ) : null;

  if (readOnly) {
    return (
      <div className={styles.publishPanelGroup}>
        <div className={styles.publishPanelSummary}>
          <span className={styles.publishPanelRowTitle}>Publishing</span>
          <span className={`${styles.detailsSummaryStatusBadge} ${statusBadgeClass(savedValues.status)}`}>
            {statusLabel(savedValues.status)}
          </span>
        </div>
        {episodeLinkRow}
      </div>
    );
  }

  return (
    <div className={styles.publishPanel}>
      <div className={`${styles.publishPanelGroup} ${expanded ? styles.publishPanelGroupExpanded : ''}`}>
        <button
          type="button"
          className={styles.publishPanelRow}
          onClick={() => (expanded ? closePanel() : openPanel())}
          aria-expanded={expanded}
          aria-controls={panelId}
        >
          <span className={styles.publishPanelRowTitle}>Publishing</span>
          <ChevronRight
            size={16}
            strokeWidth={2.25}
            className={styles.publishPanelChevron}
            aria-hidden
          />
        </button>

        {episodeLinkRow}

        <div
          id={panelId}
          className={`${styles.publishPanelExpand} ${expanded ? styles.publishPanelExpandOpen : ''}`}
          aria-hidden={!expanded}
        >
          <div className={styles.publishPanelExpandInner}>
            <div className={styles.publishPanelDivider} />
            <EpisodePublishControls
              values={draft}
              onChange={handleChange}
              variant="compact"
              hasFinalAudio={hasFinalAudio}
            />
            {dirty && (
              <p className={styles.publishPanelUnsavedNote}>You have unsaved changes</p>
            )}
            {saveError && (
              <p className={styles.error} role="alert" style={{ margin: '0.5rem 0 0' }}>
                {saveError}
              </p>
            )}
            <div className={styles.publishPanelActions}>
              <button
                type="button"
                className={styles.publishPanelCancelBtn}
                onClick={closePanel}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.publishPanelSaveBtn}
                onClick={handleSave}
                disabled={isSaving || !dirty || saveBlocked}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
