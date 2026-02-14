import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { UserPlus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { listCast, type CastMember } from '../../api/podcasts';
import {
  getEpisodeCast,
  assignEpisodeCast,
  type EpisodeCastMember,
} from '../../api/episodes';
import { CastMemberRow } from '../../components/ShowCast/CastMemberRow';
import sharedStyles from '../../components/PodcastDetail/shared.module.css';
import styles from '../../components/ShowCast/ShowCast.module.css';

const mergedStyles = { ...sharedStyles, ...styles };
const PAGE_SIZE = 5;

export interface EpisodeCastCardProps {
  podcastId: string;
  episodeId: string;
  canAssign: boolean;
}

export function EpisodeCastCard({
  podcastId,
  episodeId,
  canAssign,
}: EpisodeCastCardProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const searchDebounced = useDebouncedValue(search);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [offset, setOffset] = useState(0);

  const { data: podcastCastCount } = useQuery({
    queryKey: ['cast', podcastId, { limit: 1 }],
    queryFn: () => listCast(podcastId, { limit: 1 }),
    enabled: !!podcastId,
  });

  const { data: episodeCastData } = useQuery({
    queryKey: ['episode-cast', podcastId, episodeId],
    queryFn: () => getEpisodeCast(podcastId, episodeId),
    enabled: !!podcastId && !!episodeId,
  });

  const assignedCast = episodeCastData?.cast ?? [];

  const { data: unassignedData, isLoading: isLoadingUnassigned } = useQuery({
    queryKey: [
      'cast',
      podcastId,
      { limit: PAGE_SIZE, offset, q: searchDebounced, sort, episode_id: episodeId },
    ],
    queryFn: () =>
      listCast(podcastId, {
        limit: PAGE_SIZE,
        offset,
        q: searchDebounced.trim() || undefined,
        sort,
        episode_id: episodeId,
      }),
    enabled: !!podcastId && !!episodeId,
  });

  const unassignedCast = unassignedData?.cast ?? [];
  const total = unassignedData?.total ?? 0;

  const assignMutation = useMutation({
    mutationFn: ({
      castIds,
    }: {
      castIds: string[];
      addedId?: string;
      shouldGoBackPage?: boolean;
    }) => assignEpisodeCast(podcastId, episodeId, castIds),
    onSuccess: (_data, { addedId, shouldGoBackPage }) => {
      if (shouldGoBackPage) setOffset((o) => Math.max(0, o - PAGE_SIZE));
      queryClient.invalidateQueries({ queryKey: ['episode-cast', podcastId, episodeId] });
      queryClient.invalidateQueries({ queryKey: ['cast', podcastId] });
      if (addedId) {
        queryClient.setQueriesData(
          { queryKey: ['cast', podcastId], predicate: (query) => {
            const key = query.queryKey as [string, string, { episode_id?: string }];
            return key[2]?.episode_id === episodeId;
          }},
          (old: { cast: CastMember[]; total: number } | undefined) => {
            if (!old) return old;
            const filtered = old.cast.filter((x) => x.id !== addedId);
            return { cast: filtered, total: Math.max(0, old.total - 1) };
          }
        );
      }
    },
  });

  const handleAdd = (c: CastMember) => {
    if (!canAssign) return;
    const castIds = [...assignedCast.map((x: EpisodeCastMember) => x.id), c.id];
    const shouldGoBackPage = offset > 0 && unassignedCast.length === 1;
    assignMutation.mutate({ castIds, addedId: c.id, shouldGoBackPage });
  };

  const handleRemove = (c: EpisodeCastMember) => {
    if (!canAssign) return;
    const castIds = assignedCast
      .filter((x: EpisodeCastMember) => x.id !== c.id)
      .map((x: EpisodeCastMember) => x.id);
    assignMutation.mutate({ castIds });
  };

  const handleQuickAddAllHosts = () => {
    if (!canAssign || total === 0) return;
    listCast(podcastId, {
      limit: 100,
      offset: 0,
      sort,
      episode_id: episodeId,
    }).then(({ cast }) => {
      const hostIds = cast.filter((c: CastMember) => c.role === 'host').map((c) => c.id);
      if (hostIds.length > 0) {
        assignMutation.mutate({
          castIds: [...assignedCast.map((x) => x.id), ...hostIds],
          addedId: undefined,
        });
      }
    });
  };

  if ((podcastCastCount?.total ?? 0) === 0 && podcastCastCount !== undefined) return null;

  return (
    <div className={mergedStyles.card}>
      <div className={`${mergedStyles.exportHeader} ${mergedStyles.castSectionHeader}`}>
        <h2 className={mergedStyles.sectionTitle}>Cast</h2>
        {canAssign && (
          <button
            type="button"
            className={mergedStyles.gearBtn}
            onClick={handleQuickAddAllHosts}
            disabled={assignMutation.isPending}
          >
            <UserPlus size={14} />
            Quick Add All Hosts
          </button>
        )}
      </div>

      {assignedCast.length > 0 && (
        <div className={mergedStyles.castChipsWrap}>
          <h3 className={mergedStyles.dialogSectionTitle} style={{ marginTop: 0 }}>
            Assigned
          </h3>
          <div className={mergedStyles.castChips}>
            {assignedCast.map((c) => (
              <CastMemberRow
                key={c.id}
                member={c as EpisodeCastMember & { photo_filename?: string | null; photo_url?: string | null }}
                podcastId={podcastId}
                variant="chip"
              >
                {canAssign && (
                  <button
                    type="button"
                    className={mergedStyles.castChipRemove}
                    onClick={() => handleRemove(c)}
                    aria-label={`Remove ${c.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </CastMemberRow>
            ))}
          </div>
        </div>
      )}

      {canAssign && (
        <div>
          <div className={mergedStyles.castSearchWrap}>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Search by name..."
              className={mergedStyles.castSearchInput}
              aria-label="Search cast"
            />
            <div className={mergedStyles.statusToggle} role="group" aria-label="Sort order">
              <button
                type="button"
                className={sort === 'newest' ? mergedStyles.statusToggleActive : mergedStyles.statusToggleBtn}
                onClick={() => { setSort('newest'); setOffset(0); }}
                aria-pressed={sort === 'newest'}
              >
                Newest
              </button>
              <button
                type="button"
                className={sort === 'oldest' ? mergedStyles.statusToggleActive : mergedStyles.statusToggleBtn}
                onClick={() => { setSort('oldest'); setOffset(0); }}
                aria-pressed={sort === 'oldest'}
              >
                Oldest
              </button>
            </div>
          </div>
          {isLoadingUnassigned ? (
            <p className={mergedStyles.castEmpty}>Loading...</p>
          ) : unassignedCast.length > 0 ? (
            <ul className={mergedStyles.castList}>
              {unassignedCast.map((c) => (
                <CastMemberRow key={c.id} member={c} podcastId={podcastId}>
                  <button
                    type="button"
                    className={mergedStyles.gearBtn}
                    onClick={() => handleAdd(c)}
                    disabled={assignMutation.isPending}
                    aria-label={`Add ${c.name}`}
                  >
                    <UserPlus size={14} />
                    Add
                  </button>
                </CastMemberRow>
              ))}
            </ul>
          ) : (
            <p className={mergedStyles.pdCardEmptyState}>
              {search.trim() ? 'No results match your search.' : 'All show cast members are assigned.'}
            </p>
          )}
          {total > PAGE_SIZE && (
            <div className={mergedStyles.castPagination}>
              <button
                type="button"
                className={mergedStyles.castPaginationBtn}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <span className={mergedStyles.castPaginationLabel}>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <button
                type="button"
                className={mergedStyles.castPaginationBtn}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {assignMutation.isError && (
        <p className={mergedStyles.error} style={{ marginTop: '0.5rem' }}>
          {(assignMutation.error as Error)?.message ?? 'Failed to update cast'}
        </p>
      )}
    </div>
  );
}
