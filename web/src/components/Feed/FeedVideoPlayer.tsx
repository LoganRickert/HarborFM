import { useState, useRef, useMemo } from 'react';
import { usePlyr } from 'plyr-react';
import 'plyr-react/plyr.css';
import type { PlyrSource, PlyrOptions, APITypes } from 'plyr-react';

const PLYR_OPTIONS: PlyrOptions = {
  controls: [
    'play-large',
    'play',
    'progress',
    'current-time',
    'mute',
    'volume',
    'settings',
    'fullscreen',
  ],
  settings: ['speed'],
  hideControls: true,
};

export function FeedVideoPlayer({
  src,
  poster,
  ariaLabel,
  className,
}: {
  src: string;
  poster?: string;
  ariaLabel: string;
  className?: string;
}) {
  const [loadError, setLoadError] = useState(false);
  const ref = useRef<APITypes | null>(null);

  const source = useMemo<PlyrSource>(
    () => ({
      type: 'video',
      title: ariaLabel,
      sources: [{ src, type: 'video/mp4', size: 720 }],
      ...(poster && { poster }),
    }),
    [src, poster, ariaLabel]
  );

  const raptorRef = usePlyr(ref, { source, options: PLYR_OPTIONS });

  if (loadError) {
    return (
      <div className={className} style={{ aspectRatio: '16/9', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', padding: '1rem' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--text-muted)' }}>Video failed to load.</p>
          <a href={src} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--success)', fontSize: '0.875rem' }}>
            Open video in new tab
          </a>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={raptorRef}
      className={`plyr-react plyr ${className ?? ''}`.trim()}
      src={src}
      poster={poster}
      preload="auto"
      playsInline
      aria-label={ariaLabel}
      onError={() => setLoadError(true)}
    />
  );
}
