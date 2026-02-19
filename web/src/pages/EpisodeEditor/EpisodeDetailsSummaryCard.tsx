import { useState } from 'react';
import { Lock, Settings, Share2, Users } from 'lucide-react';
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
  const showJoinCallBtn = isCallActive && callJoinUrl; /* collaborator: link to join */
  const showHostJoinCallBtn = isCallActive && onOpenGroupCall && !callPanelOpenInThisTab; /* host in other tab: button to migrate panel */
  const hasActions = onEditClick != null || shareUrl != null || showStartCallBtn || onEndGroupCall != null || showJoinCallBtn || showHostJoinCallBtn;

  return (
    <div className={isSubscriberOnly ? `${styles.detailsSummaryCard} ${styles.detailsSummaryCardSubscriberOnly}` : styles.detailsSummaryCard}>
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
              <Lock size={16} strokeWidth={2.5} className={styles.detailsSummaryTitleLock} aria-label="Subscriber only" />
            )}
            <h2 className={styles.detailsSummaryTitle}>{title || 'Untitled episode'}</h2>
          </div>
          <p className={styles.detailsSummaryMeta}>
            <span className={`${styles.detailsSummaryStatusBadge} ${statusBadgeClass}`}>{statusLabel}</span>
            {metaParts.length > 0 && <span>{metaParts.join(' · ')}</span>}
          </p>
        </div>
      </div>
      {hasActions && (
        <div className={styles.detailsSummaryActions}>
          {(showStartCallBtn || onEndGroupCall != null || showJoinCallBtn || showHostJoinCallBtn) && (
            isCallActive && onEndGroupCall && callPanelOpenInThisTab ? (
              <button type="button" className={styles.detailsSummaryEndCallBtn} onClick={onEndGroupCall} aria-label="End group call">
                <Users size={18} strokeWidth={2} aria-hidden />
                End Group Call
              </button>
            ) : showHostJoinCallBtn ? (
              <button type="button" className={styles.detailsSummaryJoinCallBtn} onClick={onOpenGroupCall} aria-label="Join group call" title="Open call panel in this tab">
                <Users size={18} strokeWidth={2} aria-hidden />
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
                <Users size={18} strokeWidth={2} aria-hidden />
                Join Group Call
              </a>
            ) : showStartCallBtn ? (
              <button
                type="button"
                className={`${styles.detailsSummaryEditBtn} ${styles.detailsSummaryStartCallBtn}`}
                onClick={startGroupCallDisabled ? undefined : onStartGroupCall}
                disabled={startGroupCallDisabled}
                title={startGroupCallDisabled ? startGroupCallDisabledMessage : undefined}
                aria-label={startGroupCallDisabled ? `Start group call (${startGroupCallDisabledMessage ?? 'disabled'})` : 'Start group call'}
              >
                <Users size={18} strokeWidth={2} aria-hidden />
                Start Group Call
              </button>
            ) : null
          )}
          {onEditClick != null && (
            <button type="button" className={styles.detailsSummaryEditBtn} onClick={onEditClick} aria-label="Edit episode details" title="Edit episode details">
              <Settings size={18} strokeWidth={2} aria-hidden />
            </button>
          )}
          {shareUrl != null && (
            <button
              type="button"
              className={styles.detailsSummaryShareBtn}
              onClick={() => setShareOpen(true)}
              aria-label="Share"
              title="Share"
            >
              <Share2 size={18} strokeWidth={2} aria-hidden />
            </button>
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
