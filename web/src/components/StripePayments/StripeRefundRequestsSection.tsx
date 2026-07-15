import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePodcastStripeRefundRequest,
  listPodcastStripeRefundRequests,
  rejectPodcastStripeRefundRequest,
} from '../../api/stripe';
import { StripeConfirmDialog } from './StripeConfirmDialog';
import localStyles from './StripePayments.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

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

function planKindLabel(kind: string | null): string {
  if (kind === 'month') return 'Monthly';
  if (kind === 'year') return 'Yearly';
  if (kind === 'one_time') return 'One-time';
  return 'Plan';
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

interface StripeRefundRequestsSectionProps {
  podcastId: string;
  readOnly?: boolean;
  enabled: boolean;
}

export function StripeRefundRequestsSection({
  podcastId,
  readOnly,
  enabled,
}: StripeRefundRequestsSectionProps) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<{
    id: string;
    action: 'approve' | 'reject';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['podcast-stripe-refund-requests', podcastId],
    queryFn: () => listPodcastStripeRefundRequests(podcastId),
    enabled,
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!confirm) throw new Error('No request selected');
      if (confirm.action === 'approve') {
        return approvePodcastStripeRefundRequest(podcastId, confirm.id);
      }
      return rejectPodcastStripeRefundRequest(podcastId, confirm.id);
    },
    onSuccess: async () => {
      setConfirm(null);
      setError(null);
      await queryClient.invalidateQueries({
        queryKey: ['podcast-stripe-refund-requests', podcastId],
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Could not update refund request');
    },
  });

  if (!enabled) return null;

  const requests = (data?.refundRequests ?? [])
    .filter((r) => r.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className={styles.refundRequestsSection}>
      <h3 className={styles.refundRequestsTitle}>Refund Requests</h3>
      <p className={styles.refundRequestsHint}>
        Listeners can request a refund from Manage Subscription. Approving refunds the plan
        amount in Stripe and revokes access.
      </p>

      {isLoading && <p className={styles.muted}>Loading refund requests…</p>}
      {!isLoading && requests.length === 0 && (
        <div className={styles.refundRequestsEmpty}>
          <p className={styles.refundRequestsEmptyText}>No pending refund requests.</p>
        </div>
      )}

      {requests.length > 0 && (
        <ul className={styles.refundRequestList}>
          {requests.map((req) => {
            const when = formatDate(req.createdAt);
            return (
              <li key={req.id} className={styles.refundRequestRow}>
                <div className={styles.refundRequestMain}>
                  <div className={styles.refundRequestTop}>
                    <span className={styles.refundRequestEmail}>
                      {req.customerEmail?.trim() || 'Unknown email'}
                    </span>
                  </div>
                  <span className={styles.refundRequestMeta}>
                    {planKindLabel(req.planKind)} ·{' '}
                    {formatMoney(req.amountCents, req.currency)}
                    {when ? ` · ${when}` : ''}
                  </span>
                </div>
                {!readOnly && (
                  <div className={styles.refundRequestActions}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      disabled={mutation.isPending}
                      onClick={() => {
                        setError(null);
                        setConfirm({ id: req.id, action: 'reject' });
                      }}
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      disabled={mutation.isPending}
                      onClick={() => {
                        setError(null);
                        setConfirm({ id: req.id, action: 'approve' });
                      }}
                    >
                      Approve
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <StripeConfirmDialog
        open={confirm != null}
        title={confirm?.action === 'approve' ? 'Approve refund?' : 'Deny refund?'}
        description={
          confirm?.action === 'approve'
            ? 'This refunds the plan amount in Stripe, emails the listener, and revokes their access token.'
            : 'This denies the request and emails the listener. Their access stays active.'
        }
        confirmLabel={confirm?.action === 'approve' ? 'Approve refund' : 'Deny refund'}
        pendingLabel={confirm?.action === 'approve' ? 'Refunding…' : 'Denying…'}
        pending={mutation.isPending}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => mutation.mutate()}
      />
    </div>
  );
}
