import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { UserPlus } from 'lucide-react';
import {
  listCast,
  deleteCast,
  type CastMember,
} from '../../api/podcasts';
import { CastMembersList } from './CastMembersList';
import { CastMemberDialog } from './CastMemberDialog';
import { CastDeleteDialog } from './CastDeleteDialog';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './ShowCast.module.css';

const styles = { ...sharedStyles, ...localStyles };

const PAGE_SIZE = 5;

interface ShowCastCardProps {
  podcastId: string;
  myRole: string | undefined;
}

export function ShowCastCard({ podcastId, myRole }: ShowCastCardProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const searchDebounced = useDebouncedValue(search);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [offset, setOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCast, setEditingCast] = useState<CastMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CastMember | null>(null);

  const canAddHost = myRole === 'owner' || myRole === 'manager';
  const canAddGuest = myRole === 'owner' || myRole === 'manager' || myRole === 'editor';
  const canAdd = canAddHost || canAddGuest;

  const { data, isLoading } = useQuery({
    queryKey: ['cast', podcastId, { limit: PAGE_SIZE, offset, q: searchDebounced, sort }],
    queryFn: () =>
      listCast(podcastId, {
        limit: PAGE_SIZE,
        offset,
        q: searchDebounced.trim() || undefined,
        sort,
      }),
    enabled: !!podcastId,
  });

  const cast = data?.cast ?? [];
  const total = data?.total ?? 0;
  const isFirstEntry = total === 0 && !editingCast;

  const deleteMutation = useMutation({
    mutationFn: (castId: string) => deleteCast(podcastId, castId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cast', podcastId] });
      setDeleteTarget(null);
    },
  });

  const canEdit = (c: CastMember) => {
    if (c.role === 'host') return canAddHost;
    return canAddGuest;
  };

  const canDelete = (c: CastMember) => canEdit(c);

  const handleAdd = () => {
    setEditingCast(null);
    setDialogOpen(true);
  };

  const handleEdit = (c: CastMember) => {
    setEditingCast(c);
    setDialogOpen(true);
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingCast(null);
  };

  const handleDialogSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['cast', podcastId] });
  };

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <UserPlus size={18} strokeWidth={2} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>Show Cast</h2>
        </div>
        <div className={styles.exportHeaderActions}>
          {canAdd && (
            <button
              type="button"
              className={styles.gearBtn}
              onClick={handleAdd}
              aria-label="Add cast member"
            >
              <UserPlus size={16} strokeWidth={2} aria-hidden />
              Add Cast Member
            </button>
          )}
        </div>
      </div>
      <p className={styles.pdCardSectionSub}>
        Add hosts and guests for your show. Hosts and guests can be assigned to individual episodes.
      </p>

      <div className={styles.castSearchWrap}>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder="Search by name..."
            className={styles.castSearchInput}
            aria-label="Search cast"
          />
          <div className={styles.statusToggle} role="group" aria-label="Sort order">
            <button
              type="button"
              className={sort === 'newest' ? styles.statusToggleActive : styles.statusToggleBtn}
              onClick={() => {
                setSort('newest');
                setOffset(0);
              }}
              aria-pressed={sort === 'newest'}
            >
              Newest
            </button>
            <button
              type="button"
              className={sort === 'oldest' ? styles.statusToggleActive : styles.statusToggleBtn}
              onClick={() => {
                setSort('oldest');
                setOffset(0);
              }}
              aria-pressed={sort === 'oldest'}
            >
              Oldest
            </button>
          </div>
        </div>

      {isLoading ? (
        <p className={styles.pdCardEmptyState}>Loading...</p>
      ) : (
        <CastMembersList
          cast={cast}
          total={total}
          limit={PAGE_SIZE}
          offset={offset}
          podcastId={podcastId}
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={handleEdit}
          onDelete={setDeleteTarget}
          onPrevPage={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          onNextPage={() => setOffset((o) => o + PAGE_SIZE)}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {dialogOpen && (
        <CastMemberDialog
          open={dialogOpen}
          podcastId={podcastId}
          cast={editingCast}
          isFirstEntry={isFirstEntry}
          canAddHost={canAddHost}
          onClose={handleDialogClose}
          onSuccess={handleDialogSuccess}
        />
      )}

      <CastDeleteDialog
        cast={deleteTarget}
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(castId) => deleteMutation.mutate(castId)}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
