import { User, Mic } from 'lucide-react';
import { castPhotoUrl } from '../../api/podcasts';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './ShowCast.module.css';

const styles = { ...sharedStyles, ...localStyles };

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
    // ignore
  }
  return '';
}

export interface CastMemberRowMember {
  id: string;
  name: string;
  role: string;
  photo_filename?: string | null;
  photo_url?: string | null;
}

export interface CastMemberRowProps {
  member: CastMemberRowMember;
  podcastId: string;
  /** Pre-computed photo URL; if not provided, will be derived from member */
  photoSrc?: string;
  variant?: 'row' | 'chip';
  children?: React.ReactNode;
}

export function CastMemberRow({
  member,
  podcastId,
  photoSrc: photoSrcProp,
  variant = 'row',
  children,
}: CastMemberRowProps) {
  const photoSrc =
    photoSrcProp ??
    ((member.photo_filename && podcastId
      ? castPhotoUrl(podcastId, member.id, member.photo_filename)
      : '') || safeImageSrc(member.photo_url));

  const avatarNode = photoSrc ? (
    <img src={photoSrc} alt="" className={variant === 'chip' ? styles.castChipAvatar : styles.castAvatar} />
  ) : (
    <div className={variant === 'chip' ? styles.castChipAvatarPlaceholder : styles.castAvatarPlaceholder}>
      <User size={variant === 'chip' ? 12 : 18} />
    </div>
  );

  const nameNode = (
    <div className={styles.castRowNameWrap}>
      {member.role === 'host' && (
        <span className={styles.castRowHostIcon} aria-hidden>
          <Mic size={variant === 'chip' ? 12 : 14} />
        </span>
      )}
      <span className={variant === 'chip' ? styles.castChipName : styles.castRowName}>{member.name}</span>
    </div>
  );

  if (variant === 'chip') {
    return (
      <div className={styles.castChip}>
        {avatarNode}
        {nameNode}
        {children}
      </div>
    );
  }

  return (
    <li className={styles.castRow}>
      {avatarNode}
      <div className={styles.castRowMeta}>{nameNode}</div>
      {children && <div className={styles.castRowActions}>{children}</div>}
    </li>
  );
}
