import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  /** On mobile, show this instead of label when set (e.g. "Podcast" instead of show name). */
  mobileLabel?: string;
  /** On mobile, hide this segment (e.g. episode title). */
  hideOnMobile?: boolean;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

/**
 * Renders a consistent breadcrumb trail: Home > Podcast > Episodes > Episode name.
 * Mobile behavior (mobileLabel, hideOnMobile) is handled with CSS only to avoid
 * viewport listeners and re-renders on Safari/mobile.
 */
export function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav
      className={styles.breadcrumb}
      aria-label="Breadcrumb"
    >
      <ol className={styles.list} itemScope itemType="https://schema.org/BreadcrumbList">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const labelContent =
            item.mobileLabel != null ? (
              <span itemProp="name" className={styles.labelDual}>
                <span className={styles.labelDesktop}>{item.label}</span>
                <span className={styles.labelMobile}>{item.mobileLabel}</span>
              </span>
            ) : (
              <span itemProp="name" className={styles.label}>{item.label}</span>
            );
          return (
            <li
              key={i}
              className={item.hideOnMobile ? `${styles.item} ${styles.itemHideOnMobile}` : styles.item}
              itemProp="itemListElement"
              itemScope
              itemType="https://schema.org/ListItem"
            >
              {i > 0 && (
                <span className={styles.sep} aria-hidden>
                  <ChevronRight size={14} strokeWidth={2.5} />
                </span>
              )}
              {!isLast && item.href ? (
                <Link to={item.href} className={styles.card} itemProp="item">
                  {labelContent}
                </Link>
              ) : (
                <span className={`${styles.card} ${styles.current}`} aria-current="page">
                  {labelContent}
                </span>
              )}
              <meta itemProp="position" content={String(i + 1)} />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
