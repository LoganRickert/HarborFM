import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import localStyles from './PodcastDetail.module.css';
import sharedStyles from './shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface PodcastGroupSectionProps {
  label: string;
  children: ReactNode;
}

export function PodcastGroupSection({ label, children }: PodcastGroupSectionProps) {
  return (
    <div className={styles.groupListSection}>
      <h2 className={styles.groupListSectionLabel}>{label}</h2>
      <div className={styles.groupList}>{children}</div>
    </div>
  );
}

interface PodcastGroupRowProps {
  label: string;
  icon?: LucideIcon;
  iconTone?: 'teal' | 'blue' | 'green' | 'amber' | 'purple' | 'slate';
  to?: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
}

export function PodcastGroupRow({
  label,
  icon: Icon,
  iconTone = 'teal',
  to,
  href,
  external = false,
  onClick,
}: PodcastGroupRowProps) {
  const iconClass = styles[`groupListRowIcon${iconTone.charAt(0).toUpperCase()}${iconTone.slice(1)}` as keyof typeof styles] ?? styles.groupListRowIconTeal;
  const content = (
    <>
      <span className={styles.groupListRowLead}>
        {Icon ? (
          <span className={`${styles.groupListRowIcon} ${iconClass}`} aria-hidden>
            <Icon size={16} strokeWidth={2} />
          </span>
        ) : null}
        <span className={styles.groupListRowLabel}>{label}</span>
      </span>
      {external ? (
        <ExternalLink size={15} strokeWidth={2} className={styles.groupListRowAccessory} aria-hidden />
      ) : (
        <ChevronRight size={16} strokeWidth={2.25} className={styles.groupListRowAccessory} aria-hidden />
      )}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className={styles.groupListRow}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
      >
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        className={styles.groupListRow}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={styles.groupListRow} onClick={onClick}>
      {content}
    </button>
  );
}

interface PodcastGroupDetailRowProps {
  label: string;
  value: ReactNode;
}

export function PodcastGroupDetailRow({ label, value }: PodcastGroupDetailRowProps) {
  return (
    <div className={styles.groupListDetailRow}>
      <span className={styles.groupListDetailLabel}>{label}</span>
      <span className={styles.groupListDetailValue}>{value}</span>
    </div>
  );
}
