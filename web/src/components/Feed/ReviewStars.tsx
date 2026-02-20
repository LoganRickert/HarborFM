import { Star } from 'lucide-react';
import styles from './ReviewStars.module.css';

export interface ReviewStarsProps {
  /** 1-5, how many stars are filled. */
  rating: number;
  /** When set, stars are clickable to select this rating. */
  onChange?: (rating: number) => void;
  /** Size in pixels (default 20). */
  size?: number;
  className?: string;
}

export function ReviewStars({ rating, onChange, size = 20, className }: ReviewStarsProps) {
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <span
      className={`${styles.stars} ${onChange ? styles.interactive : ''} ${className ?? ''}`.trim()}
      role={onChange ? 'group' : undefined}
      aria-label={onChange ? `Rate ${clamped} out of 5 stars` : `${clamped} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          className={i <= clamped ? styles.filled : styles.empty}
          style={{ width: size, height: size }}
          onClick={onChange ? () => onChange(i) : undefined}
          disabled={!onChange}
          aria-pressed={onChange ? i <= clamped : undefined}
          aria-label={onChange ? `${i} star${i === 1 ? '' : 's'}` : undefined}
        >
          <Star size={size} strokeWidth={1.5} fill={i <= clamped ? 'currentColor' : 'none'} aria-hidden />
        </button>
      ))}
    </span>
  );
}
