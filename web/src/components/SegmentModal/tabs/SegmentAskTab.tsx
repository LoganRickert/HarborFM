import { useRef } from 'react';
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
}

export function SegmentAskTab({
  askQuestion,
  onAskQuestionChange,
  onAskSubmit,
  askResponse,
  askError,
  isRateLimitMessage,
  askMutationPending,
}: SegmentAskTabProps) {
  const responseRef = useRef<HTMLTextAreaElement>(null);
  useAutoResizeTextarea(responseRef, askResponse ?? '', { minHeight: 80 });

  return (
    <div className={styles.transcriptAsk}>
      <form onSubmit={onAskSubmit} className={styles.transcriptAskForm}>
        <input
          type="text"
          className={styles.transcriptAskInput}
          placeholder="Ask something about this transcript..."
          value={askQuestion}
          onChange={(e) => onAskQuestionChange(e.target.value)}
          disabled={askMutationPending}
          aria-label="Question"
        />
        <button
          type="submit"
          className={styles.transcriptAskSubmit}
          disabled={askMutationPending || !askQuestion.trim()}
          aria-label="Submit question"
        >
          {askMutationPending ? '...' : 'Submit'}
        </button>
      </form>
      {askError && (
        <p className={`${styles.error} ${isRateLimitMessage(askError) ? styles.rateLimitError : ''}`}>
          {askError}
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
