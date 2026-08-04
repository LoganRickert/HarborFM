import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, UserRound, X } from 'lucide-react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { listCast, type CastMember } from '../../api/podcasts';
import { CastMemberRow } from '../ShowCast/CastMemberRow';
import sharedStyles from '../PodcastDetail/shared.module.css';
import castStyles from '../ShowCast/ShowCast.module.css';
import styles from '../../pages/EpisodeEditor.module.css';

const merged = { ...sharedStyles, ...castStyles };
const PAGE_SIZE = 8;

export type AssignTrackCastDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podcastId: string;
  trackLabel: string;
  currentCastId: string | null;
  onSelect: (member: CastMember | null) => void;
};

export function AssignTrackCastDialog({
  open,
  onOpenChange,
  podcastId,
  trackLabel,
  currentCastId,
  onSelect,
}: AssignTrackCastDialogProps) {
  const [search, setSearch] = useState('');
  const searchDebounced = useDebouncedValue(search);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setOffset(0);
    }
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: [
      'cast',
      podcastId,
      {
        limit: PAGE_SIZE,
        offset,
        q: searchDebounced,
        sort: 'newest' as const,
        forTrackAssign: true,
      },
    ],
    queryFn: () =>
      listCast(podcastId, {
        limit: PAGE_SIZE,
        offset,
        q: searchDebounced.trim() || undefined,
        sort: 'newest',
      }),
    enabled: open && !!podcastId,
  });

  const cast = data?.cast ?? [];
  const total = data?.total ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`${styles.dialogOverlay} ${styles.dialogOverlayOnModal}`}
        />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentOnModal} ${styles.assignTrackCastDialog}`}
          onEscapeKeyDown={(e) => e.stopPropagation()}
        >
          <div className={styles.addTrackHeader}>
            <div className={styles.addTrackHeaderText}>
              <Dialog.Title className={styles.addTrackTitle}>
                Assign cast
              </Dialog.Title>
              <Dialog.Description className={styles.addTrackSubtitle}>
                Choose a show cast member for track "{trackLabel}". The track
                name and manifest will update to match.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className={merged.castSearchWrap}>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Search by name..."
              className={merged.castSearchInput}
              aria-label="Search cast"
              autoFocus
            />
          </div>

          {currentCastId ? (
            <div className={styles.assignTrackCastClearRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => {
                  onSelect(null);
                  onOpenChange(false);
                }}
              >
                <UserRound size={14} aria-hidden />
                Clear cast
              </button>
            </div>
          ) : null}

          {isLoading ? (
            <p className={merged.castEmpty}>Loading...</p>
          ) : cast.length > 0 ? (
            <ul className={merged.castList}>
              {cast.map((c) => {
                const selected = c.id === currentCastId;
                return (
                  <CastMemberRow key={c.id} member={c} podcastId={podcastId}>
                    <button
                      type="button"
                      className={
                        selected
                          ? styles.assignTrackCastSelectActive
                          : merged.gearBtn
                      }
                      onClick={() => {
                        onSelect(c);
                        onOpenChange(false);
                      }}
                      aria-label={
                        selected
                          ? `${c.name} is assigned`
                          : `Assign ${c.name}`
                      }
                    >
                      {selected ? 'Assigned' : 'Select'}
                    </button>
                  </CastMemberRow>
                );
              })}
            </ul>
          ) : (
            <p className={merged.pdCardEmptyState}>
              {search.trim()
                ? 'No results match your search.'
                : 'No cast members on this show yet.'}
            </p>
          )}

          {total > PAGE_SIZE && (
            <div className={merged.castPagination}>
              <button
                type="button"
                className={merged.castPaginationBtn}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <span className={merged.castPaginationLabel}>
                {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <button
                type="button"
                className={merged.castPaginationBtn}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
