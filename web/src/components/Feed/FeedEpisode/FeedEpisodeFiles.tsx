import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, Download, ExternalLink, X } from 'lucide-react';
import {
  getPublicEpisodeFiles,
  type PublicEpisodeFileItem,
} from '../../../api/publicEpisodeFiles';
import {
  classifyEpisodeLinkUrl,
  episodeFileExtensionLabel,
  isImageMime,
  vimeoEmbedUrl,
  youtubeEmbedUrl,
} from '../../../utils/episodeFileLinks';
import styles from './FeedEpisodeFiles.module.css';

export interface FeedEpisodeFilesProps {
  podcastSlug: string;
  episodeSlug: string;
}

function FileCard({
  item,
  onOpenImage,
}: {
  item: PublicEpisodeFileItem;
  onOpenImage: (src: string, alt: string) => void;
}) {
  if (item.kind === 'link' && item.url) {
    const kind = classifyEpisodeLinkUrl(item.url);
    if (kind === 'youtube') {
      const embed = youtubeEmbedUrl(item.url);
      if (embed) {
        return (
          <div className={styles.card}>
            <div className={styles.embedWrap}>
              <iframe
                className={styles.embed}
                src={embed}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <h3 className={styles.cardTitle}>{item.title}</h3>
            {item.description ? <p className={styles.cardDesc}>{item.description}</p> : null}
          </div>
        );
      }
    }
    if (kind === 'vimeo') {
      const embed = vimeoEmbedUrl(item.url);
      if (embed) {
        return (
          <div className={styles.card}>
            <div className={styles.embedWrap}>
              <iframe
                className={styles.embed}
                src={embed}
                title={item.title}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
            <h3 className={styles.cardTitle}>{item.title}</h3>
            {item.description ? <p className={styles.cardDesc}>{item.description}</p> : null}
          </div>
        );
      }
    }
    if (kind === 'image') {
      return (
        <div className={styles.card}>
          <button
            type="button"
            className={styles.thumbBtn}
            onClick={() => onOpenImage(item.url!, item.title)}
            aria-label={`View ${item.title}`}
          >
            <img src={item.url} alt="" className={styles.thumb} loading="lazy" />
          </button>
          <h3 className={styles.cardTitle}>{item.title}</h3>
          {item.description ? <p className={styles.cardDesc}>{item.description}</p> : null}
        </div>
      );
    }
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>{item.title}</h3>
        {item.description ? <p className={styles.cardDesc}>{item.description}</p> : null}
        <a
          className={styles.fileLink}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open link
          <ExternalLink size={14} aria-hidden />
        </a>
      </div>
    );
  }

  const downloadUrl = item.downloadUrl;
  const extLabel = episodeFileExtensionLabel(item.originalFilename, item.mimeType);
  const downloadLabel = extLabel ? `Download ${extLabel}` : 'Download';
  const image = isImageMime(item.mimeType) && downloadUrl;
  if (image) {
    return (
      <div className={styles.card}>
        <button
          type="button"
          className={styles.thumbBtn}
          onClick={() => onOpenImage(downloadUrl, item.title)}
          aria-label={`View ${item.title}`}
        >
          <img src={downloadUrl} alt="" className={styles.thumb} loading="lazy" />
        </button>
        <h3 className={styles.cardTitle}>{item.title}</h3>
        {item.description ? <p className={styles.cardDesc}>{item.description}</p> : null}
        {downloadUrl ? (
          <a
            className={styles.fileLink}
            href={downloadUrl}
            download={item.originalFilename ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            {downloadLabel}
            <Download size={14} aria-hidden />
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{item.title}</h3>
      {item.description ? <p className={styles.cardDesc}>{item.description}</p> : null}
      {downloadUrl ? (
        <a
          className={styles.fileLink}
          href={downloadUrl}
          download={item.originalFilename ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          {downloadLabel}
          <Download size={14} aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

export function FeedEpisodeFiles({ podcastSlug, episodeSlug }: FeedEpisodeFilesProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['public-episode-files', podcastSlug, episodeSlug],
    queryFn: () => getPublicEpisodeFiles(podcastSlug, episodeSlug),
    enabled: Boolean(podcastSlug && episodeSlug),
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <h2 className={styles.title}>Episode Files</h2>
        <ChevronRight
          size={18}
          strokeWidth={2.25}
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          aria-hidden
        />
      </button>
      <div id={panelId} className={styles.panel} hidden={!expanded}>
        {expanded ? (
          <div className={styles.grid}>
            {items.map((item) => (
              <FileCard
                key={item.id}
                item={item}
                onOpenImage={(src, alt) => setLightbox({ src, alt })}
              />
            ))}
          </div>
        ) : null}
      </div>

      <Dialog.Root
        open={!!lightbox}
        onOpenChange={(o) => {
          if (!o) setLightbox(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.lightboxOverlay} />
          <Dialog.Content
            className={styles.lightboxContent}
            aria-describedby={undefined}
          >
            <Dialog.Title className={styles.srOnly}>
              {lightbox?.alt?.trim() || 'Image'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.lightboxClose} aria-label="Close">
                <X size={18} />
              </button>
            </Dialog.Close>
            {lightbox ? (
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className={styles.lightboxImg}
                onClick={() => setLightbox(null)}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
