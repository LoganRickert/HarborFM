import { useState, useEffect, useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { EpisodePublishControls, type PublishFormFields } from './EpisodePublishControls';
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
}

export function CollapsiblePublishPanel({
  savedValues,
  readOnly = false,
  onSave,
  isSaving = false,
  saveError,
  hasFinalAudio,
}: CollapsiblePublishPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<PublishFormFields>(savedValues);
  const [dirty, setDirty] = useState(false);

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
    try {
      await onSave(draft);
      setDirty(false);
      setExpanded(false);
    } catch {
      // keep panel open on error
    }
  }

  if (readOnly) {
    return (
      <div className={styles.publishPanelGroup}>
        <div className={styles.publishPanelSummary}>
          <span className={styles.publishPanelRowTitle}>Publishing</span>
          <span className={`${styles.detailsSummaryStatusBadge} ${statusBadgeClass(savedValues.status)}`}>
            {statusLabel(savedValues.status)}
          </span>
        </div>
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
                disabled={isSaving || !dirty}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
