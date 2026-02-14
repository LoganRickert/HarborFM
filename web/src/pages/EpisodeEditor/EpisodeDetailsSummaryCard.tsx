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
  /** When 1, episode is subscriber-only. */
  subscriberOnly?: number;
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
  /** When true, the button shows red "End Group Call" instead of "Start Group Call". */
  isCallActive?: boolean;
  /** When isCallActive, clicking the button triggers this (e.g. to show confirm dialog). */
  onEndGroupCall?: () => void;
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
  onEndGroupCall,
}: EpisodeDetailsSummaryCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const metaParts: string[] = [status];
  if (seasonNumber != null || episodeNumber != null) {
    metaParts.push(`S${seasonNumber ?? '?'} E${episodeNumber ?? '?'}`);
  }
  const isSubscriberOnly = subscriberOnly === 1;
  const showStartCallBtn = !isCallActive && (onStartGroupCall != null || startGroupCallDisabled);
  const hasActions = onEditClick != null || shareUrl != null || showStartCallBtn || onEndGroupCall != null;

  return (
    <div className={isSubscriberOnly ? `${styles.detailsSummaryCard} ${styles.detailsSummaryCardSubscriberOnly}` : styles.detailsSummaryCard}>
      <div className={styles.detailsSummaryRow}>
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt=""
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
          <p className={styles.detailsSummaryMeta}>{metaParts.join(' · ')}</p>
        </div>
      </div>
      {hasActions && (
        <div className={styles.detailsSummaryActions}>
          {(showStartCallBtn || onEndGroupCall != null) && (
            isCallActive ? (
              <button type="button" className={styles.detailsSummaryEndCallBtn} onClick={onEndGroupCall} aria-label="End group call">
                <Users size={18} strokeWidth={2} aria-hidden />
                End Group Call
              </button>
            ) : showStartCallBtn ? (
              <button
                type="button"
                className={styles.detailsSummaryEditBtn}
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
