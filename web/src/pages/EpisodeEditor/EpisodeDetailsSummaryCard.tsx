import { useState } from 'react';
import { Calendar, Lock, Settings, Share2, Users } from 'lucide-react';
import { ShareDialog } from '../../components/ShareDialog';
import styles from '../EpisodeEditor.module.css';

export interface EpisodeDetailsSummaryCardProps {
  title: string;
  status: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** Resolved URL for episode cover image (optional). */
  artworkUrl?: string | null;
  /** When undefined, Edit button is hidden (e.g. read-only user). */
  onEditClick?: () => void;
  /** When true, episode is subscriber-only. */
  subscriberOnly?: boolean;
  /** When set, a Share button is shown. */
  shareUrl?: string;
  shareTitle?: string;
  embedCode?: string;
  /** When set, a "Start Group Call" or "End Group Call" button is shown to the left of Edit Details. */
  onStartGroupCall?: () => void;
  /** When true, Start Group Call is shown but disabled (e.g. out of disk space). */
  startGroupCallDisabled?: boolean;
  /** Tooltip when startGroupCallDisabled (e.g. "You are out of disk space"). */
  startGroupCallDisabledMessage?: string;
  /** When true, the button shows "End Group Call" (host) or "Join Group Call" (collaborator). */
  isCallActive?: boolean;
  /** When host has call active but panel not in this tab, show "Join Group Call" to migrate panel here. */
  callPanelOpenInThisTab?: boolean;
  /** When host has call active but panel not in this tab, clicking migrates the call panel to this tab. */
  onOpenGroupCall?: () => void;
  /** When isCallActive and user is host, clicking triggers this (e.g. to show confirm dialog). */
  onEndGroupCall?: () => void;
  /** When isCallActive and user is collaborator, this URL opens the join call page. */
  callJoinUrl?: string | null;
  /** Open schedule / manage meeting dialog. */
  onScheduleMeeting?: () => void;
  /** When true, Schedule is disabled (already scheduled or at account cap). */
  scheduleMeetingDisabled?: boolean;
  scheduleMeetingDisabledMessage?: string;
  /** Label when a meeting exists (e.g. scheduled time). */
  scheduledMeetingLabel?: string | null;
  /** Start the scheduled meeting (separate from ad-hoc Start Group Call). */
  onStartMeeting?: () => void;
  startMeetingDisabled?: boolean;
  startMeetingDisabledMessage?: string;
}

export function EpisodeDetailsSummaryCard({
  title,
  status,
  seasonNumber,
  episodeNumber,
  artworkUrl,
  onEditClick,
  subscriberOnly,
  shareUrl,
  shareTitle,
  embedCode,
  onStartGroupCall,
  startGroupCallDisabled,
  startGroupCallDisabledMessage,
  isCallActive,
  callPanelOpenInThisTab = false,
  onOpenGroupCall,
  onEndGroupCall,
  callJoinUrl,
  onScheduleMeeting,
  scheduleMeetingDisabled,
  scheduleMeetingDisabledMessage,
  scheduledMeetingLabel,
  onStartMeeting,
  startMeetingDisabled,
  startMeetingDisabledMessage,
}: EpisodeDetailsSummaryCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const statusLabel = status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Draft';
  const statusBadgeClass =
    status === 'published'
      ? styles.detailsSummaryStatusBadgePublished
      : status === 'scheduled'
        ? styles.detailsSummaryStatusBadgeScheduled
        : styles.detailsSummaryStatusBadgeDraft;
  const metaParts: string[] = [];
  if (seasonNumber != null || episodeNumber != null) {
    metaParts.push(`S${seasonNumber ?? '?'} E${episodeNumber ?? '?'}`);
  }
  const isSubscriberOnly = subscriberOnly === true;
  const showStartCallBtn = !isCallActive && (onStartGroupCall != null || startGroupCallDisabled);
  const showJoinCallBtn = isCallActive && callJoinUrl;
  const showHostJoinCallBtn = isCallActive && onOpenGroupCall && !callPanelOpenInThisTab;
  const showMeetingPanel = onScheduleMeeting != null;
  const hasScheduledMeeting = !!scheduledMeetingLabel;
  const showStartMeetingBtn = !isCallActive && onStartMeeting != null;
  const hasCallAction =
    showStartCallBtn || onEndGroupCall != null || showJoinCallBtn || showHostJoinCallBtn;
  const hasHeaderActions = onEditClick != null || shareUrl != null || hasCallAction;

  return (
    <div
      className={
        isSubscriberOnly
          ? `${styles.detailsSummaryCard} ${styles.detailsSummaryCardSubscriberOnly}`
          : styles.detailsSummaryCard
      }
    >
      <div className={styles.detailsSummaryRow}>
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt={title ? `${title} cover` : 'Episode cover'}
            className={styles.detailsSummaryArtwork}
          />
        ) : null}
        <div className={styles.detailsSummaryMain}>
          <div className={styles.detailsSummaryTitleRow}>
            {isSubscriberOnly && (
              <Lock
                size={16}
                strokeWidth={2.5}
                className={styles.detailsSummaryTitleLock}
                aria-label="Subscriber only"
              />
            )}
            <h2 className={styles.detailsSummaryTitle}>{title || 'Untitled episode'}</h2>
          </div>
          <p className={styles.detailsSummaryMeta}>
            <span className={`${styles.detailsSummaryStatusBadge} ${statusBadgeClass}`}>
              {statusLabel}
            </span>
            {metaParts.length > 0 && <span>{metaParts.join(' · ')}</span>}
          </p>
        </div>
        {hasHeaderActions && (
          <div className={styles.detailsSummaryActions}>
            {hasCallAction &&
              (isCallActive && onEndGroupCall && callPanelOpenInThisTab ? (
                <button
                  type="button"
                  className={styles.detailsSummaryEndCallBtn}
                  onClick={onEndGroupCall}
                  aria-label="End group call"
                >
                  <Users size={16} strokeWidth={2} aria-hidden />
                  End Group Call
                </button>
              ) : showHostJoinCallBtn ? (
                <button
                  type="button"
                  className={styles.detailsSummaryJoinCallBtn}
                  onClick={onOpenGroupCall}
                  aria-label="Join group call"
                  title="Open call panel in this tab"
                >
                  <Users size={16} strokeWidth={2} aria-hidden />
                  Join Group Call
                </button>
              ) : showJoinCallBtn ? (
                <a
                  href={callJoinUrl!}
                  className={styles.detailsSummaryJoinCallBtn}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Join group call"
                  title="Join group call"
                >
                  <Users size={16} strokeWidth={2} aria-hidden />
                  Join Group Call
                </a>
              ) : showStartCallBtn ? (
                <button
                  type="button"
                  className={`${styles.detailsSummaryEditBtn} ${styles.detailsSummaryStartCallBtn}`}
                  onClick={startGroupCallDisabled ? undefined : onStartGroupCall}
                  disabled={startGroupCallDisabled}
                  title={startGroupCallDisabled ? startGroupCallDisabledMessage : undefined}
                  aria-label={
                    startGroupCallDisabled
                      ? `Start group call (${startGroupCallDisabledMessage ?? 'disabled'})`
                      : 'Start group call'
                  }
                >
                  <Users size={16} strokeWidth={2} aria-hidden />
                  Start Group Call
                </button>
              ) : null)}
            {onEditClick != null && (
              <button
                type="button"
                className={`${styles.detailsSummaryEditBtn} ${styles.detailsSummaryIconBtn}`}
                onClick={onEditClick}
                aria-label="Edit episode details"
                title="Edit episode details"
              >
                <Settings size={16} strokeWidth={2} aria-hidden />
              </button>
            )}
            {shareUrl != null && (
              <button
                type="button"
                className={`${styles.detailsSummaryShareBtn} ${styles.detailsSummaryIconBtn}`}
                onClick={() => setShareOpen(true)}
                aria-label="Share"
                title="Share"
              >
                <Share2 size={16} strokeWidth={2} aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>

      {showMeetingPanel && (
        <div
          className={
            hasScheduledMeeting
              ? `${styles.detailsSummaryMeetingPanel} ${styles.detailsSummaryMeetingPanelActive}`
              : styles.detailsSummaryMeetingPanel
          }
        >
          {hasScheduledMeeting ? (
            <>
              <div className={styles.detailsSummaryMeetingPanelCopy}>
                <p className={styles.detailsSummaryMeetingPanelEyebrow}>Meeting</p>
                <p className={styles.detailsSummaryMeetingPanelWhen}>{scheduledMeetingLabel}</p>
              </div>
              <div className={styles.detailsSummaryMeetingPanelActions}>
                {showStartMeetingBtn && (
                  <button
                    type="button"
                    className={styles.detailsSummaryMeetingStartBtn}
                    onClick={startMeetingDisabled ? undefined : onStartMeeting}
                    disabled={startMeetingDisabled}
                    title={
                      startMeetingDisabled
                        ? startMeetingDisabledMessage
                        : 'Start the scheduled meeting'
                    }
                    aria-label="Start meeting"
                  >
                    <Users size={16} strokeWidth={2} aria-hidden />
                    Start Meeting
                  </button>
                )}
                <button
                  type="button"
                  className={styles.detailsSummaryMeetingManageBtn}
                  onClick={onScheduleMeeting}
                  title="Manage scheduled meeting"
                  aria-label="Manage meeting"
                >
                  Manage
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.detailsSummaryMeetingPanelCopy}>
                <p className={styles.detailsSummaryMeetingPanelWhen}>Schedule a meeting</p>
              </div>
              <div className={styles.detailsSummaryMeetingPanelActions}>
                <button
                  type="button"
                  className={styles.detailsSummaryMeetingStartBtn}
                  onClick={scheduleMeetingDisabled ? undefined : onScheduleMeeting}
                  disabled={scheduleMeetingDisabled}
                  title={
                    scheduleMeetingDisabled
                      ? scheduleMeetingDisabledMessage
                      : 'Schedule a group call meeting'
                  }
                  aria-label="Schedule meeting"
                >
                  <Calendar size={16} strokeWidth={2} aria-hidden />
                  Schedule
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {shareUrl != null && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          url={shareUrl}
          title={shareTitle}
          embedCode={embedCode}
        />
      )}
    </div>
  );
}
