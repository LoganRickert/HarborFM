import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import {
  completePublicStripeCheckout,
  getPublicPodcast,
  getPublicPodcastArtworkUrl,
  type PublicPodcast,
} from '../api/public';
import { useSubscriberAuth } from '../hooks/useSubscriberAuth';
import { FullPageLoading } from '../components/Loading';
import styles from './SubscribeSuccess.module.css';

/** Survives React Strict Mode remounts; cleared on full page refresh. */
const claimedTokensBySession = new Map<string, string>();

export function SubscribeSuccess() {
  const { podcastSlug = '' } = useParams<{ podcastSlug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get('session_id') ?? '';
  const { checkStatus } = useSubscriberAuth();
  const [podcast, setPodcast] = useState<PublicPodcast | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedRss, setCopiedRss] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!podcastSlug) {
        setError('Missing checkout session.');
        setLoading(false);
        return;
      }
      if (!sessionId) {
        // After first claim we strip session_id; refresh lands here without secrets.
        try {
          const show = await getPublicPodcast(podcastSlug);
          if (!cancelled) setPodcast(show);
        } catch {
          /* ignore */
        }
        if (!cancelled) {
          setAlreadyClaimed(true);
          setLoading(false);
        }
        return;
      }
      try {
        const [result, show] = await Promise.all([
          completePublicStripeCheckout(podcastSlug, sessionId),
          getPublicPodcast(podcastSlug).catch(() => null),
        ]);
        if (result.token) {
          claimedTokensBySession.set(sessionId, result.token);
        }
        if (cancelled) return;
        setPodcast(show);
        const cached = claimedTokensBySession.get(sessionId) ?? null;
        if (cached) {
          setToken(cached);
          setAlreadyClaimed(false);
          navigate(
            `/feed/${encodeURIComponent(podcastSlug)}/subscribe/success`,
            { replace: true },
          );
        } else {
          setToken(null);
          setAlreadyClaimed(true);
        }
        await checkStatus();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not complete subscription');
        try {
          const show = await getPublicPodcast(podcastSlug);
          if (!cancelled) setPodcast(show);
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [podcastSlug, sessionId, checkStatus, navigate]);

  if (loading) return <FullPageLoading />;

  const privateRssUrl = token
    ? `${window.location.origin}/api/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(token)}/rss`
    : null;
  const artworkUrl = podcast ? getPublicPodcastArtworkUrl(podcast) : null;
  const podcastTitle = podcast?.title?.trim() || podcastSlug;
  const successTitle = `You are subscribed to ${podcastTitle}!`;
  const showSecrets = Boolean(token && privateRssUrl && !error);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt={podcastTitle}
            className={styles.artwork}
          />
        ) : null}
        <h1 className={styles.title}>
          {error ? 'Subscription incomplete' : successTitle}
        </h1>
        {error ? (
          <p className={styles.body}>{error}</p>
        ) : showSecrets ? (
          <>
            <p className={styles.body}>
              Save these somewhere safe. You will need them for private RSS, and you will not
              see them in full again after you leave this page.
            </p>
            <div className={styles.secrets}>
              <div className={styles.secretBox}>
                <p className={styles.secretLabel}>Private RSS feed</p>
                <code className={styles.secretValue}>{privateRssUrl}</code>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => {
                    void navigator.clipboard.writeText(privateRssUrl!).then(() => {
                      setCopiedRss(true);
                      setTimeout(() => setCopiedRss(false), 2000);
                    });
                  }}
                >
                  {copiedRss ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                  {copiedRss ? 'Copied' : 'Copy RSS Feed'}
                </button>
              </div>
              <div className={styles.secretBox}>
                <p className={styles.secretLabel}>Access token</p>
                <code className={styles.secretValue}>{token}</code>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => {
                    void navigator.clipboard.writeText(token!).then(() => {
                      setCopiedToken(true);
                      setTimeout(() => setCopiedToken(false), 2000);
                    });
                  }}
                >
                  {copiedToken ? (
                    <Check size={16} aria-hidden />
                  ) : (
                    <Copy size={16} aria-hidden />
                  )}
                  {copiedToken ? 'Copied' : 'Copy Token'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className={styles.body}>
            {alreadyClaimed
              ? 'Your subscription is active. Use email recovery in the Manage Subscription on the show page if you need your private RSS feed or access token again.'
              : 'Your subscription is active.'}
          </p>
        )}
        <Link className={styles.link} to={`/feed/${encodeURIComponent(podcastSlug)}`}>
          Back to show
        </Link>
      </div>
    </div>
  );
}
