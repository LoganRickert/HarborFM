import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleAlert } from 'lucide-react';
import {
  POLL_NO_OPTION_ID,
  POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH,
  POLL_YES_OPTION_ID,
  type PollQuestion,
  type PublicPollDto,
  type PublicPollResultsDto,
} from '@harborfm/shared';
import { setupStatus } from '../../../api/setup';
import {
  getPublicPoll,
  getPublicPollResults,
  votePublicPoll,
} from '../../../api/polls';
import { Captcha, type CaptchaHandle } from '../../Captcha';
import styles from './FeedEpisodePoll.module.css';

export interface FeedEpisodePollProps {
  podcastSlug: string;
  episodeSlug: string;
}

type AnswersState = Record<string, { optionId?: string; textValue?: string }>;

export function FeedEpisodePoll({ podcastSlug, episodeSlug }: FeedEpisodePollProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [poll, setPoll] = useState<PublicPollDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [answers, setAnswers] = useState<AnswersState>({});
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<PublicPollResultsDto | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [captchaSolved, setCaptchaSolved] = useState(false);
  const captchaRef = useRef<CaptchaHandle>(null);

  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    retry: false,
    staleTime: 10_000,
  });

  useEffect(() => {
    let cancelled = false;
    getPublicPoll(podcastSlug, episodeSlug)
      .then((p) => {
        if (cancelled) return;
        setPoll(p);
        if (p.alreadyVoted && p.publicResults) {
          void getPublicPollResults(podcastSlug, episodeSlug)
            .then((r) => {
              if (!cancelled) setResults(r);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPoll(null);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [podcastSlug, episodeSlug]);

  const resultQuestions = useMemo(
    () =>
      (results?.questions ?? []).filter(
        (q) => q.type === 'multiple_choice' || q.type === 'yes_no',
      ),
    [results?.questions],
  );

  if (loadError || !poll) return null;
  if (poll.alreadyVoted && !poll.publicResults) return null;
  if (poll.questions.length === 0) return null;

  const showForm = !results && !poll.alreadyVoted;
  const captchaRequired = Boolean(
    setup?.captchaProvider &&
      setup.captchaProvider !== 'none' &&
      setup.captchaSiteKey &&
      setup.captchaProvider !== 'recaptcha_v3',
  );
  const emailReady = !poll.requireEmail || Boolean(email.trim());
  const captchaReady = !captchaRequired || captchaSolved;
  const allQuestionsAnswered = poll.questions.every((q) => {
    const a = answers[q.id];
    if (q.type === 'short_answer') return Boolean((a?.textValue ?? '').trim());
    return Boolean(a?.optionId);
  });
  const canSubmit = allQuestionsAnswered && emailReady && captchaReady && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!poll) return;
    setError(null);
    setSubmitting(true);
    try {
      for (const q of poll.questions) {
        const a = answers[q.id];
        if (q.type === 'short_answer') {
          const text = (a?.textValue ?? '').trim();
          if (!text) throw new Error('Please answer all questions');
          const max = q.maxLength ?? POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH;
          if (text.length > max) throw new Error(`Answer too long (max ${max})`);
        } else if (!a?.optionId) {
          throw new Error('Please answer all questions');
        }
      }
      if (poll.requireEmail && !email.trim()) {
        throw new Error('Email is required');
      }
      let captchaToken: string | undefined;
      if (setup?.captchaProvider && setup.captchaProvider !== 'none' && setup.captchaSiteKey) {
        captchaToken = await captchaRef.current?.getToken();
        if (!captchaToken?.trim()) throw new Error('Please complete the CAPTCHA.');
      }
      const payloadAnswers = poll.questions.map((q) => {
        const a = answers[q.id] ?? {};
        if (q.type === 'short_answer') {
          return { questionId: q.id, textValue: (a.textValue ?? '').trim() };
        }
        return { questionId: q.id, optionId: a.optionId };
      });
      const res = await votePublicPoll(podcastSlug, episodeSlug, {
        answers: payloadAnswers,
        ...(poll.requireEmail ? { email: email.trim() } : {}),
        captchaToken,
      });
      setVerificationRequired(Boolean(res.verificationRequired));
      setPoll((p) => (p ? { ...p, alreadyVoted: true } : p));
      if (res.results) setResults(res.results);
      else if (poll.publicResults) {
        const r = await getPublicPollResults(podcastSlug, episodeSlug);
        setResults(r);
      } else {
        setPoll(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleViewResults() {
    setError(null);
    try {
      const r = await getPublicPollResults(podcastSlug, episodeSlug);
      setResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Results unavailable');
    }
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.toggleLabel}>Poll</span>
        <ChevronRight
          size={22}
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
        />
      </button>
      <div
        id={panelId}
        className={`${styles.panel} ${expanded ? styles.panelOpen : ''}`}
        hidden={!expanded}
      >
        <div className={styles.panelInner}>
          {results ? (
            <div className={styles.results}>
              {resultQuestions.map((q, i) => (
                <div key={q.questionId} className={styles.question}>
                  <p className={styles.prompt}>
                    <span className={styles.questionNumber}>{i + 1}.</span> {q.prompt}
                  </p>
                  {q.options && (
                    <ul className={styles.optionResults}>
                      {q.options.map((o) => (
                        <li key={o.optionId}>
                          <div className={styles.optionMeta}>
                            <span>{o.label}</span>
                            <span>{o.percent}%</span>
                          </div>
                          <div className={styles.barTrack}>
                            <div className={styles.barFill} style={{ width: `${o.percent}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {verificationRequired && (
                <p className={styles.muted}>
                  Check your email to verify your response.
                </p>
              )}
              {!poll.alreadyVoted && (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => {
                      setResults(null);
                      setError(null);
                    }}
                  >
                    Submit a vote
                  </button>
                </div>
              )}
            </div>
          ) : showForm ? (
            <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
              {poll.questions.map((q, i) => (
                <QuestionFields
                  key={q.id}
                  index={i}
                  question={q}
                  value={answers[q.id]}
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                />
              ))}
              {poll.requireEmail && (
                <label className={styles.field}>
                  Email
                  <input
                    type="email"
                    className={styles.input}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </label>
              )}
              {setup?.captchaProvider &&
                setup.captchaProvider !== 'none' &&
                setup.captchaSiteKey && (
                  <Captcha
                    ref={captchaRef}
                    provider={setup.captchaProvider}
                    siteKey={setup.captchaSiteKey}
                    action="poll"
                    onSolvedChange={setCaptchaSolved}
                  />
                )}
              {error && (
                <div className={styles.errorCard} role="alert">
                  <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
                  <p className={styles.errorCardMessage}>{error}</p>
                </div>
              )}
              <div className={styles.actions}>
                <button type="submit" className={styles.primaryBtn} disabled={!canSubmit}>
                  {submitting ? 'Submitting…' : 'Submit Vote'}
                </button>
                {poll.publicResults && (
                  <button type="button" className={styles.secondaryBtn} onClick={() => void handleViewResults()}>
                    View Results
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className={styles.results}>
              <p className={styles.muted}>Thanks for voting.</p>
              {poll.publicResults && (
                <button type="button" className={styles.secondaryBtn} onClick={() => void handleViewResults()}>
                  View results
                </button>
              )}
              {error && (
                <div className={styles.errorCard} role="alert">
                  <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
                  <p className={styles.errorCardMessage}>{error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionFields({
  index,
  question,
  value,
  onChange,
}: {
  index: number;
  question: PollQuestion;
  value?: { optionId?: string; textValue?: string };
  onChange: (v: { optionId?: string; textValue?: string }) => void;
}) {
  const promptId = useId();
  const options =
    question.type === 'multiple_choice'
      ? question.options
      : question.type === 'yes_no'
        ? [
            { id: POLL_YES_OPTION_ID, label: 'Yes' },
            { id: POLL_NO_OPTION_ID, label: 'No' },
          ]
        : [];

  return (
    <div className={styles.question}>
      <p className={styles.prompt} id={promptId}>
        <span className={styles.questionNumber}>{index + 1}.</span> {question.prompt}
      </p>
      {question.description && <p className={styles.description}>{question.description}</p>}
      {question.type === 'short_answer' ? (
        <textarea
          className={styles.textarea}
          value={value?.textValue ?? ''}
          maxLength={question.maxLength ?? POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH}
          onChange={(e) => onChange({ textValue: e.target.value })}
          rows={3}
          required
          aria-labelledby={promptId}
        />
      ) : (
        <div
          className={styles.options}
          role="radiogroup"
          aria-labelledby={promptId}
        >
          {options.map((o) => {
            const selected = value?.optionId === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? styles.optionSelected : styles.option}
                onClick={() => onChange({ optionId: o.id })}
              >
                <span className={styles.optionLabel}>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
