import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, GripVertical, Plus, Trash2, X } from 'lucide-react';
import {
  POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH,
  type CreatorPollResultsDto,
  type EpisodePollDto,
  type PollQuestion,
} from '@harborfm/shared';
import { getEpisodePoll, getEpisodePollResults, putEpisodePoll } from '../../api/polls';
import { UnsavedChangesConfirmDialog } from '../../components/UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import styles from './PollsDialog.module.css';

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function blankQuestion(type: PollQuestion['type']): PollQuestion {
  const base = { id: newId(), prompt: '', description: undefined as string | undefined };
  if (type === 'multiple_choice') {
    return {
      ...base,
      type: 'multiple_choice',
      options: [
        { id: newId(), label: 'Option 1' },
        { id: newId(), label: 'Option 2' },
      ],
    };
  }
  if (type === 'yes_no') return { ...base, type: 'yes_no' };
  return { ...base, type: 'short_answer', maxLength: POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH };
}

function SortableOptionRow({
  id,
  label,
  disabled,
  onChange,
  onRemove,
  canRemove,
}: {
  id: string;
  label: string;
  disabled: boolean;
  onChange: (label: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={styles.optionRow}>
      {!disabled && (
        <button
          type="button"
          className={styles.grip}
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
      )}
      <input
        className={styles.input}
        value={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Option label"
      />
      {!disabled && canRemove && (
        <button type="button" className={styles.iconBtn} onClick={onRemove} aria-label="Remove option">
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

export interface PollsDialogProps {
  episodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

type Tab = 'questions' | 'settings' | 'results';

type PollFormSnapshot = {
  enabled: boolean;
  startAt: string;
  endAt: string;
  requireEmail: boolean;
  publicResults: boolean;
  limitOneVotePerIp: boolean;
  questions: PollQuestion[];
};

function snapshotKey(s: PollFormSnapshot): string {
  return JSON.stringify(s);
}

export function PollsDialog({
  episodeId,
  open,
  onOpenChange,
  readOnly = false,
}: PollsDialogProps) {
  const [tab, setTab] = useState<Tab>('questions');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [requireEmail, setRequireEmail] = useState(false);
  const [publicResults, setPublicResults] = useState(false);
  const [limitOneVotePerIp, setLimitOneVotePerIp] = useState(false);
  const [questions, setQuestions] = useState<PollQuestion[]>([]);
  const [baseline, setBaseline] = useState<PollFormSnapshot | null>(null);
  const [results, setResults] = useState<CreatorPollResultsDto | null>(null);
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [resultsLoading, setResultsLoading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const currentSnapshot = useMemo<PollFormSnapshot>(
    () => ({
      enabled,
      startAt,
      endAt,
      requireEmail,
      publicResults,
      limitOneVotePerIp,
      questions,
    }),
    [enabled, startAt, endAt, requireEmail, publicResults, limitOneVotePerIp, questions],
  );

  const isDirty = useMemo(() => {
    if (readOnly || baseline == null) return false;
    return snapshotKey(currentSnapshot) !== snapshotKey(baseline);
  }, [readOnly, baseline, currentSnapshot]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const {
    confirmOpen,
    requestClose,
    onOpenChange: guardOnOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
  } = useDialogCloseGuard({ isDirty, onClose: close });

  const applyPoll = useCallback((poll: EpisodePollDto) => {
    const next: PollFormSnapshot = {
      enabled: Boolean(poll.enabled),
      startAt: poll.startAt ? toLocalInput(poll.startAt) : '',
      endAt: poll.endAt ? toLocalInput(poll.endAt) : '',
      requireEmail: Boolean(poll.requireEmail),
      publicResults: Boolean(poll.publicResults),
      limitOneVotePerIp: Boolean(poll.limitOneVotePerIp),
      questions: poll.questions ?? [],
    };
    setEnabled(next.enabled);
    setStartAt(next.startAt);
    setEndAt(next.endAt);
    setRequireEmail(next.requireEmail);
    setPublicResults(next.publicResults);
    setLimitOneVotePerIp(next.limitOneVotePerIp);
    setQuestions(next.questions);
    setBaseline(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTab('questions');
    setBaseline(null);
    getEpisodePoll(episodeId)
      .then((poll) => {
        if (!cancelled) applyPoll(poll);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load poll');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, episodeId, applyPoll]);

  useEffect(() => {
    if (!open || tab !== 'results') return;
    let cancelled = false;
    setResultsLoading(true);
    getEpisodePollResults(episodeId, verifiedFilter)
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch(() => {
        if (!cancelled) setResults(null);
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, episodeId, verifiedFilter]);

  async function handleSave() {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      for (const q of questions) {
        if (!q.prompt.trim()) throw new Error('Each question needs a prompt');
        if (q.type === 'multiple_choice') {
          if (q.options.length < 2) throw new Error('Multiple choice needs at least 2 options');
          if (q.options.some((o) => !o.label.trim())) throw new Error('Options cannot be empty');
        }
      }
      const saved = await putEpisodePoll(episodeId, {
        enabled,
        startAt: startAt ? new Date(startAt).toISOString() : null,
        endAt: endAt ? new Date(endAt).toISOString() : null,
        requireEmail,
        publicResults,
        limitOneVotePerIp,
        questions,
      });
      applyPoll(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function updateQuestion(id: string, patch: Partial<PollQuestion> | PollQuestion) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== id) return q;
        return { ...q, ...patch } as PollQuestion;
      }),
    );
  }

  function changeType(id: string, type: PollQuestion['type']) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== id) return q;
        const next = blankQuestion(type);
        return { ...next, id: q.id, prompt: q.prompt, description: q.description };
      }),
    );
  }

  function onOptionDragEnd(questionId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId || q.type !== 'multiple_choice') return q;
        const oldIndex = q.options.findIndex((o) => o.id === active.id);
        const newIndex = q.options.findIndex((o) => o.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return q;
        return { ...q, options: arrayMove(q.options, oldIndex, newIndex) };
      }),
    );
  }

  const questionCount = questions.length;
  void questionCount;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={guardOnOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.content}
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => {
              e.stopPropagation();
              dialogContentProps.onEscapeKeyDown(e);
            }}
            onPointerDownOutside={(e) => {
              e.preventDefault();
              dialogContentProps.onPointerDownOutside(e);
            }}
            onInteractOutside={(e) => {
              e.preventDefault();
              dialogContentProps.onInteractOutside(e);
            }}
          >
            <div className={styles.header}>
              <Dialog.Title className={styles.title}>Episode Poll</Dialog.Title>
              <button
                type="button"
                className={styles.closeBtn}
                aria-label="Close"
                disabled={saving}
                onClick={requestClose}
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.tabs} role="tablist">
              {(['questions', 'settings', 'results'] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? styles.tabActive : styles.tab}
                  onClick={() => setTab(t)}
                >
                  {t === 'questions' ? 'Questions' : t === 'settings' ? 'Settings' : 'Results'}
                </button>
              ))}
            </div>

          {error && <p className={styles.error}>{error}</p>}
          {loading ? (
            <p className={styles.muted}>Loading…</p>
          ) : (
            <div className={styles.body}>
              {tab === 'questions' && (
                <div className={styles.stack}>
                  {questions.map((q, qi) => (
                    <div key={q.id} className={styles.questionCard}>
                      <div className={styles.questionHeader}>
                        <span className={styles.muted}>Question {qi + 1}</span>
                        {!readOnly && (
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => setQuestions((prev) => prev.filter((x) => x.id !== q.id))}
                            aria-label="Remove question"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <div className={styles.label}>
                        Type
                        <div className={styles.typeToggle} role="group" aria-label="Question type">
                          {(
                            [
                              ['multiple_choice', 'Multiple choice'],
                              ['yes_no', 'Yes / No'],
                              ['short_answer', 'Short answer'],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              className={
                                q.type === value ? styles.typeToggleActive : styles.typeToggleBtn
                              }
                              disabled={readOnly}
                              aria-pressed={q.type === value}
                              onClick={() => {
                                if (q.type !== value) changeType(q.id, value);
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className={styles.label}>
                        Prompt
                        <input
                          className={styles.input}
                          value={q.prompt}
                          disabled={readOnly}
                          onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })}
                          placeholder="Ask a question…"
                        />
                      </label>
                      <label className={styles.label}>
                        Description (optional)
                        <textarea
                          className={styles.textarea}
                          value={q.description ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            updateQuestion(q.id, {
                              description: e.target.value || undefined,
                            })
                          }
                          rows={2}
                          placeholder="Extra context for voters"
                        />
                      </label>
                      {q.type === 'multiple_choice' && (
                        <div className={styles.optionsBlock}>
                          <p className={styles.muted}>Options (drag to reorder; keep ≤ 8)</p>
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(ev) => onOptionDragEnd(q.id, ev)}
                          >
                            <SortableContext
                              items={q.options.map((o) => o.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {q.options.map((o) => (
                                <SortableOptionRow
                                  key={o.id}
                                  id={o.id}
                                  label={o.label}
                                  disabled={readOnly}
                                  canRemove={q.options.length > 2}
                                  onChange={(label) =>
                                    updateQuestion(q.id, {
                                      options: q.options.map((opt) =>
                                        opt.id === o.id ? { ...opt, label } : opt,
                                      ),
                                    })
                                  }
                                  onRemove={() =>
                                    updateQuestion(q.id, {
                                      options: q.options.filter((opt) => opt.id !== o.id),
                                    })
                                  }
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                          {!readOnly && q.options.length < 12 && (
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={() =>
                                updateQuestion(q.id, {
                                  options: [
                                    ...q.options,
                                    { id: newId(), label: `Option ${q.options.length + 1}` },
                                  ],
                                })
                              }
                            >
                              <Plus size={14} /> Add option
                            </button>
                          )}
                        </div>
                      )}
                      {q.type === 'short_answer' && (
                        <label className={styles.label}>
                          Max length
                          <input
                            className={styles.input}
                            type="number"
                            min={1}
                            max={5000}
                            disabled={readOnly}
                            value={q.maxLength ?? POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH}
                            onChange={(e) =>
                              updateQuestion(q.id, {
                                maxLength: Number(e.target.value) || POLL_SHORT_ANSWER_DEFAULT_MAX_LENGTH,
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                  ))}
                  {!readOnly && (
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => setQuestions((prev) => [...prev, blankQuestion('multiple_choice')])}
                    >
                      <Plus size={14} /> Add question
                    </button>
                  )}
                </div>
              )}

              {tab === 'settings' && (
                <div className={styles.stack}>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={readOnly}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                    <span>Enable poll on public episode page</span>
                  </label>
                  <label className={styles.label}>
                    Start (optional)
                    <input
                      className={styles.input}
                      type="datetime-local"
                      value={startAt}
                      disabled={readOnly}
                      onChange={(e) => setStartAt(e.target.value)}
                    />
                  </label>
                  <label className={styles.label}>
                    End (optional)
                    <input
                      className={styles.input}
                      type="datetime-local"
                      value={endAt}
                      disabled={readOnly}
                      onChange={(e) => setEndAt(e.target.value)}
                    />
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={requireEmail}
                      disabled={readOnly}
                      onChange={(e) => setRequireEmail(e.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                    <span>Require email</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={publicResults}
                      disabled={readOnly}
                      onChange={(e) => setPublicResults(e.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                    <span>Allow public to see results</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={limitOneVotePerIp}
                      disabled={readOnly}
                      onChange={(e) => setLimitOneVotePerIp(e.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                    <span>Limit to one vote per IP</span>
                  </label>
                </div>
              )}

              {tab === 'results' && (
                <div className={styles.stack}>
                  {requireEmail && (
                    <label className={styles.label}>
                      Filter
                      <select
                        className={styles.select}
                        value={verifiedFilter}
                        onChange={(e) =>
                          setVerifiedFilter(e.target.value as 'all' | 'verified' | 'unverified')
                        }
                      >
                        <option value="all">All</option>
                        <option value="verified">Verified</option>
                        <option value="unverified">Unverified</option>
                      </select>
                    </label>
                  )}
                  {resultsLoading && <p className={styles.muted}>Loading results…</p>}
                  {!resultsLoading && results && (
                    <>
                      <p className={styles.muted}>
                        {results.totalSubmissions} submission
                        {results.totalSubmissions === 1 ? '' : 's'}
                      </p>
                      {results.questions.map((q) => (
                        <div key={q.questionId} className={styles.questionCard}>
                          <p className={styles.resultPrompt}>{q.prompt}</p>
                          {q.options && (
                            <ul className={styles.resultList}>
                              {q.options.map((o) => (
                                <li key={o.optionId}>
                                  <span>{o.label}</span>
                                  <span>
                                    {o.percent}% ({o.count})
                                  </span>
                                  <div className={styles.barTrack}>
                                    <div
                                      className={styles.barFill}
                                      style={{ width: `${o.percent}%` }}
                                    />
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                          {q.shortAnswers && (
                            <PaginatedShortAnswers answers={q.shortAnswers} />
                          )}
                        </div>
                      ))}
                      {requireEmail && results.emails.length > 0 && (
                        <SubmittedEmailsSection emails={results.emails} />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={requestClose}
              disabled={saving}
              aria-label="Cancel"
            >
              Cancel
            </button>
            {!readOnly && tab !== 'results' && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => void handleSave()}
                disabled={saving || loading || !isDirty}
              >
                {saving ? 'Saving…' : 'Save poll'}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <UnsavedChangesConfirmDialog
      open={confirmOpen}
      onOpenChange={handleConfirmOpenChange}
      onDiscard={handleDiscard}
    />
    </>
  );
}

const RESULTS_PAGE_SIZE = 10;

function usePagedSlice<T>(items: T[]) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / RESULTS_PAGE_SIZE) || 1);
  useEffect(() => {
    setPage(0);
  }, [items.length]);
  const safePage = Math.min(page, pageCount - 1);
  const slice = items.slice(safePage * RESULTS_PAGE_SIZE, (safePage + 1) * RESULTS_PAGE_SIZE);
  return {
    page: safePage,
    pageCount,
    slice,
    setPage,
    total: items.length,
  };
}

function ResultsPager({
  page,
  pageCount,
  total,
  onPageChange,
  label,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string;
}) {
  if (total <= RESULTS_PAGE_SIZE) return null;
  const start = page * RESULTS_PAGE_SIZE + 1;
  const end = Math.min(total, (page + 1) * RESULTS_PAGE_SIZE);
  return (
    <div className={styles.pager} aria-label={label}>
      <span className={styles.muted}>
        {start}–{end} of {total}
      </span>
      <div className={styles.pagerBtns}>
        <button
          type="button"
          className={styles.pagerBtn}
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className={styles.pagerBtn}
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function PaginatedShortAnswers({
  answers,
}: {
  answers: Array<{ text: string }>;
}) {
  const { page, pageCount, slice, setPage, total } = usePagedSlice(answers);

  if (total === 0) {
    return <p className={styles.muted}>No short answers yet</p>;
  }

  return (
    <div className={styles.pagedBlock}>
      <ul className={styles.shortList}>
        {slice.map((a, i) => (
          <li key={`${page}-${i}`}>
            <p>{a.text}</p>
          </li>
        ))}
      </ul>
      <ResultsPager
        page={page}
        pageCount={pageCount}
        total={total}
        onPageChange={setPage}
        label="Short answer pages"
      />
    </div>
  );
}

function SubmittedEmailsSection({
  emails,
}: {
  emails: Array<{ email: string; verified: boolean }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { page, pageCount, slice, setPage, total } = usePagedSlice(emails);

  return (
    <div className={styles.questionCard}>
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.resultPrompt}>Submitted Emails</span>
        <ChevronRight
          size={18}
          className={`${styles.sectionChevron} ${expanded ? styles.sectionChevronOpen : ''}`}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className={styles.pagedBlock}>
          <ul className={styles.emailList}>
            {slice.map((e) => (
              <li key={e.email}>
                {e.email}
                <span className={styles.muted}>
                  {e.verified ? ' · verified' : ' · unverified'}
                </span>
              </li>
            ))}
          </ul>
          <ResultsPager
            page={page}
            pageCount={pageCount}
            total={total}
            onPageChange={setPage}
            label="Submitted email pages"
          />
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
