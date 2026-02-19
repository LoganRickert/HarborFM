import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { getCallByCode, getJoinInfo, getActiveSession } from '../api/call';
import type { ApiError } from '../api/client';
import { CallJoinHeader } from '../components/CallJoinHeader';
import { OtpInput } from '../components/OtpInput/OtpInput';
import styles from './CallJoinIndex.module.css';

export function CallJoinIndex() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlError = searchParams.get('error');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [alreadyConnected, setAlreadyConnected] = useState(false);
  const [alreadyConnectedEpisodeId, setAlreadyConnectedEpisodeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const displayError = error ?? urlError;

  useEffect(() => {
    setCode('');
    setError(null);
    setAlreadyConnected(false);
    setAlreadyConnectedEpisodeId(null);
    setSubmitting(false);
  }, []);

  const clearUrlError = () => {
    if (urlError) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('error');
        return next;
      }, { replace: true });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearUrlError();
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
      navigate(`/call/join/${res.token}`);
    } catch (err) {
      const status = (err as ApiError)?.status;
      const msg =
        status === 404
          ? 'No call found for this code'
          : status === 0 || (status && status >= 500)
            ? 'Connection failed. Try again.'
            : 'No call found for this code';
      setSubmitting(false);
      setError(msg);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('error', msg);
        return next;
      }, { replace: true });
    }
  };

  const handleCodeChange = (val: string) => {
    setCode(val);
    setError(null);
    setAlreadyConnected(false);
    setAlreadyConnectedEpisodeId(null);
    if (urlError) clearUrlError();
  };

  return (
    <div className={styles.page}>
      <CallJoinHeader />
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.header}>
            <Phone size={20} strokeWidth={2} aria-hidden />
            <h1 className={styles.title}>Join call</h1>
          </div>
          <p className={styles.description}>
            Enter the 4-digit code from the host&apos;s call panel.
          </p>
          <form onSubmit={handleSubmit} className={styles.form}>
            <OtpInput
              value={code}
              onChange={handleCodeChange}
              length={4}
              disabled={submitting}
              error={!!displayError}
              autoComplete="one-time-code"
              autoFocus
              ariaLabel="4-digit join code"
              ariaDescribedBy={displayError ? 'join-call-error' : undefined}
            />
            {alreadyConnected && (
              <div className={styles.infoCard} role="status">
                You&apos;re already connected.
                {alreadyConnectedEpisodeId && (
                  <>
                    {' '}
                    <Link to={`/episodes/${alreadyConnectedEpisodeId}`} className={styles.infoLink}>
                      Go to call
                    </Link>
                  </>
                )}
              </div>
            )}
            {displayError && (
              <div id="join-call-error" className={styles.errorCard} role="alert">
                {displayError}
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
    </div>
  );
}
