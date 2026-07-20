import { Link } from 'lucide-react';
import styles from './FeedFundingSupport.module.css';

export type FundingLink = { url: string; text?: string | null };

export interface FeedFundingSupportProps {
  fundingLinks?: FundingLink[] | null;
  plain?: boolean;
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

export function FeedFundingSupport({ fundingLinks, plain = false }: FeedFundingSupportProps) {
  const links = (fundingLinks ?? []).filter((l) => l.url?.trim());
  if (links.length === 0) return null;

  return (
    <div className={plain ? `${styles.block} ${styles.blockFluid}` : styles.block}>
      <p className={plain ? `${styles.heading} ${styles.headingFluid}` : styles.heading}>
        Support The Show!
      </p>
      <ul className={plain ? `${styles.list} ${styles.listFluid}` : styles.list}>
        {links.map((link, i) => (
          <li key={`${link.url}-${link.text ?? ''}-${i}`}>
            <a
              href={link.url.trim()}
              className={plain ? `${styles.btn} ${styles.btnFluid}` : styles.btn}
              target="_blank"
              rel="noopener noreferrer"
            >
              {labelFor(link)}
              <Link
                size={plain ? 13 : 12}
                strokeWidth={2.25}
                aria-hidden
                className={styles.icon}
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
