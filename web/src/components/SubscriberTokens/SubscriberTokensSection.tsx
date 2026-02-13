import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key } from 'lucide-react';
import {
  listSubscriberTokens,
  deleteSubscriberToken,
  updatePodcast,
  type SubscriberToken,
} from '../../api/podcasts';
import { SubscriberInfoDialog } from './SubscriberInfoDialog';
import { SubscriberTokenCreatedCard } from './SubscriberTokenCreatedCard';
import { SubscriberTokenForm } from './SubscriberTokenForm';
import { SubscriberTokenControls } from './SubscriberTokenControls';
import { SubscriberTokensList } from './SubscriberTokensList';
import { SubscriberTokenPagination } from './SubscriberTokenPagination';
import { SubscriberTokenDeleteDialog } from './SubscriberTokenDeleteDialog';
import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberTokensSectionProps {
  podcastId: string;
  podcastSlug: string;
  readOnly: boolean;
  subscriberOnlyFeedEnabled: boolean;
  effectiveMaxSubscriberTokens?: number | null;
}

export function SubscriberTokensSection({
  podcastId,
  podcastSlug,
  readOnly,
  subscriberOnlyFeedEnabled,
  effectiveMaxSubscriberTokens,
}: SubscriberTokensSectionProps) {
  const queryClient = useQueryClient();
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenToDelete, setTokenToDelete] = useState<SubscriberToken | null>(null);
  const [copied, setCopied] = useState(false);
  const TOKENS_PAGE_SIZE = 10;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const skipScrollOnLoadRef = useRef(true);
  const prevPageRef = useRef<number | undefined>(undefined);

  // Debounce search
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchDebounced('');
      setPage(1);
      return;
    }
    const id = window.setTimeout(() => {
      setSearchDebounced(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  // Reset to page 1 when sort changes
  useEffect(() => {
    setPage(1);
  }, [sortNewestFirst]);

  // When user changes page, allow scroll once data is ready (cached or after load)
  useEffect(() => {
    if (prevPageRef.current !== undefined && prevPageRef.current !== page) {
      skipScrollOnLoadRef.current = false;
    }
    prevPageRef.current = page;
  }, [page]);

  // Fetch tokens with server-side pagination, search, and sort
  const { data, isLoading } = useQuery({
    queryKey: ['subscriber-tokens', podcastId, page, searchDebounced, sortNewestFirst],
    queryFn: () =>
      listSubscriberTokens(podcastId, {
        limit: TOKENS_PAGE_SIZE,
        offset: (page - 1) * TOKENS_PAGE_SIZE,
        q: searchDebounced || undefined,
        sort: sortNewestFirst ? 'newest' : 'oldest',
      }),
    enabled: !!podcastId && subscriberOnlyFeedEnabled,
  });

  // Scroll to title when data is ready (immediately if cached, or after load)
  useEffect(() => {
    if (skipScrollOnLoadRef.current || isLoading) return;
    skipScrollOnLoadRef.current = true;
    const el = titleRef.current;
    const id = requestAnimationFrame(() => {
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [page, isLoading]);

  const tokens = data?.tokens ?? [];
  const totalTokens = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTokens / TOKENS_PAGE_SIZE));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const rangeStart = totalTokens === 0 ? 0 : (pageClamped - 1) * TOKENS_PAGE_SIZE + 1;
  const rangeEnd = (pageClamped - 1) * TOKENS_PAGE_SIZE + tokens.length;

  // Clamp page when total changes
  useEffect(() => {
    if (data != null && totalTokens > 0) {
      setPage((p) => (p > totalPages ? Math.max(1, totalPages) : p));
    }
  }, [totalPages, data, totalTokens]);

  // Get total count for limit check
  const { data: allTokensData } = useQuery({
    queryKey: ['subscriber-tokens-count', podcastId],
    queryFn: () => listSubscriberTokens(podcastId, { limit: 1, offset: 0 }),
    enabled: !!podcastId && subscriberOnlyFeedEnabled,
  });

  const allTokensCount = allTokensData?.total ?? 0;
  const atTokenLimit = effectiveMaxSubscriberTokens != null && effectiveMaxSubscriberTokens > 0 && allTokensCount >= effectiveMaxSubscriberTokens;

  const enableMutation = useMutation({
    mutationFn: () => updatePodcast(podcastId, { subscriber_only_feed_enabled: 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (tokenId: string) => deleteSubscriberToken(podcastId, tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriber-tokens', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['subscriber-tokens-count', podcastId] });
    },
  });

  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/public/podcasts/${encodeURIComponent(podcastSlug)}` : '';

  function copyTokenUrl(token: string) {
    const url = `${baseUrl}/private/${encodeURIComponent(token)}/rss`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleSearchChange(query: string) {
    setSearchQuery(query);
  }

  function handleSortChange(newestFirst: boolean) {
    setSortNewestFirst(newestFirst);
  }

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <Key size={18} strokeWidth={2} aria-hidden="true" />
          <h2 ref={titleRef} className={styles.sectionTitle}>Subscriber Tokens</h2>
        </div>
      </div>

      {!subscriberOnlyFeedEnabled ? (
        <div className={styles.subscriberDisabledBody}>
          <p className={styles.subscriberDisabledMessage}>Subscriptions is currently disabled.</p>
          <div className={styles.subscriberDisabledActions}>
            <button
              type="button"
              className={styles.subscriberInfoBtn}
              onClick={() => setMoreInfoOpen(true)}
              aria-label="More info about subscriber feature"
            >
              More Info
            </button>
            <button
              type="button"
              className={styles.subscriberEnableBtn}
              onClick={() => enableMutation.mutate()}
              disabled={enableMutation.isPending}
              aria-label="Enable subscriptions for this show"
            >
              {enableMutation.isPending ? 'Enabling...' : 'Enable'}
            </button>
          </div>
          <SubscriberInfoDialog isOpen={moreInfoOpen} onClose={() => setMoreInfoOpen(false)} />
        </div>
      ) : (
        <>
          <p className={styles.sectionSub}>
            Create tokens for private RSS feeds. Each token gets a unique feed URL that includes subscriber-only episodes. Share the URL only with the intended subscriber. Disabled and read-only users cannot create or delete tokens.
          </p>

          {!readOnly && (
            <SubscriberTokenForm
              podcastId={podcastId}
              atLimit={atTokenLimit}
              limitValue={effectiveMaxSubscriberTokens}
              onSuccess={setCreatedToken}
            />
          )}

          {createdToken && (
            <SubscriberTokenCreatedCard
              token={createdToken}
              baseUrl={baseUrl}
              onDismiss={() => setCreatedToken(null)}
              copied={copied}
              onCopy={copyTokenUrl}
            />
          )}

          <SubscriberTokenControls
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            sortNewestFirst={sortNewestFirst}
            onSortChange={handleSortChange}
            totalCount={allTokensCount}
          />

          {isLoading ? (
            <p className={styles.tokenMuted}>Loading...</p>
          ) : allTokensCount === 0 ? (
            <p className={styles.tokenMuted}>No subscriber tokens yet. Create one above to share a private feed URL.</p>
          ) : totalTokens === 0 ? (
            <div className={styles.tokenNoMatch}>
              <p className={styles.tokenNoMatchText}>No tokens match your search.</p>
            </div>
          ) : (
            <>
              <SubscriberTokensList
                tokens={tokens}
                podcastId={podcastId}
                readOnly={readOnly}
                onDelete={setTokenToDelete}
              />
              <SubscriberTokenPagination
                page={pageClamped}
                totalPages={totalPages}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                totalTokens={totalTokens}
                onPageChange={setPage}
              />
            </>
          )}

          <SubscriberTokenDeleteDialog
            token={tokenToDelete}
            isOpen={!!tokenToDelete}
            onClose={() => setTokenToDelete(null)}
            onConfirm={(tokenId) => deleteMutation.mutate(tokenId)}
            isPending={deleteMutation.isPending}
          />
        </>
      )}
    </div>
  );
}
