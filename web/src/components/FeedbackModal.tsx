import { useState, useRef } from 'react';
import { useAutoResizeTextarea } from '../hooks/useAutoResizeTextarea';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { submitContact } from '../api/contact';
import { setupStatus } from '../api/setup';
import { Captcha, type CaptchaHandle } from './Captcha';
import styles from './FeedbackModal.module.css';

const MESSAGE_MIN_HEIGHT = 80;

export interface FeedbackModalContext {
  podcastSlug?: string;
  episodeSlug?: string;
  podcastTitle?: string;
  episodeTitle?: string;
}

export interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: FeedbackModalContext;
}

export function FeedbackModal({ open, onOpenChange, context }: FeedbackModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const captchaRef = useRef<CaptchaHandle>(null);

  useAutoResizeTextarea(messageRef, message, { minHeight: MESSAGE_MIN_HEIGHT });

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
      return submitContact({
        name,
        email,
        message,
        captchaToken,
        ...(context?.podcastSlug && { podcastSlug: context.podcastSlug }),
        ...(context?.episodeSlug && context?.podcastSlug && { episodeSlug: context.episodeSlug }),
      });
    },
  });

  function handleOpenChange(openValue: boolean) {
    onOpenChange(openValue);
    if (!openValue) {
      mutation.reset();
      setName('');
      setEmail('');
      setMessage('');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const contextLabel =
    context?.episodeTitle && context?.podcastTitle
      ? `${context.episodeTitle} - ${context.podcastTitle}`
      : context?.podcastTitle
        ? context.podcastTitle
        : null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} modal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
        <div className={styles.dialogHeader}>
          <div>
            <Dialog.Title className={styles.title}>Message</Dialog.Title>
            {contextLabel && <p className={styles.sub}>About: {contextLabel}</p>}
          </div>
          <Dialog.Close asChild>
            <button type="button" className={styles.close} aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </Dialog.Close>
        </div>
        <div className={styles.bodyScroll}>
          {mutation.isSuccess ? (
            <>
              <div className={styles.success}>
                <p className={styles.successText}>
                  Thanks for your message. We’ll get back to you as soon as we can.
                </p>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.submit} onClick={() => handleOpenChange(false)}>
                  Close
                </button>
              </div>
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
                  className={styles.input}
                  required
                  rows={2}
                  maxLength={10000}
                  style={{ resize: 'none', overflow: 'hidden' }}
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
                <div className={styles.error}>
                  <p className={styles.errorText}>{mutation.error?.message}</p>
                </div>
              )}
              <div className={styles.actions}>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={mutation.isPending}
                  aria-label="Send message"
                >
                  {mutation.isPending ? 'Sending...' : 'Send message'}
                </button>
              </div>
            </form>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
