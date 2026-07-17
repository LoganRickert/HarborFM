import { useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { LlmChapterMarker } from '@harborfm/shared';
import { useAutoResizeTextarea } from '../../../hooks/useAutoResizeTextarea';
import styles from '../../../pages/EpisodeEditor.module.css';

export interface SegmentAskTabProps {
  askQuestion: string;
  onAskQuestionChange: (v: string) => void;
  onAskSubmit: (e: React.FormEvent) => void;
  askResponse: string | null;
  askError: string | null;
  isRateLimitMessage: (msg: string | null) => boolean;
  askMutationPending: boolean;
  onGenerateChapters: () => void;
  generateChaptersPending: boolean;
  generateChaptersError: string | null;
  hasTranscript: boolean;
  /** Non-null enters chapter review mode (hides Ask LLM form). */
  proposedChapters: LlmChapterMarker[] | null;
  onProposedChapterTitleChange: (index: number, title: string) => void;
  onProposedChapterDelete: (index: number) => void;
  onProposedChaptersCancel: () => void;
  onProposedChaptersInsert: () => void;
}

export function SegmentAskTab({
  askQuestion,
  onAskQuestionChange,
  onAskSubmit,
  askResponse,
  askError,
  isRateLimitMessage,
  askMutationPending,
  onGenerateChapters,
  generateChaptersPending,
  generateChaptersError,
  hasTranscript,
  proposedChapters,
  onProposedChapterTitleChange,
  onProposedChapterDelete,
  onProposedChaptersCancel,
  onProposedChaptersInsert,
}: SegmentAskTabProps) {
  const responseRef = useRef<HTMLTextAreaElement>(null);
  useAutoResizeTextarea(responseRef, askResponse ?? '', { minHeight: 80 });
  const busy = askMutationPending || generateChaptersPending;
  const reviewing = proposedChapters != null;

  if (reviewing) {
    const chapters = proposedChapters;
    return (
      <div className={styles.transcriptAsk}>
        <p className={styles.generateChaptersReviewIntro}>
          {chapters.length === 0
            ? 'No chapter markers were generated.'
            : `Review ${chapters.length} chapter marker${chapters.length === 1 ? '' : 's'} before inserting. Existing chapter markers will be replaced. Other markers are kept.`}
        </p>
        {chapters.length > 0 && (
          <div className={styles.generateChaptersTableWrap}>
            <table className={styles.chaptersTable}>
              <thead>
                <tr>
                  <th scope="col" className={styles.chaptersTableTimeCol}>
                    Start
                  </th>
                  <th scope="col">Chapter</th>
                  <th scope="col" className={styles.chaptersTableActionsCol} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {chapters.map((c, index) => (
                  <tr key={`${c.startSec}-${index}`}>
                    <td className={styles.chaptersTableTimeCol}>{c.start}</td>
                    <td className={styles.generateChaptersTitleCol}>
                      <input
                        type="text"
                        className={styles.generateChaptersTitleInput}
                        value={c.title}
                        onChange={(e) => onProposedChapterTitleChange(index, e.target.value)}
                        aria-label={`Chapter title at ${c.start}`}
                      />
                    </td>
                    <td className={styles.chaptersTableActionsCol}>
                      <div className={styles.chaptersTableActionsWrap}>
                        <button
                          type="button"
                          className={`${styles.chaptersTableActionBtn} ${styles.chaptersTableActionBtnDelete}`}
                          onClick={() => onProposedChapterDelete(index)}
                          aria-label={`Delete chapter at ${c.start}`}
                        >
                          <Trash2 size={16} strokeWidth={2} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
          <button
            type="button"
            className={styles.cancel}
            onClick={onProposedChaptersCancel}
            aria-label="Cancel chapter review"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.transcriptEditBtn}
            disabled={chapters.length === 0}
            onClick={onProposedChaptersInsert}
            aria-label="Insert chapter titles"
          >
            Insert Titles
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.transcriptAsk}>
      <form onSubmit={onAskSubmit} className={styles.transcriptAskForm}>
        <input
          type="text"
          className={styles.transcriptAskInput}
          placeholder="Ask something about this transcript..."
          value={askQuestion}
          onChange={(e) => onAskQuestionChange(e.target.value)}
          disabled={busy}
          aria-label="Question"
        />
        <button
          type="submit"
          className={styles.transcriptAskSubmit}
          disabled={busy || !askQuestion.trim()}
          aria-label="Submit question"
        >
          {askMutationPending ? '...' : 'Submit'}
        </button>
      </form>
      <button
        type="button"
        className={styles.transcriptEditBtn}
        onClick={onGenerateChapters}
        disabled={busy || !hasTranscript}
        aria-label="Generate AI Chapter Markers"
        style={{ width: '100%', marginTop: '0.75rem' }}
      >
        {generateChaptersPending ? 'Generating chapters…' : 'Generate AI Chapter Markers'}
      </button>
      {askError && (
        <p className={`${styles.error} ${isRateLimitMessage(askError) ? styles.rateLimitError : ''}`}>
          {askError}
        </p>
      )}
      {generateChaptersError && (
        <p
          className={`${styles.error} ${isRateLimitMessage(generateChaptersError) ? styles.rateLimitError : ''}`}
        >
          {generateChaptersError}
        </p>
      )}
      {askResponse != null && (
        <textarea
          ref={responseRef}
          readOnly
          className={styles.transcriptAskResponse}
          value={askResponse}
          aria-label="Answer"
          rows={4}
        />
      )}
    </div>
  );
}
