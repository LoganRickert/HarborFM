import { Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CastMember } from '../../api/podcasts';
import { CastMemberRow } from './CastMemberRow';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './ShowCast.module.css';

const styles = { ...sharedStyles, ...localStyles };

export interface CastMembersListProps {
  cast: CastMember[];
  total: number;
  limit: number;
  offset: number;
  podcastId: string;
  canEdit: (c: CastMember) => boolean;
  canDelete: (c: CastMember) => boolean;
  onEdit: (c: CastMember) => void;
  onDelete: (c: CastMember) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  isDeleting: boolean;
}

export function CastMembersList({
  cast,
  total,
  limit,
  offset,
  podcastId,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onPrevPage,
  onNextPage,
  isDeleting,
}: CastMembersListProps) {
  const hasPrev = offset > 0;
  const hasNext = offset + cast.length < total;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);

  if (cast.length === 0 && total === 0) {
    return <p className={styles.pdCardEmptyState}>No cast members yet. Add a host or guest above.</p>;
  }

  if (cast.length === 0) {
    return <p className={styles.pdCardEmptyState}>No results match your search.</p>;
  }

  return (
    <>
      <ul className={styles.castList}>
        {cast.map((c) => (
          <CastMemberRow key={c.id} member={c} podcastId={podcastId}>
            {canEdit(c) && (
              <button
                type="button"
                className={`${styles.cancel} ${styles.castRowEditBtn}`}
                onClick={() => onEdit(c)}
                aria-label={`Edit ${c.name}`}
              >
                <Pencil size={16} aria-hidden />
                Edit
              </button>
            )}
            {canDelete(c) && (
              <button
                type="button"
                className={`${styles.exportDeleteBtn} ${styles.castRowDeleteBtn}`}
                onClick={() => onDelete(c)}
                disabled={isDeleting}
                aria-label={`Delete ${c.name}`}
              >
                <Trash2 size={14} />
              </button>
            )}
          </CastMemberRow>
        ))}
      </ul>
      {total > limit && (
      <div className={styles.castPagination}>
        <button
          type="button"
          className={styles.castPaginationBtn}
          onClick={onPrevPage}
          disabled={!hasPrev}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className={styles.castPaginationLabel}>
          {start}–{end} of {total}
        </span>
        <button
          type="button"
          className={styles.castPaginationBtn}
          onClick={onNextPage}
          disabled={!hasNext}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      )}
    </>
  );
}
