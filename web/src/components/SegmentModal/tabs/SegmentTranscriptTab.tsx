import { memo, useEffect, useRef, useState } from 'react';
import { Play, Pause, FileText, Trash2, Plus, Minus, RotateCcw, Pencil, Check, X } from 'lucide-react';
import styles from '../../../pages/EpisodeEditor.module.css';
import { formatSrtTime, parseSrtTimeToSeconds } from '../utils/srt';
import { getTrimContainingEntry } from '../utils/transcriptTrimUtils';

export interface SegmentTranscriptTabProps {
  text: string | null;
  loading: boolean;
  notFound: boolean;
  generateError: string | null;
  generating: boolean;
  srtEntries: Array<{ start: string; end: string; text: string }> | null;
  asrAvailable: boolean;
  ownerCanTranscribe: boolean;
  playingEntryIndex: number | null;
  transcriptAudioRef: React.RefObject<HTMLAudioElement | null>;
  trimRanges?: Array<[number, number]>;
  onGenerate: () => void;
  onDeleteEntry: (index: number) => void;
  onPlayEntry: (index: number, startTime: string, endTime: string) => void;
  onAdjustTime: (entryIndex: number, isStart: boolean, adjustMs: number) => void;
  onUpdateText: (entryIndex: number, newText: string) => void;
  onRestoreEntry?: (index: number) => void;
  isRateLimitMessage: (msg: string | null) => boolean;
  deleteMutationPending: boolean;
}

/** Uncontrolled editor so typing does not re-render the cue list. */
function TranscriptCueEditor({
  index,
  initialText,
  onSave,
  onCancel,
}: {
  index: number;
  initialText: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = editRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  function commit() {
    onSave(editRef.current?.value ?? '');
  }

  return (
    <>
      <textarea
        ref={editRef}
        className={styles.transcriptCardTextEdit}
        defaultValue={initialText}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
        rows={1}
        aria-label={`Edit transcript segment ${index + 1}`}
      />
      <div className={styles.transcriptCardActions}>
        <button
          type="button"
          className={styles.transcriptCardBtn}
          onClick={commit}
          title="Save"
          aria-label={`Save transcript segment ${index + 1}`}
        >
          <Check size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.transcriptCardBtn}
          onClick={onCancel}
          title="Cancel"
          aria-label={`Cancel editing transcript segment ${index + 1}`}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </>
  );
}

type CueCardProps = {
  index: number;
  entry: { start: string; end: string; text: string };
  isTrimmed: boolean;
  isEditing: boolean;
  isPlaying: boolean;
  deleteMutationPending: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveText: (value: string) => void;
  onDeleteEntry: () => void;
  onPlayEntry: () => void;
  onAdjustTime: (isStart: boolean, adjustMs: number) => void;
  onRestoreEntry?: () => void;
};

const TranscriptCueCard = memo(function TranscriptCueCard({
  index,
  entry,
  isTrimmed,
  isEditing,
  isPlaying,
  deleteMutationPending,
  onStartEdit,
  onCancelEdit,
  onSaveText,
  onDeleteEntry,
  onPlayEntry,
  onAdjustTime,
  onRestoreEntry,
}: CueCardProps) {
  return (
    <div
      className={`${styles.transcriptCard} ${isTrimmed ? styles.transcriptCardTrimmed : ''}`}
    >
      <div className={styles.transcriptCardInner}>
        {isEditing ? (
          <TranscriptCueEditor
            index={index}
            initialText={entry.text}
            onSave={onSaveText}
            onCancel={onCancelEdit}
          />
        ) : (
          <>
            <div
              className={`${styles.transcriptCardText} ${isTrimmed ? styles.transcriptCardTextTrimmed : ''}`}
            >
              {entry.text}
            </div>
            <div className={styles.transcriptCardActions}>
              {isTrimmed && onRestoreEntry ? (
                <button
                  type="button"
                  className={styles.transcriptCardRestoreBtn}
                  onClick={onRestoreEntry}
                  disabled={deleteMutationPending}
                  title="Restore this segment"
                  aria-label={`Restore transcript segment ${index + 1}`}
                >
                  <RotateCcw size={20} aria-hidden />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.transcriptCardBtn}
                    onClick={onPlayEntry}
                    title={isPlaying ? 'Pause' : 'Play'}
                    aria-label={
                      isPlaying
                        ? `Pause transcript segment ${index + 1}`
                        : `Play transcript segment ${index + 1}`
                    }
                  >
                    {isPlaying ? (
                      <Pause size={14} aria-hidden />
                    ) : (
                      <Play size={14} aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.transcriptCardBtn}
                    onClick={onStartEdit}
                    title="Edit text"
                    aria-label={`Edit transcript segment ${index + 1}`}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`${styles.transcriptCardBtn} ${styles.transcriptCardBtnDelete}`}
                    onClick={onDeleteEntry}
                    disabled={deleteMutationPending}
                    title="Delete this segment"
                    aria-label={`Delete transcript segment ${index + 1}`}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {!isTrimmed && (
        <div className={styles.transcriptCardFooter}>
          <div className={styles.transcriptCardTimeControls}>
            <div className={styles.transcriptCardTimeGroup}>
              <div className={styles.transcriptCardTimeButtons}>
                <button
                  type="button"
                  className={styles.transcriptCardTimeBtn}
                  onClick={() => onAdjustTime(true, -200)}
                  title="Subtract 200ms from start"
                  aria-label={`Subtract 200ms from start time of segment ${index + 1}`}
                  disabled={isEditing}
                >
                  <Minus size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.transcriptCardTimeBtn}
                  onClick={() => onAdjustTime(true, 200)}
                  title="Add 200ms to start"
                  aria-label={`Add 200ms to start time of segment ${index + 1}`}
                  disabled={isEditing}
                >
                  <Plus size={12} aria-hidden />
                </button>
              </div>
              <span className={styles.transcriptCardTimeLabel}>
                Start: {formatSrtTime(entry.start)}
              </span>
            </div>
            <div className={styles.transcriptCardTimeGroup}>
              <div className={styles.transcriptCardTimeButtons}>
                <button
                  type="button"
                  className={styles.transcriptCardTimeBtn}
                  onClick={() => onAdjustTime(false, -200)}
                  title="Subtract 200ms from end"
                  aria-label={`Subtract 200ms from end time of segment ${index + 1}`}
                  disabled={isEditing}
                >
                  <Minus size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.transcriptCardTimeBtn}
                  onClick={() => onAdjustTime(false, 200)}
                  title="Add 200ms to end"
                  aria-label={`Add 200ms to end time of segment ${index + 1}`}
                  disabled={isEditing}
                >
                  <Plus size={12} aria-hidden />
                </button>
              </div>
              <span className={styles.transcriptCardTimeLabel}>
                End: {formatSrtTime(entry.end)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export function SegmentTranscriptTab({
  text,
  loading,
  notFound,
  generateError,
  generating,
  srtEntries,
  asrAvailable,
  ownerCanTranscribe,
  playingEntryIndex,
  transcriptAudioRef,
  trimRanges = [],
  onGenerate,
  onDeleteEntry,
  onPlayEntry,
  onAdjustTime,
  onUpdateText,
  onRestoreEntry,
  isRateLimitMessage,
  deleteMutationPending,
}: SegmentTranscriptTabProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  if (loading) return <p>Loading...</p>;

  if (text != null) {
    const canRegenerate = asrAvailable && ownerCanTranscribe;
    return (
      <>
        <div className={styles.transcriptCardsToolbar}>
          <button
            type="button"
            className={styles.episodeTranscriptUploadBtn}
            onClick={onGenerate}
            disabled={generating || !canRegenerate}
            aria-label={
              generating ? 'Regenerating transcript' : 'Regenerate Transcript'
            }
          >
            <RotateCcw size={18} strokeWidth={2} aria-hidden />
            {generating ? 'Regenerating...' : 'Regenerate Transcript'}
          </button>
        </div>
        {generateError && (
          <p
            className={`${styles.error} ${styles.transcriptGenerateError} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}
            role="alert"
          >
            {generateError}
          </p>
        )}
        {srtEntries ? (
          <>
            <div className={styles.transcriptCards}>
              {srtEntries.map((entry, i) => {
                const startSec = parseSrtTimeToSeconds(entry.start);
                const endSec = parseSrtTimeToSeconds(entry.end);
                const trimIndex = getTrimContainingEntry(startSec, endSec, trimRanges);
                const isTrimmed = trimIndex >= 0;
                return (
                  <TranscriptCueCard
                    key={i}
                    index={i}
                    entry={entry}
                    isTrimmed={isTrimmed}
                    isEditing={editingIndex === i}
                    isPlaying={playingEntryIndex === i}
                    deleteMutationPending={deleteMutationPending}
                    onStartEdit={() => setEditingIndex(i)}
                    onCancelEdit={() => setEditingIndex(null)}
                    onSaveText={(value) => {
                      onUpdateText(i, value);
                      setEditingIndex(null);
                    }}
                    onDeleteEntry={() => onDeleteEntry(i)}
                    onPlayEntry={() => onPlayEntry(i, entry.start, entry.end)}
                    onAdjustTime={(isStart, adjustMs) => onAdjustTime(i, isStart, adjustMs)}
                    onRestoreEntry={
                      onRestoreEntry ? () => onRestoreEntry(i) : undefined
                    }
                  />
                );
              })}
            </div>
            <audio ref={transcriptAudioRef} style={{ display: 'none' }} />
          </>
        ) : (
          <pre className={styles.transcriptText}>{text || '(empty)'}</pre>
        )}
      </>
    );
  }

  if (notFound && asrAvailable) {
    return (
      <>
        <button
          type="button"
          className={`${styles.addSectionChoiceBtn} ${styles.addSectionChoiceBtnPrimary} ${styles.transcriptGenerateBtn}`}
          onClick={onGenerate}
          disabled={generating || !ownerCanTranscribe}
          aria-label={generating ? 'Generating transcript' : 'Generate transcript'}
        >
          <FileText size={24} strokeWidth={2} aria-hidden />
          <span>{generating ? 'Generating...' : 'Generate transcript'}</span>
        </button>
        {generateError && (
          <p
            className={`${styles.error} ${styles.transcriptGenerateError} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}
            role="alert"
          >
            {generateError}
          </p>
        )}
      </>
    );
  }

  if (generateError) {
    return (
      <p
        className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}
        role="alert"
      >
        {generateError}
      </p>
    );
  }

  return null;
}
