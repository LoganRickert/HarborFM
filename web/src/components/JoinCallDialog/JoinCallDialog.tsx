import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { X, Phone } from 'lucide-react';
import { getCallByCode, getJoinInfo, getActiveSession } from '../../api/call';
import type { ApiError } from '../../api/client';
import styles from './JoinCallDialog.module.css';

export interface JoinCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JoinCallDialog({ open, onOpenChange }: JoinCallDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [alreadyConnected, setAlreadyConnected] = useState(false);
  const [alreadyConnectedEpisodeId, setAlreadyConnectedEpisodeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      setAlreadyConnected(false);
      setAlreadyConnectedEpisodeId(null);
      setSubmitting(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.replace(/\D/g, '');
    if (trimmed.length !== 4) {
      setError('Enter a 4-digit code');
      return;
    }
    setError(null);
    setAlreadyConnected(false);
    setAlreadyConnectedEpisodeId(null);
    setSubmitting(true);
    try {
      const res = await getCallByCode(trimmed);
      let episodeId = res.episodeId;
      let isHost = !!res.alreadyConnected;
      if (!isHost && res.token) {
        try {
          const joinInfo = await getJoinInfo(res.token);
          episodeId = joinInfo.episode.id;
          const session = await getActiveSession(joinInfo.episode.id);
          isHost = !!session;
        } catch {
          /* auth or network; fall through to navigate */
        }
      }
      if (isHost) {
        setAlreadyConnected(true);
        setAlreadyConnectedEpisodeId(episodeId ?? null);
        setSubmitting(false);
        return;
      }
      onOpenChange(false);
      navigate(`/call/join/${res.token}`);
    } catch (err) {
      const status = (err as ApiError)?.status;
      if (status === 404) {
        setError('No call found for this code');
      } else if (status === 0 || (status && status >= 500)) {
        setError('Connection failed. Try again.');
      } else {
        setError('No call found for this code');
      }
      setSubmitting(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    setCode(val);
    setError(null);
    setAlreadyConnected(false);
    setAlreadyConnectedEpisodeId(null);
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={() => onOpenChange(false)}>
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-call-dialog-title"
      >
        <div className={styles.header}>
          <div className={styles.headerTitleRow}>
            <Phone size={18} strokeWidth={2} aria-hidden />
            <h3 id="join-call-dialog-title" className={styles.title}>
              Join call
            </h3>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <p className={styles.description}>
          Enter the 4-digit code from the host&apos;s call panel.
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={4}
            value={code}
            onChange={handleInputChange}
            className={styles.codeInput}
            placeholder="0000"
            aria-label="4-digit join code"
            aria-invalid={!!error}
            aria-describedby={error ? 'join-call-error' : undefined}
            disabled={submitting}
          />
          {alreadyConnected && (
            <div className={styles.infoCard} role="status">
              You&apos;re already connected.
              {alreadyConnectedEpisodeId && (
                <>
                  {' '}
                  <Link
                    to={`/episodes/${alreadyConnectedEpisodeId}`}
                    className={styles.infoLink}
                    onClick={() => onOpenChange(false)}
                  >
                    Go to call
                  </Link>
                </>
              )}
            </div>
          )}
          {error && (
            <div id="join-call-error" className={styles.errorCard} role="alert">
              {error}
            </div>
          )}
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={submitting || code.length !== 4}
          >
            {submitting ? 'Joining...' : 'Join'}
          </button>
        </form>
      </div>
    </div>
  );
}
