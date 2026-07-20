import { useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { setupStatus } from '../api/setup';
import { signupEpisodeAlerts } from '../api/episodeAlerts';
import { Captcha, type CaptchaHandle } from './Captcha';
import { feedAccentCssVars } from '../utils/feedAccent';
import styles from './FeedbackModal.module.css';

export interface GetAlertsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podcastSlug: string;
  podcastTitle?: string;
  /** Podcast feed accent; applied as CSS vars so themes can style the dialog. */
  accent?: string | null;
}

export function GetAlertsModal({
  open,
  onOpenChange,
  podcastSlug,
  podcastTitle,
  accent,
}: GetAlertsModalProps) {
  const [email, setEmail] = useState('');
  const captchaRef = useRef<CaptchaHandle>(null);

  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      let captchaToken: string | undefined;
      if (setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey) {
        captchaToken = await captchaRef.current?.getToken();
        if (!captchaToken?.trim()) throw new Error('Please complete the CAPTCHA.');
      }
      return signupEpisodeAlerts(podcastSlug, { email, captchaToken });
    },
  });

  function handleOpenChange(openValue: boolean) {
    onOpenChange(openValue);
    if (!openValue) {
      mutation.reset();
      setEmail('');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} modal>
      <Dialog.Overlay className={styles.overlay} data-harborfm-dialog-overlay="alerts" />
      <Dialog.Content
        className={styles.dialog}
        aria-describedby={undefined}
        data-harborfm-dialog="alerts"
        style={feedAccentCssVars(accent)}
      >
        <div className={styles.dialogHeader}>
          <div>
            <Dialog.Title className={styles.title}>Get Alerts</Dialog.Title>
          </div>
          <Dialog.Close asChild>
            <button type="button" className={styles.close} aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </Dialog.Close>
        </div>
        <div className={styles.bodyScroll}>
          {podcastTitle && (
            <p className={styles.sub} style={{ marginBottom: '1rem' }}>
              Email alerts for {podcastTitle}
            </p>
          )}
          {mutation.isSuccess ? (
            <>
              <p className={styles.success}>
                Check your email to confirm your address.
              </p>
              <Dialog.Close asChild>
                <button type="button" className={styles.submit}>
                  Done
                </button>
              </Dialog.Close>
            </>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                Email
                <input
                  type="email"
                  className={styles.input}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              {setup?.captchaProvider &&
                setup.captchaProvider !== 'none' &&
                setup.captchaSiteKey && (
                  <Captcha
                    ref={captchaRef}
                    provider={setup.captchaProvider}
                    siteKey={setup.captchaSiteKey}
                  />
                )}
              {mutation.isError && (
                <p className={styles.error}>
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : 'Signup failed'}
                </p>
              )}
              <button
                type="submit"
                className={styles.submit}
                disabled={mutation.isPending || !email.trim()}
              >
                {mutation.isPending ? 'Sending…' : 'Subscribe'}
              </button>
            </form>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
