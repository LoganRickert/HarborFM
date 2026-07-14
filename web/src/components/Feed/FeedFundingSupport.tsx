import { Link } from 'lucide-react';
import styles from './FeedFundingSupport.module.css';

export type FundingLink = { url: string; text?: string | null };

export interface FeedFundingSupportProps {
  fundingLinks?: FundingLink[] | null;
}

function labelFor(link: FundingLink): string {
  const text = link.text?.trim();
  if (text) return text;
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Support';
  }
}

export function FeedFundingSupport({ fundingLinks }: FeedFundingSupportProps) {
  const links = (fundingLinks ?? []).filter((l) => l.url?.trim());
  if (links.length === 0) return null;

  return (
    <div className={styles.block}>
      <p className={styles.heading}>Support The Show!</p>
      <ul className={styles.list}>
        {links.map((link) => (
          <li key={link.url}>
            <a
              href={link.url.trim()}
              className={styles.btn}
              target="_blank"
              rel="noopener noreferrer"
            >
              {labelFor(link)}
              <Link size={12} strokeWidth={2.25} aria-hidden className={styles.icon} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
