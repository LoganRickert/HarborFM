import { Mic, Library } from 'lucide-react';
import { SegmentRow } from './SegmentRow';
import type { EpisodeSegment } from '../../api/segments';
import styles from '../EpisodeEditor.module.css';

export interface EpisodeSectionsPanelProps {
  episodeId: string;
  segments: EpisodeSegment[];
  segmentsLoading: boolean;
  onAddRecord: () => void;
  onAddLibrary: () => void;
  /** When true, disable "Record new section" (e.g. less than 5 MB free). */
  recordDisabled?: boolean;
  /** Shown when record is disabled. */
  recordDisabledMessage?: string;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onDeleteRequest: (segmentId: string) => void;
  onUpdateSegmentName: (segmentId: string, name: string | null) => void;
  isDeletingSegment: boolean;
  deletingSegmentId: string | null;
  onSegmentPlayRequest: (segmentId: string) => void;
  onSegmentMoreInfo: (segmentId: string) => void;
  registerSegmentPause: (id: string, pause: () => void) => void;
  unregisterSegmentPause: (id: string) => void;
}

export function EpisodeSectionsPanel({
  episodeId,
  segments,
  segmentsLoading,
  onAddRecord,
  onAddLibrary,
  recordDisabled = false,
  recordDisabledMessage,
  onMoveUp,
  onMoveDown,
  onDeleteRequest,
  onUpdateSegmentName,
  isDeletingSegment,
  deletingSegmentId,
  onSegmentPlayRequest,
  onSegmentMoreInfo,
  registerSegmentPause,
  unregisterSegmentPause,
}: EpisodeSectionsPanelProps) {
  return (
    <div className={styles.sectionsPanel}>
      <header className={styles.sectionsPanelHeader}>
        <h2 className={styles.sectionTitle}>Build Your Episode</h2>
        <p className={styles.sectionSub}>
          Add sections in order: record new audio or insert from your library. Then build the final MP3.
        </p>
      </header>

      <div className={styles.addSectionChoiceRow}>
        {recordDisabled ? (
          <span
            className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.addSectionChoiceBtnDisabled}`}
            title={recordDisabledMessage}
            aria-label={recordDisabledMessage ?? 'Record new section (disabled)'}
          >
            <Mic size={24} strokeWidth={2} aria-hidden />
            <span>Record new section</span>
          </span>
        ) : (
          <button type="button" className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary}`} onClick={onAddRecord} aria-label="Record new section">
            <Mic size={24} strokeWidth={2} aria-hidden />
            <span>Record new section</span>
          </button>
        )}
        <button type="button" className={styles.addSectionChoiceBtn} onClick={onAddLibrary} aria-label="Insert from library">
          <Library size={24} strokeWidth={2} aria-hidden />
          <span>Insert from library</span>
        </button>
      </div>
      {recordDisabled && recordDisabledMessage && (
        <p className={styles.sectionSub} style={{ marginTop: '0.25rem' }}>
          {recordDisabledMessage}
        </p>
      )}

      {segmentsLoading ? (
        <p className={styles.sectionSub}>Loading sections…</p>
      ) : segments.length === 0 ? (
        <p className={styles.sectionSub}>No sections yet. Record or add from library above.</p>
      ) : (
        <ul className={styles.segmentList}>
          {segments.map((seg, index) => (
            <SegmentRow
              key={seg.id}
              episodeId={episodeId}
              segment={seg}
              index={index}
              total={segments.length}
              onMoveUp={() => onMoveUp(index)}
              onMoveDown={() => onMoveDown(index)}
              onDeleteRequest={() => onDeleteRequest(seg.id)}
              onUpdateName={onUpdateSegmentName}
              isDeleting={isDeletingSegment && deletingSegmentId === seg.id}
              onPlayRequest={onSegmentPlayRequest}
              onMoreInfo={() => onSegmentMoreInfo(seg.id)}
              registerPause={registerSegmentPause}
              unregisterPause={unregisterSegmentPause}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
