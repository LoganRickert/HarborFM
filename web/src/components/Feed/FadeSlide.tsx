import { useEffect, useState, type ReactNode } from 'react';
import styles from './FadeSlide.module.css';

const EXIT_MS = 240;

interface FadeSlideProps {
  show: boolean;
  children: ReactNode;
  className?: string;
}

/** Fade + vertical slide for content that toggles on/off (e.g. playback controls). */
export function FadeSlide({ show, children, className }: FadeSlideProps) {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setMounted(true);
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(frame);
    }

    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [show]);

  if (!mounted) return null;

  const wrapClass = [
    styles.fadeSlide,
    visible ? styles.fadeSlideVisible : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapClass} aria-hidden={!visible}>
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
