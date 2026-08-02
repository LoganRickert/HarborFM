import { useState } from 'react';
import {
  approveEpisodeGuestReview,
  submitEpisodeGuestReviewFeedback,
} from '../../api/episodeGuestReview';
import styles from './EpisodeGuestReviewBar.module.css';

type Props = {
  token: string;
  displayName: string | null;
  status: string;
  onStatusChange: (status: string) => void;
};

export function EpisodeGuestReviewBar({
  token,
  displayName,
  status,
  onStatusChange,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');

  const greeting = displayName?.trim()
    ? `Hi ${displayName.trim()}`
    : 'Review this episode';

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await approveEpisodeGuestReview(token);
      onStatusChange('approved');
      setShowFeedback(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve');
    } finally {
      setBusy(false);
    }
  }

  async function handleFeedbackSubmit() {
    const message = feedback.trim();
    if (!message) {
      setError('Enter feedback before sending');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitEpisodeGuestReviewFeedback(token, message);
      onStatusChange('feedback');
      setShowFeedback(false);
      setFeedback('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send feedback');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.bar}
      role="region"
      aria-label="Episode review"
    >
      <div className={styles.inner}>
        <div className={styles.header}>
          <p className={styles.title}>{greeting}</p>
          {status === 'approved' ? (
            <p className={styles.status}>You approved this episode.</p>
          ) : status === 'feedback' ? (
            <p className={styles.status}>Your feedback was sent to the host.</p>
          ) : (
            <p className={styles.subtitle}>
              Preview the episode, then approve it or leave feedback for the host.
            </p>
          )}
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>

        {showFeedback ? (
          <div className={styles.feedbackForm}>
            <label className={styles.visuallyHidden} htmlFor="guest-review-feedback">
              Feedback
            </label>
            <textarea
              id="guest-review-feedback"
              className={styles.textarea}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Share your feedback..."
              maxLength={5000}
              disabled={busy}
            />
            <div className={styles.feedbackActions}>
              <button
                type="button"
                className={styles.cancelFeedback}
                onClick={() => {
                  setShowFeedback(false);
                  setError(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.submitFeedback}
                onClick={() => void handleFeedbackSubmit()}
                disabled={busy}
              >
                {busy ? 'Sending...' : 'Send feedback'}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.approve}
              onClick={() => void handleApprove()}
              disabled={busy || status === 'approved'}
            >
              {busy ? 'Working...' : status === 'approved' ? 'Approved' : 'Approve'}
            </button>
            <button
              type="button"
              className={styles.feedback}
              onClick={() => {
                setShowFeedback(true);
                setError(null);
              }}
              disabled={busy}
            >
              Give feedback
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
