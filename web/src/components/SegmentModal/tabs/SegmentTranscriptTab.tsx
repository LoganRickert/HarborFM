import { Play, Pause, FileText, Trash2, Plus, Minus, RotateCcw } from 'lucide-react';
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
  onRestoreEntry?: (index: number) => void;
  isRateLimitMessage: (msg: string | null) => boolean;
  deleteMutationPending: boolean;
}

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
  onRestoreEntry,
  isRateLimitMessage,
  deleteMutationPending,
}: SegmentTranscriptTabProps) {
  if (loading) return <p>Loading...</p>;

  if (text != null) {
    return (
      <>
        {srtEntries ? (
          <>
            <div className={styles.transcriptCards}>
              {srtEntries.map((entry, i) => {
                const startSec = parseSrtTimeToSeconds(entry.start);
                const endSec = parseSrtTimeToSeconds(entry.end);
                const trimIndex = getTrimContainingEntry(startSec, endSec, trimRanges);
                const isTrimmed = trimIndex >= 0;

                return (
                  <div
                    key={i}
                    className={`${styles.transcriptCard} ${isTrimmed ? styles.transcriptCardTrimmed : ''}`}
                  >
                    <div className={styles.transcriptCardInner}>
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
                            onClick={() => onRestoreEntry(i)}
                            disabled={deleteMutationPending}
                            title="Restore this segment"
                            aria-label={`Restore transcript segment ${i + 1}`}
                          >
                            <RotateCcw size={20} aria-hidden />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={styles.transcriptCardBtn}
                              onClick={() => onPlayEntry(i, entry.start, entry.end)}
                              title={playingEntryIndex === i ? 'Pause' : 'Play'}
                              aria-label={
                                playingEntryIndex === i
                                  ? `Pause transcript segment ${i + 1}`
                                  : `Play transcript segment ${i + 1}`
                              }
                            >
                              {playingEntryIndex === i ? (
                                <Pause size={14} aria-hidden />
                              ) : (
                                <Play size={14} aria-hidden />
                              )}
                            </button>
                            <button
                              type="button"
                              className={`${styles.transcriptCardBtn} ${styles.transcriptCardBtnDelete}`}
                              onClick={() => onDeleteEntry(i)}
                              disabled={deleteMutationPending}
                              title="Delete this segment"
                              aria-label={`Delete transcript segment ${i + 1}`}
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {!isTrimmed && (
                      <div className={styles.transcriptCardFooter}>
                        <div className={styles.transcriptCardTimeControls}>
                          <div className={styles.transcriptCardTimeGroup}>
                            <div className={styles.transcriptCardTimeButtons}>
                              <button
                                type="button"
                                className={styles.transcriptCardTimeBtn}
                                onClick={() => onAdjustTime(i, true, -200)}
                                title="Subtract 200ms from start"
                                aria-label={`Subtract 200ms from start time of segment ${i + 1}`}
                              >
                                <Minus size={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className={styles.transcriptCardTimeBtn}
                                onClick={() => onAdjustTime(i, true, 200)}
                                title="Add 200ms to start"
                                aria-label={`Add 200ms to start time of segment ${i + 1}`}
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
                                onClick={() => onAdjustTime(i, false, -200)}
                                title="Subtract 200ms from end"
                                aria-label={`Subtract 200ms from end time of segment ${i + 1}`}
                              >
                                <Minus size={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className={styles.transcriptCardTimeBtn}
                                onClick={() => onAdjustTime(i, false, 200)}
                                title="Add 200ms to end"
                                aria-label={`Add 200ms to end time of segment ${i + 1}`}
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
              })}
            </div>
            <audio ref={transcriptAudioRef} style={{ display: 'none' }} />
          </>
        ) : (
          <pre className={styles.transcriptText}>{text || '(empty)'}</pre>
        )}
        {generateError && (
          <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
            {generateError}
          </p>
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
          <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
            {generateError}
          </p>
        )}
      </>
    );
  }

  if (generateError) {
    return (
      <p className={`${styles.error} ${isRateLimitMessage(generateError) ? styles.rateLimitError : ''}`}>
        {generateError}
      </p>
    );
  }

  return null;
}
