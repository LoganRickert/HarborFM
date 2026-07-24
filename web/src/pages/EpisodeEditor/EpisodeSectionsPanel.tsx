import { useRef } from 'react';
import { Mic, Library, Loader2, Upload, FolderUp } from 'lucide-react';
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
  /** Upload a local audio file as a new recorded section. */
  onUploadAudioFile?: (file: File) => void;
  /** Upload a HarborFM segment project zip as a new section. */
  onUploadSegmentZip?: (file: File) => void;
  /** True while an audio or zip upload is in flight. */
  uploadBusy?: boolean;
  /** When true, disable "Record new section" (e.g. less than 5 MB free). */
  recordDisabled?: boolean;
  /** Shown when record is disabled. */
  recordDisabledMessage?: string;
  /** When true, user cannot add record, add library, or edit/delete/move segments. */
  readOnly?: boolean;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onManageRequest: (segmentId: string) => void;
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

function SectionsUploadActions({
  disabled,
  disabledTitle,
  onUploadAudioFile,
  onUploadSegmentZip,
  className,
}: {
  disabled: boolean;
  disabledTitle?: string;
  onUploadAudioFile?: (file: File) => void;
  onUploadSegmentZip?: (file: File) => void;
  className?: string;
}) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  if (!onUploadAudioFile && !onUploadSegmentZip) return null;

  return (
    <div className={className ? `${styles.sectionsUploadRow} ${className}` : styles.sectionsUploadRow}>
      {onUploadAudioFile ? (
        disabled ? (
          <span
            className={`${styles.sectionsUploadBtn} ${styles.sectionsUploadBtnDisabled}`}
            title={disabledTitle}
            aria-label="Upload audio file (disabled)"
          >
            <span className={styles.sectionsUploadBtnIcon} aria-hidden>
              <Upload size={18} strokeWidth={2} />
            </span>
            <span className={styles.sectionsUploadBtnText}>
              <span className={styles.sectionsUploadBtnLabel}>Upload Audio File</span>
              <span className={styles.sectionsUploadBtnHint}>MP3, WAV, M4A, and more</span>
            </span>
          </span>
        ) : (
          <button
            type="button"
            className={styles.sectionsUploadBtn}
            onClick={() => audioInputRef.current?.click()}
            aria-label="Upload audio file"
          >
            <span className={styles.sectionsUploadBtnIcon} aria-hidden>
              <Upload size={18} strokeWidth={2} />
            </span>
            <span className={styles.sectionsUploadBtnText}>
              <span className={styles.sectionsUploadBtnLabel}>Upload Audio File</span>
              <span className={styles.sectionsUploadBtnHint}>MP3, WAV, M4A, and more</span>
            </span>
          </button>
        )
      ) : null}
      {onUploadSegmentZip ? (
        disabled ? (
          <span
            className={`${styles.sectionsUploadBtn} ${styles.sectionsUploadBtnDisabled}`}
            title={disabledTitle}
            aria-label="Upload segment zip (disabled)"
          >
            <span className={styles.sectionsUploadBtnIcon} aria-hidden>
              <FolderUp size={18} strokeWidth={2} />
            </span>
            <span className={styles.sectionsUploadBtnText}>
              <span className={styles.sectionsUploadBtnLabel}>Upload Segment Zip</span>
              <span className={styles.sectionsUploadBtnHint}>HarborFM segment project</span>
            </span>
          </span>
        ) : (
          <button
            type="button"
            className={styles.sectionsUploadBtn}
            onClick={() => zipInputRef.current?.click()}
            aria-label="Upload segment zip"
          >
            <span className={styles.sectionsUploadBtnIcon} aria-hidden>
              <FolderUp size={18} strokeWidth={2} />
            </span>
            <span className={styles.sectionsUploadBtnText}>
              <span className={styles.sectionsUploadBtnLabel}>Upload Segment Zip</span>
              <span className={styles.sectionsUploadBtnHint}>HarborFM segment project</span>
            </span>
          </button>
        )
      ) : null}
      {onUploadAudioFile ? (
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/webm,audio/ogg,.mp3,.wav,.m4a,.webm,.ogg"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUploadAudioFile(file);
          }}
        />
      ) : null}
      {onUploadSegmentZip ? (
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUploadSegmentZip(file);
          }}
        />
      ) : null}
    </div>
  );
}

export function EpisodeSectionsPanel({
  episodeId,
  segments,
  segmentsLoading,
  processingSegmentIds = [],
  isRecordingActive = false,
  onAddRecord,
  onAddLibrary,
  onUploadAudioFile,
  onUploadSegmentZip,
  uploadBusy = false,
  recordDisabled = false,
  recordDisabledMessage,
  readOnly = false,
  onMoveUp,
  onMoveDown,
  onManageRequest,
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
  const uploadDisabled = readOnly || recordDisabled || uploadBusy;
  const uploadDisabledTitle = readOnly
    ? 'Read-only account'
    : recordDisabled
      ? (recordDisabledMessage ?? 'Not enough storage')
      : uploadBusy
        ? 'Upload in progress'
        : undefined;
  const showUploadActions = Boolean(onUploadAudioFile || onUploadSegmentZip) && !segmentsLoading;
  const hasVisibleSections = segments.length > 0 || processingSegmentIds.length > 0;

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
      ) : !hasVisibleSections ? (
        <div className={styles.sectionsEmptyCard}>
          <p className={styles.sectionsEmptyCopy}>
            No sections yet. Record or add from library above, or upload below.
          </p>
          {showUploadActions ? (
            <SectionsUploadActions
              disabled={uploadDisabled}
              disabledTitle={uploadDisabledTitle}
              onUploadAudioFile={onUploadAudioFile}
              onUploadSegmentZip={onUploadSegmentZip}
            />
          ) : null}
        </div>
      ) : (
        <>
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
                onManageRequest={() => onManageRequest(seg.id)}
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
                    <span className={styles.segmentName}>{isRecordingActive ? 'Recording segment' : 'Processing recording...'}</span>
                    <div className={styles.segmentMeta}>{isRecordingActive ? 'Capturing audio' : 'Generating segment'}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {showUploadActions ? (
            <SectionsUploadActions
              className={styles.sectionsUploadRowBelow}
              disabled={uploadDisabled}
              disabledTitle={uploadDisabledTitle}
              onUploadAudioFile={onUploadAudioFile}
              onUploadSegmentZip={onUploadSegmentZip}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
