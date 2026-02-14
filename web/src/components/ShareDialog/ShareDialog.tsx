import { useState } from 'react';
import { Copy, Code, X, Check } from 'lucide-react';
import { SiX, SiFacebook, SiReddit } from 'react-icons/si';
import styles from './ShareDialog.module.css';

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  /** Optional title/text for social share (e.g. tweet text). */
  title?: string;
  /** Optional iframe HTML for Embed option. When provided, Embed button is shown. */
  embedCode?: string;
}

function openTwitterShare(url: string, text?: string) {
  const params = new URLSearchParams();
  params.set('url', url);
  if (text) params.set('text', text);
  window.open(`https://twitter.com/intent/tweet?${params.toString()}`, '_blank', 'noopener,noreferrer,width=550,height=420');
}

function openFacebookShare(url: string) {
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer,width=550,height=420');
}

function openRedditShare(url: string, title?: string) {
  const params = new URLSearchParams();
  params.set('url', url);
  if (title) params.set('title', title);
  window.open(`https://www.reddit.com/submit?${params.toString()}`, '_blank', 'noopener,noreferrer,width=550,height=420');
}

export function ShareDialog({
  open,
  onOpenChange,
  url,
  title,
  embedCode,
}: ShareDialogProps) {
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const [showEmbed, setShowEmbed] = useState(false);

  if (!open) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('link');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const handleCopyEmbed = async () => {
    if (!embedCode) return;
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied('embed');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const handleBackFromEmbed = () => {
    setShowEmbed(false);
    setCopied(null);
  };

  return (
    <div className={styles.overlay} onClick={() => onOpenChange(false)}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
        <div className={styles.header}>
          <h3 id="share-dialog-title" className={styles.title}>
            {showEmbed ? 'Embed' : 'Share'}
          </h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {showEmbed ? (
          <div className={styles.embedSection}>
            <p className={styles.embedHint}>Copy this code to embed the player on your site.</p>
            <textarea
              className={styles.embedCode}
              value={embedCode ?? ''}
              readOnly
              rows={4}
              aria-label="Embed code"
            />
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopyEmbed}
            >
              <Copy size={18} strokeWidth={2} aria-hidden />
              {copied === 'embed' ? 'Copied!' : 'Copy code'}
            </button>
            <button type="button" className={styles.backLink} onClick={handleBackFromEmbed}>
              Back to share options
            </button>
          </div>
        ) : (
          <>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => { openTwitterShare(url, title); onOpenChange(false); }}
                aria-label="Share on X"
                title="Share on X"
              >
                <SiX size={22} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => { openFacebookShare(url); onOpenChange(false); }}
                aria-label="Share on Facebook"
                title="Share on Facebook"
              >
                <SiFacebook size={22} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => { openRedditShare(url, title); onOpenChange(false); }}
                aria-label="Share on Reddit"
                title="Share on Reddit"
              >
                <SiReddit size={22} aria-hidden />
              </button>
              <button
                type="button"
                className={copied === 'link' ? `${styles.actionBtn} ${styles.actionBtnCopied}` : styles.actionBtn}
                onClick={handleCopyLink}
                aria-label={copied === 'link' ? 'Copied' : 'Copy link'}
                title={copied === 'link' ? 'Copied' : 'Copy link'}
              >
                {copied === 'link' ? (
                  <Check size={22} strokeWidth={2} aria-hidden />
                ) : (
                  <Copy size={22} strokeWidth={2} aria-hidden />
                )}
              </button>
              {embedCode != null && (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setShowEmbed(true)}
                  aria-label="Embed"
                  title="Embed"
                >
                  <Code size={22} strokeWidth={2} aria-hidden />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
