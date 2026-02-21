import { useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { me } from '../../api/auth';
import { setupStatus } from '../../api/setup';
import { submitReview } from '../../api/reviews';
import { ReviewStars } from './ReviewStars';
import { Captcha, type CaptchaHandle } from '../Captcha';
import styles from './ReviewSubmitModal.module.css';

const BODY_MIN_HEIGHT = 80;

export interface ReviewSubmitModalProps {
  open: boolean;
  onClose: () => void;
  podcastSlug: string;
  episodeSlug?: string;
  onSuccess?: () => void;
}

export function ReviewSubmitModal({
  open,
  onClose,
  podcastSlug,
  episodeSlug,
  onSuccess,
}: ReviewSubmitModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const captchaRef = useRef<CaptchaHandle>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  useAutoResizeTextarea(bodyRef, body, { minHeight: BODY_MIN_HEIGHT });

  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
    enabled: open,
  });

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const isLoggedIn = Boolean(meData?.user);

  const mutation = useMutation({
    mutationFn: async () => {
      let captchaToken: string | undefined;
      if (setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey) {
        captchaToken = await captchaRef.current?.getToken();
        if (!captchaToken?.trim()) throw new Error('Please complete the CAPTCHA.');
      }
      if (body.trim().length < 10) throw new Error('Review must be at least 10 characters.');
      if (!isLoggedIn && !email.trim()) throw new Error('Email is required when not signed in.');
      return submitReview({
        podcastSlug,
        ...(episodeSlug && { episodeSlug }),
        name: name.trim(),
        ...(!isLoggedIn && { email: email.trim() }),
        rating,
        body: body.trim(),
        captchaToken,
      });
    },
    onSuccess: () => {
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ['public-reviews', podcastSlug, episodeSlug] });
      // Keep modal open so user sees success message (and verification reminder if applicable)
    },
  });

  useEffect(() => {
    if (mutation.isError && bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [mutation.isError]);

  function handleClose() {
    onClose();
    mutation.reset();
    setName('');
    setEmail('');
    setRating(5);
    setBody('');
  }

  function handleOpenChange(openValue: boolean) {
    if (!openValue) handleClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} modal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
        <div className={styles.dialogHeader}>
          <Dialog.Title className={styles.title}>Write a review</Dialog.Title>
          <Dialog.Close asChild>
            <button type="button" className={styles.close} aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </Dialog.Close>
        </div>
        <div ref={bodyScrollRef} className={styles.bodyScroll}>
          {mutation.isSuccess ? (
            <div className={styles.success}>
              <p className={styles.successText}>
                {mutation.data?.verificationRequired
                  ? 'Thanks for submitting! Please check your email to verify your email before your review is posted.'
                  : 'Thanks for your review. It may appear after it’s approved.'}
              </p>
            </div>
          ) : (
            <form id="review-submit-form" onSubmit={handleSubmit} className={styles.form}>
              {mutation.isError && (
                <div className={styles.error}>
                  <p className={styles.errorText}>{mutation.error?.message}</p>
                </div>
              )}
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
              {!isLoggedIn && (
                <label className={styles.label}>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={styles.input}
                    required
                    maxLength={320}
                  />
                </label>
              )}
              <div className={styles.label}>
                <span>Rating</span>
                <ReviewStars rating={rating} onChange={setRating} size={28} />
              </div>
              <label className={styles.label}>
                Your review
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className={styles.input}
                  required
                  rows={2}
                  maxLength={5000}
                  style={{ resize: 'none', overflow: 'hidden' }}
                  placeholder="At least 10 characters"
                />
              </label>
              {setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey && (
                <Captcha
                  ref={captchaRef}
                  provider={setup.captchaProvider}
                  siteKey={setup.captchaSiteKey}
                  action="review"
                />
              )}
            </form>
          )}
        </div>
        <div className={styles.dialogFooter}>
          {mutation.isSuccess ? (
            <button type="button" className={styles.submit} onClick={handleClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className={styles.cancel} onClick={handleClose} aria-label="Cancel">
                Cancel
              </button>
              <button
                type="submit"
                form="review-submit-form"
                className={styles.submit}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Submitting...' : 'Submit review'}
              </button>
            </>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
