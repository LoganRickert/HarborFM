import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { PleaseWaitDialog } from '../../components/PleaseWaitDialog';
import { getEpisodeCast, type EpisodeCastMember } from '../../api/episodes';
import { castPhotoUrl } from '../../api/podcasts';
import {
  downloadBlob,
  generateEpisodeThumbnail,
  type ThumbnailAspect,
} from './generateEpisodeThumbnail';
import localStyles from '../EpisodeEditor.module.css';
import stripeStyles from '../../components/StripePayments/StripePayments.module.css';

const styles = { ...localStyles, ...stripeStyles };

export interface DownloadThumbnailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podcastId: string;
  episodeId: string;
  episodeTitle: string;
  podcastCoverUrl: string | null;
}

function safeImageSrc(url: string | null | undefined): string {
  if (!url) return '';
  const s = url.trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://x';
    const parsed = new URL(s, base);
    if (['https:', 'http:', 'blob:'].includes(parsed.protocol.toLowerCase())) return parsed.href;
  } catch {
    /* ignore */
  }
  return '';
}

function castMemberPhotoUrl(podcastId: string, member: EpisodeCastMember): string | null {
  if (member.photoFilename) {
    return castPhotoUrl(podcastId, member.id, member.photoFilename);
  }
  const external = safeImageSrc(member.photoUrl);
  return external || null;
}

function buildCastPhotoUrls(podcastId: string, cast: EpisodeCastMember[]): string[] {
  const byName = (a: EpisodeCastMember, b: EpisodeCastMember) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  const hosts = cast.filter((c) => c.role === 'host').sort(byName);
  const guests = cast.filter((c) => c.role === 'guest').sort(byName);
  const ordered = [...hosts, ...guests];

  const urls: string[] = [];
  for (const member of ordered) {
    const url = castMemberPhotoUrl(podcastId, member);
    if (!url) continue;
    urls.push(url);
    if (urls.length >= 6) break;
  }
  return urls;
}

const ASPECT_OPTIONS: Array<{
  aspect: ThumbnailAspect;
  label: string;
  hint: string;
  previewClass: string;
}> = [
  {
    aspect: '16:9',
    label: 'Landscape',
    hint: '16:9',
    previewClass: styles.thumbnailPreviewLandscape,
  },
  {
    aspect: '9:16',
    label: 'Portrait',
    hint: '9:16',
    previewClass: styles.thumbnailPreviewPortrait,
  },
  {
    aspect: '1:1',
    label: 'Square',
    hint: '1:1',
    previewClass: styles.thumbnailPreviewSquare,
  },
];

export function DownloadThumbnailsDialog({
  open,
  onOpenChange,
  podcastId,
  episodeId,
  episodeTitle,
  podcastCoverUrl,
}: DownloadThumbnailsDialogProps) {
  const [pendingAspect, setPendingAspect] = useState<ThumbnailAspect | null>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  const [showTitle, setShowTitle] = useState(true);
  const busy = pendingAspect !== null;

  const { data: castData } = useQuery({
    queryKey: ['episode-cast', podcastId, episodeId],
    queryFn: () => getEpisodeCast(podcastId, episodeId),
    enabled: open && !!podcastId && !!episodeId,
  });

  const castPhotoUrls = useMemo(
    () => buildCastPhotoUrls(podcastId, castData?.cast ?? []),
    [podcastId, castData?.cast],
  );

  const coverPreviewSrc = safeImageSrc(podcastCoverUrl);

  async function handleDownload(aspect: ThumbnailAspect) {
    if (busy) return;
    setWaitError(null);
    setPendingAspect(aspect);
    try {
      const { blob, filename } = await generateEpisodeThumbnail({
        title: episodeTitle,
        coverUrl: podcastCoverUrl,
        castPhotoUrls,
        aspect,
        showTitle,
      });
      downloadBlob(blob, filename);
      setPendingAspect(null);
    } catch (err) {
      setWaitError(err instanceof Error ? err.message : 'Failed to generate thumbnail');
    }
  }

  function dismissWait() {
    setPendingAspect(null);
    setWaitError(null);
  }

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            if (busy && !waitError) return;
            dismissWait();
            onOpenChange(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content
            className={`${styles.dialogContent} ${styles.dialogContentScrollable} ${styles.thumbnailDialogContent}`}
          >
            <div className={styles.dialogHeaderRow}>
              <Dialog.Title className={styles.dialogTitle}>Download Thumbnails</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.dialogClose}
                  aria-label="Close"
                  disabled={busy && !waitError}
                >
                  <X size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <div className={styles.dialogBodyScroll}>
              <Dialog.Description className={styles.dialogDescription}>
                Pick a size to build and download a JPG thumbnail for this episode.
              </Dialog.Description>

              <div className={`${styles.plansSetting} ${styles.thumbnailSetting}`}>
                <div className={styles.plansSettingText}>
                  <span className={styles.plansSettingLabel}>Episode Title</span>
                </div>
                <div
                  className={`${styles.segmented} ${styles.thumbnailSegmented}`}
                  role="group"
                  aria-label="Episode Title"
                >
                  <button
                    type="button"
                    className={`${!showTitle ? styles.segmentedActive : styles.segmentedBtn} ${styles.thumbnailSegmentedBtn}`}
                    aria-pressed={!showTitle}
                    disabled={busy && !waitError}
                    onClick={() => setShowTitle(false)}
                  >
                    Disabled
                  </button>
                  <button
                    type="button"
                    className={`${showTitle ? styles.segmentedActive : styles.segmentedBtn} ${styles.thumbnailSegmentedBtn}`}
                    aria-pressed={showTitle}
                    disabled={busy && !waitError}
                    onClick={() => setShowTitle(true)}
                  >
                    Enabled
                  </button>
                </div>
              </div>

              <div className={styles.thumbnailOptions}>
                {ASPECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.aspect}
                    type="button"
                    className={
                      pendingAspect === opt.aspect
                        ? `${styles.thumbnailOption} ${styles.thumbnailOptionActive}`
                        : styles.thumbnailOption
                    }
                    disabled={busy && !waitError}
                    onClick={() => void handleDownload(opt.aspect)}
                  >
                    <span className={styles.thumbnailPreviewFrame}>
                      <span
                        className={`${styles.thumbnailPreview} ${opt.previewClass}`}
                        style={
                          coverPreviewSrc
                            ? { backgroundImage: `url("${coverPreviewSrc}")` }
                            : undefined
                        }
                        aria-hidden
                      />
                    </span>
                    <span className={styles.thumbnailOptionLabel}>{opt.label}</span>
                    <span className={styles.thumbnailOptionHint}>{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.cancel}
                  aria-label="Close download thumbnails"
                  disabled={busy && !waitError}
                >
                  Close
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <PleaseWaitDialog
        open={busy || waitError != null}
        title="Please wait"
        description="Generating your thumbnail..."
        error={waitError}
        errorTitle="Download failed"
        onDismiss={dismissWait}
      />
    </>
  );
}
