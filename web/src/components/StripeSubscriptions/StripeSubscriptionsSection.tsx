import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, ExternalLink, Search, ArrowDown, ArrowUp, Trash2, PowerOff } from 'lucide-react';
import { me } from '../../api/auth';
import {
  cancelPodcastStripeSubscriptionAutoRenew,
  deletePodcastStripeSubscription,
  listPodcastStripeSubscriptions,
  type OwnerStripeSubscription,
  type StripePlanKind,
} from '../../api/stripe';
import { StripeConfirmDialog } from '../StripePayments/StripeConfirmDialog';
import { SubscriberTokenPagination } from '../SubscriberTokens/SubscriberTokenPagination';
import tokenStyles from '../SubscriberTokens/SubscriberTokens.module.css';
import stripeStyles from '../StripePayments/StripePayments.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './StripeSubscriptions.module.css';

const styles = { ...sharedStyles, ...tokenStyles, ...stripeStyles, ...localStyles };

const PAGE_SIZE = 10;

const KIND_LABEL: Record<StripePlanKind, string> = {
  month: 'Monthly',
  year: 'Yearly',
  one_time: 'One-time',
};

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusLabel(sub: OwnerStripeSubscription): string {
  if (sub.cancelAtPeriodEnd) return 'Ends soon';
  if (sub.status === 'trialing') return 'Trialing';
  if (sub.status === 'one_time') return 'One-time';
  if (sub.status === 'active') return 'Active';
  return sub.status;
}

function metaText(sub: OwnerStripeSubscription): string {
  const parts: string[] = [];
  if (sub.planKind) {
    const kind = KIND_LABEL[sub.planKind];
    if (sub.planAmountCents != null && sub.planCurrency) {
      parts.push(`${kind} · ${formatMoney(sub.planAmountCents, sub.planCurrency)}`);
    } else {
      parts.push(kind);
    }
  }
  const periodEnd = formatDate(sub.currentPeriodEnd);
  if (periodEnd) {
    parts.push(
      sub.cancelAtPeriodEnd ? `Access until ${periodEnd}` : `Renews ${periodEnd}`,
    );
  }
  const created = formatDate(sub.createdAt);
  if (created) parts.push(`Joined ${created}`);
  if (sub.mode === 'test') parts.push('Test');
  return parts.join(' · ');
}

interface StripeSubscriptionsSectionProps {
  podcastId: string;
  readOnly?: boolean;
}

export function StripeSubscriptionsSection({
  podcastId,
  readOnly = false,
}: StripeSubscriptionsSectionProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [pendingCancel, setPendingCancel] = useState<OwnerStripeSubscription | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<OwnerStripeSubscription | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const skipScrollOnLoadRef = useRef(true);
  const prevPageRef = useRef<number | undefined>(undefined);

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: me,
  });
  const canStripe = meData?.user?.canStripe === 1;

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

  useEffect(() => {
    setPage(1);
  }, [sortNewestFirst]);

  useEffect(() => {
    if (prevPageRef.current !== undefined && prevPageRef.current !== page) {
      skipScrollOnLoadRef.current = false;
    }
    prevPageRef.current = page;
  }, [page]);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      'podcast-stripe-subscriptions',
      podcastId,
      page,
      searchDebounced,
      sortNewestFirst,
    ],
    queryFn: () =>
      listPodcastStripeSubscriptions(podcastId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        q: searchDebounced || undefined,
        sort: sortNewestFirst ? 'newest' : 'oldest',
      }),
    enabled: Boolean(podcastId) && canStripe,
  });

  useEffect(() => {
    if (skipScrollOnLoadRef.current || isLoading) return;
    skipScrollOnLoadRef.current = true;
    const el = titleRef.current;
    const id = requestAnimationFrame(() => {
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [page, isLoading]);

  const subscriptions = data?.subscriptions ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageClamped = Math.max(1, Math.min(page, totalPages));
  const rangeStart = total === 0 ? 0 : (pageClamped - 1) * PAGE_SIZE + 1;
  const rangeEnd = (pageClamped - 1) * PAGE_SIZE + subscriptions.length;

  useEffect(() => {
    if (data != null && total > 0) {
      setPage((p) => (p > totalPages ? Math.max(1, totalPages) : p));
    }
  }, [totalPages, data, total]);

  const cancelMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      cancelPodcastStripeSubscriptionAutoRenew(podcastId, subscriptionId),
    onSuccess: async () => {
      setPendingCancel(null);
      setActionError(null);
      await queryClient.invalidateQueries({
        queryKey: ['podcast-stripe-subscriptions', podcastId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['podcast-stripe-plans', podcastId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['subscriber-tokens', podcastId],
      });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : 'Could not disable auto-renew');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      deletePodcastStripeSubscription(podcastId, subscriptionId),
    onSuccess: async () => {
      setPendingDelete(null);
      setActionError(null);
      await queryClient.invalidateQueries({
        queryKey: ['podcast-stripe-subscriptions', podcastId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['podcast-stripe-plans', podcastId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['subscriber-tokens', podcastId],
      });
    },
    onError: (err) => {
      setActionError(
        err instanceof Error ? err.message : 'Could not delete subscription',
      );
    },
  });

  const busy = cancelMutation.isPending || deleteMutation.isPending;

  if (!canStripe) return null;

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <Users size={18} strokeWidth={2} aria-hidden="true" />
          <h2 ref={titleRef} className={styles.sectionTitle}>
            Stripe Subscriptions
          </h2>
        </div>
      </div>

      <p className={styles.pdCardSectionSub}>
        Active paid listeners for this show. Open a subscription in Stripe, disable
        auto-renew, or remove a local row if HarborFM and Stripe got out of sync.
      </p>

      {(total > 0 || searchDebounced) && (
        <div className={styles.tokenControls}>
          <div className={styles.tokenSearchWrapper}>
            <Search className={styles.tokenSearchIcon} size={18} strokeWidth={2} aria-hidden />
            <input
              type="search"
              className={styles.tokenSearchInput}
              placeholder="Search by email…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search subscriptions by email"
            />
          </div>
          <div className={styles.tokenSortToggle} role="group" aria-label="Sort order">
            <button
              type="button"
              className={sortNewestFirst ? styles.tokenSortBtnActive : styles.tokenSortBtn}
              aria-label="Sort newest first"
              onClick={() => setSortNewestFirst(true)}
            >
              <ArrowDown size={16} strokeWidth={2} aria-hidden />
              Newest
            </button>
            <button
              type="button"
              className={!sortNewestFirst ? styles.tokenSortBtnActive : styles.tokenSortBtn}
              aria-label="Sort oldest first"
              onClick={() => setSortNewestFirst(false)}
            >
              <ArrowUp size={16} strokeWidth={2} aria-hidden />
              Oldest
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className={styles.pdCardEmptyState}>Loading subscriptions…</p>
      ) : isError ? (
        <p className={styles.error}>Failed to load subscriptions.</p>
      ) : subscriptions.length === 0 ? (
        <p className={styles.pdCardEmptyState}>
          {searchDebounced
            ? 'No active subscriptions match that email.'
            : 'No active Stripe subscriptions yet.'}
        </p>
      ) : (
        <ul className={styles.exportList}>
          {subscriptions.map((sub) => (
            <li key={sub.id} className={styles.exportCard}>
              <div className={styles.exportCardRow}>
                <div className={styles.subMeta}>
                  <div className={styles.subMetaTop}>
                    <strong className={styles.subEmail}>
                      {sub.customerEmail?.trim() || 'No email'}
                    </strong>
                    <span
                      className={
                        sub.cancelAtPeriodEnd
                          ? styles.statusBadgeDisabled
                          : styles.statusBadgeActive
                      }
                    >
                      {statusLabel(sub)}
                    </span>
                  </div>
                  <p className={styles.subMetaLine}>{metaText(sub)}</p>
                </div>
                <div className={styles.subActions}>
                  {sub.stripeUrl && (
                    <a
                      className={`${styles.secondaryBtn} ${styles.subActionsStripe}`}
                      href={sub.stripeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={14} aria-hidden />
                      Stripe
                    </a>
                  )}
                  {!readOnly && sub.canCancelAutoRenew && (
                    <button
                      type="button"
                      className={`${styles.secondaryBtn} ${styles.warningBtn} ${styles.subActionsRenew}`}
                      disabled={busy}
                      onClick={() => {
                        setActionError(null);
                        setPendingCancel(sub);
                      }}
                    >
                      <PowerOff size={14} strokeWidth={2} aria-hidden />
                      Disable
                    </button>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className={`${styles.tokenDeleteBtn} ${styles.subActionsDelete}`}
                      disabled={busy}
                      onClick={() => {
                        setActionError(null);
                        setPendingDelete(sub);
                      }}
                      aria-label={`Delete subscription for ${
                        sub.customerEmail?.trim() || 'listener'
                      }`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SubscriberTokenPagination
        page={pageClamped}
        totalPages={totalPages}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        totalTokens={total}
        onPageChange={setPage}
        itemLabel="subscription"
      />

      {actionError && (
        <div className={styles.fieldError} role="alert">
          <p className={styles.fieldErrorMessage}>{actionError}</p>
        </div>
      )}

      <StripeConfirmDialog
        open={pendingCancel != null}
        title="Disable auto-renew?"
        description={
          pendingCancel
            ? `Disable auto-renew for ${
                pendingCancel.customerEmail?.trim() || 'this listener'
              }? They keep access until the current period ends.`
            : ''
        }
        confirmLabel="Disable"
        pendingLabel="Disabling…"
        pending={cancelMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
        onConfirm={() => {
          if (pendingCancel) cancelMutation.mutate(pendingCancel.id);
        }}
      />

      <StripeConfirmDialog
        open={pendingDelete != null}
        title="Delete local subscription?"
        description={
          pendingDelete
            ? `Remove the HarborFM record for ${
                pendingDelete.customerEmail?.trim() || 'this listener'
              }? This disables their feed token and does not cancel or refund in Stripe.`
            : ''
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        pending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
