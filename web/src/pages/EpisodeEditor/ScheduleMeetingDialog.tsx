import { useEffect, useState } from 'react';
import { Check, Copy, Mail, Trash2, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelEpisodeMeeting,
  createEpisodeMeeting,
  createMeetingInvite,
  deleteMeetingInvite,
  getEpisodeMeeting,
  rescheduleEpisodeMeeting,
} from '../../api/call';
import editorStyles from '../EpisodeEditor.module.css';
import styles from './ScheduleMeetingDialog.module.css';

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isValidInviteEmail(value: string): boolean {
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function localInputToIso(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}

function toLocalInputValueFromDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function maxLocalInputValue(): string {
  return toLocalInputValueFromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

function minLocalInputValue(): string {
  return toLocalInputValueFromDate(new Date());
}

function isScheduleInPast(local: string): boolean {
  if (!local.trim()) return false;
  const ms = new Date(local).getTime();
  if (!Number.isFinite(ms)) return true;
  return ms < Date.now();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface ScheduleMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  /** Called after a meeting is created or cancelled so the parent can refresh. */
  onMeetingChanged?: () => void;
}

export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  episodeId,
  onMeetingChanged,
}: ScheduleMeetingDialogProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['call-meeting', episodeId],
    queryFn: () => getEpisodeMeeting(episodeId),
    enabled: open,
  });

  const meeting = data?.meeting ?? null;
  const atCap = data?.atMeetingCap === true;

  const [scheduleLocal, setScheduleLocal] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmCancelOpen(false);
      return;
    }
    setError(null);
    setInviteName('');
    setInviteEmail('');
    setCopiedKey(null);
    setConfirmCancelOpen(false);
    if (meeting?.scheduledStartAt) {
      setScheduleLocal(toLocalInputValue(meeting.scheduledStartAt));
    } else {
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      setScheduleLocal(toLocalInputValue(soon.toISOString()));
    }
  }, [open, meeting?.id, meeting?.scheduledStartAt]);

  const maxLocal = maxLocalInputValue();
  const minLocal = minLocalInputValue();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['call-meeting', episodeId] });
    onMeetingChanged?.();
  };

  const createMutation = useMutation({
    mutationFn: () => createEpisodeMeeting(episodeId, localInputToIso(scheduleLocal)),
    onSuccess: () => {
      invalidate();
      void refetch();
    },
    onError: (err: Error) => setError(err.message || 'Failed to schedule meeting'),
  });

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1600);
  };

  const saveSchedule = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!meeting) {
        await createMutation.mutateAsync();
      } else {
        await rescheduleEpisodeMeeting(meeting.id, localInputToIso(scheduleLocal));
        invalidate();
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save meeting');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!meeting) return;
    setError(null);
    setBusy(true);
    try {
      await cancelEpisodeMeeting(meeting.id);
      setConfirmCancelOpen(false);
      invalidate();
      onOpenChange(false);
    } catch (err) {
      setConfirmCancelOpen(false);
      setError(err instanceof Error ? err.message : 'Failed to cancel meeting');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailInvite = async () => {
    if (!meeting) return;
    const email = inviteEmail.trim();
    if (!isValidInviteEmail(email)) {
      setError('Enter a valid email to send an invite');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await createMeetingInvite(meeting.id, {
        name: inviteName.trim() || null,
        email,
      });
      setInviteName('');
      setInviteEmail('');
      invalidate();
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!meeting) return;
    setError(null);
    setBusy(true);
    try {
      const name = inviteName.trim();
      let url = meeting.joinUrl;
      if (name) {
        const res = await createMeetingInvite(meeting.id, { name, email: null });
        url = res.joinUrl;
        invalidate();
        await refetch();
        setInviteName('');
      }
      const ok = await copyText(url);
      if (ok) flashCopied('share');
      else setError('Could not copy link');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = async () => {
    if (!meeting) return;
    const ok = await copyText(meeting.joinCode);
    if (ok) flashCopied('code');
    else setError('Could not copy code');
  };

  const handleCopyPhone = async () => {
    if (!meeting?.dialInPhoneNumber) return;
    const ok = await copyText(meeting.dialInPhoneNumber);
    if (ok) flashCopied('phone');
    else setError('Could not copy phone number');
  };

  const handleCopyInvite = async (inviteId: string, url: string) => {
    const ok = await copyText(url);
    if (ok) flashCopied(`invite-${inviteId}`);
    else setError('Could not copy link');
  };

  const handleDeleteInvite = async (inviteId: string) => {
    if (!meeting) return;
    setBusy(true);
    try {
      await deleteMeetingInvite(meeting.id, inviteId);
      invalidate();
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove invite');
    } finally {
      setBusy(false);
    }
  };

  const isLive = meeting?.status === 'live';
  const scheduleDirty =
    !meeting ||
    (!!scheduleLocal &&
      !!meeting.scheduledStartAt &&
      scheduleLocal !== toLocalInputValue(meeting.scheduledStartAt));
  const scheduleInPast = isScheduleInPast(scheduleLocal);
  const canSchedule =
    !busy &&
    !!scheduleLocal &&
    !(!meeting && atCap) &&
    !isLive &&
    scheduleDirty &&
    !scheduleInPast;
  const canSendEmail = !busy && isValidInviteEmail(inviteEmail);
  const emailedInvites = (meeting?.invites ?? [])
    .filter((inv) => !!inv.email?.trim())
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const linkOnlyInvites = (meeting?.invites ?? [])
    .filter((inv) => !inv.email?.trim())
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const renderInviteRow = (inv: (typeof emailedInvites)[number], detail: string) => (
    <li key={inv.id} className={styles.inviteItem}>
      <div className={styles.inviteMeta}>
        <span className={styles.inviteName}>
          {inv.displayName?.trim() || inv.email?.trim() || 'Guest'}
        </span>
        <span className={styles.inviteDetail}>{detail}</span>
      </div>
      <div className={styles.inviteActions}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void handleCopyInvite(inv.id, inv.joinUrl)}
          aria-label="Copy invite link"
          title="Copy link"
        >
          {copiedKey === `invite-${inv.id}` ? (
            <Check size={16} aria-hidden />
          ) : (
            <Copy size={16} aria-hidden />
          )}
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void handleDeleteInvite(inv.id)}
          aria-label="Remove invite"
          title="Remove"
          disabled={busy}
        >
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
    </li>
  );

  return (
    <>
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>
              {meeting ? 'Meeting' : 'Schedule meeting'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.closeBtn} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Description className={styles.srOnly}>
            {meeting
              ? 'Manage the scheduled group call for this episode.'
              : 'Pick a start time for the group call.'}
          </Dialog.Description>

          <div className={styles.body}>
            {isLoading ? (
              <p className={styles.muted}>Loading...</p>
            ) : (
              <>
                {!meeting && atCap && (
                  <p className={styles.error} role="alert">
                    You&apos;ve hit the limit of {data?.maxActiveMeetingsPerUser ?? 50} scheduled meetings.
                  </p>
                )}

                <section className={styles.section}>
                  <label className={styles.label} htmlFor="meeting-start">
                    When
                  </label>
                  <input
                    id="meeting-start"
                    type="datetime-local"
                    className={styles.input}
                    value={scheduleLocal}
                    min={minLocal}
                    max={maxLocal}
                    onChange={(e) => setScheduleLocal(e.target.value)}
                    disabled={busy || (!meeting && atCap) || isLive}
                  />
                  {scheduleInPast && (
                    <p className={styles.error} role="alert">
                      Choose a time in the future.
                    </p>
                  )}
                </section>

                {meeting && (
                  <>
                    <section className={styles.section}>
                      <span className={styles.label}>Join code</span>
                      <div className={`${styles.codeRow} ${styles.codeRowCentered}`}>
                        <span className={styles.codeValue} data-testid="meeting-join-code">
                          {meeting.joinCode}
                        </span>
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          onClick={() => void handleCopyCode()}
                          disabled={busy}
                          aria-label="Copy join code"
                        >
                          {copiedKey === 'code' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                          {copiedKey === 'code' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </section>

                    {meeting.dialInEnabled && meeting.dialInPhoneNumber ? (
                      <section className={styles.section}>
                        <span className={styles.label}>Dial-in</span>
                        <div className={`${styles.codeRow} ${styles.codeRowCentered}`}>
                          <span className={styles.phoneValue} data-testid="meeting-dial-in">
                            {meeting.dialInPhoneNumber}
                          </span>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => void handleCopyPhone()}
                            disabled={busy}
                            aria-label="Copy dial-in number"
                          >
                            {copiedKey === 'phone' ? (
                              <Check size={16} aria-hidden />
                            ) : (
                              <Copy size={16} aria-hidden />
                            )}
                            {copiedKey === 'phone' ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </section>
                    ) : null}

                    <section className={styles.section}>
                      <span className={styles.label}>Invite</span>
                      <div className={styles.inviteFields}>
                        <input
                          id="meeting-invite-name"
                          type="text"
                          className={styles.input}
                          placeholder="Name"
                          value={inviteName}
                          onChange={(e) => setInviteName(e.target.value)}
                          disabled={busy}
                          aria-label="Invitee name"
                        />
                        <input
                          id="meeting-invite-email"
                          type="email"
                          className={styles.input}
                          placeholder="Email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          disabled={busy}
                          aria-label="Invitee email"
                        />
                      </div>
                      <div className={styles.inviteActionsRow}>
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={() => void handleCopyShareLink()}
                          disabled={busy}
                        >
                          {copiedKey === 'share' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                          {copiedKey === 'share' ? 'Copied' : 'Copy link'}
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={() => void handleEmailInvite()}
                          disabled={!canSendEmail}
                        >
                          <Mail size={16} aria-hidden />
                          Send email
                        </button>
                      </div>

                      {emailedInvites.length > 0 && (
                        <div className={styles.inviteGroup}>
                          <div className={styles.sectionLabelRow}>
                            <span className={styles.label}>Invited</span>
                            <span className={styles.meta}>{emailedInvites.length}</span>
                          </div>
                          <ul className={styles.inviteList} data-testid="meeting-emailed-invites">
                            {emailedInvites.map((inv) =>
                              renderInviteRow(
                                inv,
                                inv.displayName?.trim()
                                  ? inv.email!.trim()
                                  : 'Invited by email',
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                      {linkOnlyInvites.length > 0 && (
                        <div className={styles.inviteGroup}>
                          <span className={styles.label}>Shared links</span>
                          <ul className={styles.inviteList}>
                            {linkOnlyInvites.map((inv) =>
                              renderInviteRow(inv, 'Link only'),
                            )}
                          </ul>
                        </div>
                      )}

                      <div className={styles.dangerActions}>
                        <span className={styles.label}>Actions</span>
                        <button
                          type="button"
                          className={styles.dangerBtn}
                          onClick={() => setConfirmCancelOpen(true)}
                          disabled={busy}
                        >
                          Cancel meeting
                        </button>
                      </div>
                    </section>
                  </>
                )}

                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          {!isLoading && (
            <footer className={`${styles.footer}${meeting ? ` ${styles.footerSplit}` : ''}`}>
              {meeting ? (
                <>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => onOpenChange(false)}
                    disabled={busy}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void saveSchedule()}
                    disabled={!canSchedule}
                  >
                    Update
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => void saveSchedule()}
                  disabled={!canSchedule}
                >
                  Schedule
                </button>
              )}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <Dialog.Root
      open={confirmCancelOpen}
      onOpenChange={(o) => {
        if (!o && !busy) setConfirmCancelOpen(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={`${editorStyles.dialogOverlay} ${editorStyles.dialogOverlayOnModal}`}
        />
        <Dialog.Content
          className={`${editorStyles.dialogContent} ${editorStyles.dialogContentOnModal}`}
        >
          <div className={editorStyles.dialogHeaderRow}>
            <Dialog.Title className={editorStyles.dialogTitle}>Cancel meeting?</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={editorStyles.dialogClose}
                aria-label="Close"
                disabled={busy}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={editorStyles.dialogDescription}>
            Invited guests will be notified. This cannot be undone.
          </Dialog.Description>
          <div className={`${editorStyles.dialogActions} ${editorStyles.dialogActionsCancelLeft}`}>
            <Dialog.Close asChild>
              <button type="button" className={editorStyles.cancel} disabled={busy}>
                Keep meeting
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={editorStyles.dialogConfirmRemove}
              onClick={() => void handleCancel()}
              disabled={busy}
              aria-label="Confirm cancel meeting"
            >
              {busy ? 'Cancelling...' : 'Cancel meeting'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  );
}
