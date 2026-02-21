import { Mic, Library, Loader2 } from 'lucide-react';
import { SegmentRow } from './SegmentRow';
import { useBatchedSegmentWaveforms } from '../../hooks/useBatchedSegmentWaveforms';
import type { EpisodeSegment } from '../../api/segments';
import sharedStyles from '../../components/PodcastDetail/shared.module.css';
import styles from '../EpisodeEditor.module.css';

export interface EpisodeSectionsPanelProps {
  episodeId: string;
  segments: EpisodeSegment[];
  segmentsLoading: boolean;
  /** Segment IDs still being processed (recording stopped, not yet added). Shown as placeholder cards. */
  processingSegmentIds?: string[];
  /** True when recording is actively in progress (vs generating after stop). */
  isRecordingActive?: boolean;
  onAddRecord: () => void;
  onAddLibrary: () => void;
  /** When true, disable "Record new section" (e.g. less than 5 MB free). */
  recordDisabled?: boolean;
  /** Shown when record is disabled. */
  recordDisabledMessage?: string;
  /** When true, user cannot add record, add library, or edit/delete/move segments. */
  readOnly?: boolean;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onDeleteRequest: (segmentId: string) => void;
  onRecoverRequest?: (segmentId: string) => void;
  onUpdateSegmentName: (segmentId: string, name: string | null) => void;
  isDeletingSegment: boolean;
  deletingSegmentId: string | null;
  recoveringSegmentId?: string | null;
  onSegmentPlayRequest: (segmentId: string) => void;
  onSegmentMoreInfo?: (segmentId: string) => void;
  onSegmentEdit?: (segmentId: string) => void;
  onSegmentToggleDisabled?: (segmentId: string) => void;
  registerSegmentPause: (id: string, pause: () => void) => void;
  unregisterSegmentPause: (id: string) => void;
}

export function EpisodeSectionsPanel({
  episodeId,
  segments,
  segmentsLoading,
  processingSegmentIds = [],
  isRecordingActive = false,
  onAddRecord,
  onAddLibrary,
  recordDisabled = false,
  recordDisabledMessage,
  readOnly = false,
  onMoveUp,
  onMoveDown,
  onDeleteRequest,
  onRecoverRequest,
  onUpdateSegmentName,
  isDeletingSegment,
  deletingSegmentId,
  recoveringSegmentId = null,
  onSegmentPlayRequest,
  onSegmentMoreInfo,
  onSegmentEdit,
  onSegmentToggleDisabled,
  registerSegmentPause,
  unregisterSegmentPause,
}: EpisodeSectionsPanelProps) {
  const segmentWaveforms = useBatchedSegmentWaveforms(episodeId, segments);

  return (
    <div className={styles.sectionsPanel}>
      <header className={styles.sectionsPanelHeader}>
        <h2 className={styles.sectionTitle}>Build Your Episode</h2>
        <p className={styles.sectionSub}>
          Add sections in order: record new audio or insert from your library. Then build the final MP3.
        </p>
      </header>

      <div className={styles.addSectionChoiceRow}>
        {recordDisabled || readOnly ? (
          <span
            className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.addSectionChoiceBtnDisabled}`}
            title={readOnly ? 'Read-only account' : recordDisabledMessage}
            aria-label={readOnly ? 'Record new section (read-only)' : (recordDisabledMessage ?? 'Record new section (disabled)')}
          >
            <Mic size={24} strokeWidth={2} aria-hidden />
            <span>Record New Section</span>
          </span>
        ) : (
          <button type="button" className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary}`} onClick={onAddRecord} aria-label="Record new section">
            <Mic size={24} strokeWidth={2} aria-hidden />
            <span>Record New Section</span>
          </button>
        )}
        {readOnly ? (
          <span
            className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnDisabled}`}
            title="Read-only account"
            aria-label="Insert from library (read-only)"
          >
            <Library size={24} strokeWidth={2} aria-hidden />
            <span>Insert from library</span>
          </span>
        ) : (
          <button type="button" className={styles.addSectionChoiceBtn} onClick={onAddLibrary} aria-label="Insert from library">
            <Library size={24} strokeWidth={2} aria-hidden />
            <span>Insert from library</span>
          </button>
        )}
      </div>
      {recordDisabled && recordDisabledMessage && (
        <p className={styles.sectionSub} style={{ marginTop: '0.25rem' }}>
          {recordDisabledMessage}
        </p>
      )}

      {segmentsLoading ? (
        <p className={sharedStyles.pdCardEmptyState}>Loading sections...</p>
      ) : segments.length === 0 && processingSegmentIds.length === 0 ? (
        <p className={sharedStyles.pdCardEmptyState}>No sections yet. Record or add from library above.</p>
      ) : (
        <ul className={styles.segmentList}>
          {segments.map((seg, index) => (
            <SegmentRow
              key={seg.id}
              episodeId={episodeId}
              segment={seg}
              isRecordingActive={isRecordingActive}
              index={index}
              total={segments.length}
              onMoveUp={() => onMoveUp(index)}
              onMoveDown={() => onMoveDown(index)}
              onDeleteRequest={() => onDeleteRequest(seg.id)}
              onRecoverRequest={onRecoverRequest && seg.recordFailed ? () => onRecoverRequest(seg.id) : undefined}
              onUpdateName={onUpdateSegmentName}
              isDeleting={isDeletingSegment && deletingSegmentId === seg.id}
              isRecovering={recoveringSegmentId === seg.id}
              onPlayRequest={onSegmentPlayRequest}
              onMoreInfo={onSegmentMoreInfo ? () => onSegmentMoreInfo(seg.id) : undefined}
              onEdit={onSegmentEdit ? () => onSegmentEdit(seg.id) : undefined}
              onToggleDisabled={onSegmentToggleDisabled ? () => onSegmentToggleDisabled(seg.id) : undefined}
              registerPause={registerSegmentPause}
              unregisterPause={unregisterSegmentPause}
              readOnly={readOnly}
              waveformData={segmentWaveforms.get(seg.id)}
            />
          ))}
          {processingSegmentIds.map((segId) => (
            <li key={segId} className={`${styles.segmentBlock} ${styles.segmentBlockProcessing}`}>
              <div className={styles.segmentBlockTop}>
                <span className={styles.segmentIcon} title={isRecordingActive ? 'Recording' : 'Processing'}>
                  <Loader2 size={18} strokeWidth={2} className={styles.segmentProcessingSpinner} aria-hidden />
                </span>
                <div className={styles.segmentBody}>
                  <span className={styles.segmentName}>{isRecordingActive ? 'Recording segment' : 'Processing recording…'}</span>
                  <div className={styles.segmentMeta}>{isRecordingActive ? 'Capturing audio' : 'Generating segment'}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
