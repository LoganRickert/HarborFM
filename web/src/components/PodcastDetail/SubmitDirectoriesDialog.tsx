import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { buildAbsolutePublicRssUrl } from '../../api/rss';
import { directoryHref, SUBMIT_DIRECTORIES, type DirectoryLink } from './submitDirectories';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubmitDirectoriesDialogProps {
  open: boolean;
  onClose: () => void;
  podcast: {
    slug: string;
    title?: string | null;
    canonicalFeedUrl?: string | null;
  };
}

function DirectoryRows({
  entries,
  absoluteRssUrl,
}: {
  entries: DirectoryLink[];
  absoluteRssUrl: string;
}) {
  return (
    <ul className={styles.submitDirList}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={directoryHref(entry, absoluteRssUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.submitDirRow}
          >
            <span className={styles.submitDirText}>
              <span className={styles.submitDirName}>{entry.name}</span>
              <span className={styles.submitDirBlurb}>{entry.blurb}</span>
            </span>
            <ExternalLink
              size={15}
              strokeWidth={2}
              className={styles.submitDirExternal}
              aria-hidden
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SubmitDirectoriesDialog({ open, onClose, podcast }: SubmitDirectoriesDialogProps) {
  const [copied, setCopied] = useState(false);
  const absoluteRssUrl = useMemo(
    () => buildAbsolutePublicRssUrl(podcast.slug, podcast.canonicalFeedUrl),
    [podcast.slug, podcast.canonicalFeedUrl],
  );

  const startHere = SUBMIT_DIRECTORIES.filter((d) => d.group === 'start');
  const alsoSubmit = SUBMIT_DIRECTORIES.filter((d) => d.group === 'also');

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  function handleCopy() {
    void navigator.clipboard.writeText(absoluteRssUrl).then(() => setCopied(true));
  }

  if (!open) return null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable} ${styles.submitDirDialog}`}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>Submit to Directories</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.dialogClose} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Description className={styles.submitDirLead}>
            Copy your public RSS feed and submit it once per directory. New episodes update
            automatically. Apps like Overcast and Pocket Casts often find you after Apple Podcasts
            or Podcast Index.
          </Dialog.Description>

          <div className={styles.submitDirRssBlock}>
            <div className={styles.submitDirRssLabel}>Your RSS feed</div>
            <div className={styles.submitDirRssRow}>
              <code className={styles.submitDirRssUrl} title={absoluteRssUrl}>
                {absoluteRssUrl}
              </code>
              <button
                type="button"
                className={copied ? `${styles.submitDirCopyBtn} ${styles.submitDirCopyBtnDone}` : styles.submitDirCopyBtn}
                onClick={handleCopy}
                aria-label={copied ? 'Copied' : 'Copy RSS feed URL'}
              >
                {copied ? <Check size={16} strokeWidth={2} aria-hidden /> : <Copy size={16} strokeWidth={2} aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className={styles.dialogBodyScroll}>
            <section className={styles.submitDirSection}>
              <h3 className={styles.submitDirGroupHeading}>Start here</h3>
              <DirectoryRows entries={startHere} absoluteRssUrl={absoluteRssUrl} />
            </section>

            <section className={styles.submitDirSection}>
              <h3 className={styles.submitDirGroupHeading}>Also submit</h3>
              <DirectoryRows entries={alsoSubmit} absoluteRssUrl={absoluteRssUrl} />
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
