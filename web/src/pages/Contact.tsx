import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { me } from '../api/auth';
import { setupStatus } from '../api/setup';
import { submitContact } from '../api/contact';
import { getPublicPodcast, getPublicEpisode } from '../api/public';
import { Captcha, type CaptchaHandle } from '../components/Captcha';
import styles from './Auth.module.css';

const MESSAGE_MIN_HEIGHT = 80;

export function Contact() {
  const [searchParams] = useSearchParams();
  const podcastSlug = searchParams.get('podcast') ?? undefined;
  const episodeSlug = searchParams.get('episode') ?? undefined;

  const userFromStore = useAuthStore((s) => s.user);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const prefillDone = useRef(false);
  const captchaRef = useRef<CaptchaHandle>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const { data: podcast } = useQuery({
    queryKey: ['public-podcast', podcastSlug],
    queryFn: () => getPublicPodcast(podcastSlug!),
    enabled: !!podcastSlug,
    retry: false,
  });
  const { data: episode } = useQuery({
    queryKey: ['public-episode', podcastSlug, episodeSlug],
    queryFn: () => getPublicEpisode(podcastSlug!, episodeSlug!),
    enabled: !!podcastSlug && !!episodeSlug,
    retry: false,
  });

  const resizeMessage = useCallback(() => {
    const el = messageRef.current;
    if (!el) return;
    el.style.height = '0';
    const h = Math.max(el.scrollHeight, MESSAGE_MIN_HEIGHT);
    el.style.height = `${h}px`;
  }, []);

  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
  });

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const user = userFromStore ?? meData?.user;

  useEffect(() => {
    if (user?.email && !prefillDone.current) {
      setEmail(user.email);
      prefillDone.current = true;
    }
  }, [user?.email]);

  useEffect(() => {
    resizeMessage();
  }, [message, resizeMessage]);

  const mutation = useMutation({
    mutationFn: async () => {
      let captchaToken: string | undefined;
      if (setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey) {
        captchaToken = await captchaRef.current?.getToken();
        if (!captchaToken?.trim()) {
          throw new Error('Please complete the CAPTCHA.');
        }
      }
      return submitContact({
        name,
        email,
        message,
        captchaToken,
        ...(podcastSlug && { podcastSlug }),
        ...(episodeSlug && podcastSlug && { episodeSlug }),
      });
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const success = mutation.isSuccess;
  const contextLabel =
    episode && podcast
      ? `${episode.title} - ${podcast.title}`
      : podcast
        ? podcast.title
        : null;
  const contactQuery = [podcastSlug, episodeSlug].filter(Boolean).length
    ? `?${new URLSearchParams({ ...(podcastSlug && { podcast: podcastSlug }), ...(episodeSlug && { episode: episodeSlug }) }).toString()}`
    : '';

  return (
    <main>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <img src="/favicon.svg" alt="" className={styles.brandIcon} />
            <h1 className={styles.title}>HarborFM</h1>
          </div>
          <div className={styles.loginHeader}>
            <h2 className={styles.setupHeaderTitle}>
              {contextLabel ? 'Send feedback' : 'Contact'}
            </h2>
            {contextLabel && (
              <p className={styles.setupHeaderSub}>
                About: {contextLabel}
              </p>
            )}
          </div>
          {success ? (
            <>
              <div className={styles.verificationCardSuccess}>
                <p className={styles.verificationCardSuccessText}>Thanks for your message. We’ll get back to you as soon as we can.</p>
              </div>
              <p className={`${styles.footer} ${styles.footerLinks}`} style={{ marginTop: '1.5rem' }}>
                <Link to={`/contact${contactQuery}`} onClick={() => { mutation.reset(); setMessage(''); }}>Send another message</Link>
                <span className={styles.footerBelowCardSep} aria-hidden />
                <Link to={user ? '/' : '/login'}>{user ? 'Back to dashboard' : 'Sign in'}</Link>
              </p>
            </>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                Name
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={styles.input}
                  required
                  maxLength={200}
                />
              </label>
              <label className={styles.label}>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={styles.input}
                  required
                />
              </label>
              <label className={styles.label}>
                Message
                <textarea
                  ref={messageRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onInput={resizeMessage}
                  className={styles.input}
                  required
                  rows={2}
                  maxLength={10000}
                  style={{ resize: 'none', overflow: 'hidden', minHeight: MESSAGE_MIN_HEIGHT }}
                />
              </label>
              {setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey && (
                <Captcha
                  ref={captchaRef}
                  provider={setup.captchaProvider}
                  siteKey={setup.captchaSiteKey}
                  action="contact"
                />
              )}
              {mutation.isError && (
                <div className={styles.verificationCardError}>
                  <p className={styles.verificationCardErrorText}>{mutation.error?.message}</p>
                </div>
              )}
              <button
                type="submit"
                className={styles.submit}
                disabled={mutation.isPending}
                aria-label="Send message"
              >
                {mutation.isPending ? 'Sending...' : 'Send message'}
              </button>
            </form>
          )}
          {!success && (
            <p className={styles.footer} style={{ marginTop: '1.5rem' }}>
              <Link to={user ? '/' : '/login'}>{user ? 'Back to dashboard' : 'Back to sign in'}</Link>
            </p>
          )}
        </div>
        <p className={styles.footerBelowCard}>
          <Link to="/privacy">Privacy Policy</Link>
          <span className={styles.footerBelowCardSep} aria-hidden />
          <Link to="/terms">Terms of Service</Link>
          <span className={styles.footerBelowCardSep} aria-hidden />
          <Link to="/contact">Contact</Link>
        </p>
      </div>
    </main>
  );
}
