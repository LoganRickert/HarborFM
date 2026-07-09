import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import styles from '../EpisodeEditor.module.css';

export type ActionTileColor = 'teal' | 'blue' | 'purple' | 'amber' | 'slate' | 'green';

export interface ActionTileProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  color: ActionTileColor;
  onClick?: () => void;
  href?: string;
  to?: string;
  target?: string;
  rel?: string;
  download?: boolean;
  disabled?: boolean;
  active?: boolean;
  infoText?: string;
  'aria-label'?: string;
}

export function ActionTile({
  icon,
  label,
  sublabel,
  color,
  onClick,
  href,
  to,
  target,
  rel,
  download,
  disabled = false,
  active = false,
  infoText,
  'aria-label': ariaLabel,
}: ActionTileProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infoOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [infoOpen]);

  const colorClass = styles[`actionTile${color.charAt(0).toUpperCase()}${color.slice(1)}` as keyof typeof styles] ?? styles.actionTileTeal;

  const wrapperClassName = [
    styles.actionTile,
    colorClass,
    active ? styles.actionTileActive : '',
    disabled ? styles.actionTileDisabled : '',
    infoOpen ? styles.actionTileInfoOpen : '',
  ]
    .filter(Boolean)
    .join(' ');

  const mainContent = (
    <>
      <span className={styles.actionTileGlyph}>{icon}</span>
      <span className={styles.actionTileLabel}>{label}</span>
      {sublabel && <span className={styles.actionTileSublabel}>{sublabel}</span>}
    </>
  );

  const infoControl = infoText ? (
    <div className={styles.actionTileInfoWrap} ref={infoRef}>
      <button
        type="button"
        className={styles.actionTileInfoBtn}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setInfoOpen((o) => !o);
        }}
        aria-label={`More about ${label}`}
        aria-expanded={infoOpen}
      >
        <Info size={14} strokeWidth={2.25} aria-hidden />
      </button>
      {infoOpen && (
        <div className={styles.actionTileInfoPopover} role="tooltip">
          {infoText}
        </div>
      )}
    </div>
  ) : null;

  if (to && !disabled) {
    return (
      <div className={wrapperClassName}>
        {infoControl}
        <Link
          to={to}
          className={styles.actionTileMain}
          aria-label={ariaLabel ?? label}
        >
          {mainContent}
        </Link>
      </div>
    );
  }

  if (href && !disabled) {
    return (
      <div className={wrapperClassName}>
        {infoControl}
        <a
          href={href}
          download={download}
          target={target}
          rel={rel}
          className={styles.actionTileMain}
          aria-label={ariaLabel ?? label}
        >
          {mainContent}
        </a>
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      {infoControl}
      <button
        type="button"
        className={styles.actionTileMain}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        aria-pressed={active || undefined}
      >
        {mainContent}
      </button>
    </div>
  );
}
