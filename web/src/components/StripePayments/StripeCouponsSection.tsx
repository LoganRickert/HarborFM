import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Power, PowerOff, Trash2, X } from 'lucide-react';
import {
  listPodcastStripeCoupons,
  createPodcastStripeCoupon,
  updatePodcastStripeCoupon,
  deletePodcastStripeCoupon,
  type StripeCoupon,
  type StripeCouponDiscountType,
  type StripeCouponDuration,
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

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function discountLabel(c: StripeCoupon): string {
  if (c.discountType === 'percent') {
    return `${c.percentOff ?? 0}% off`;
  }
  return `${formatMoney(c.amountOffCents ?? 0, c.currency)} off`;
}

function durationLabel(c: StripeCoupon): string {
  if (c.duration === 'once') return 'Once';
  if (c.duration === 'forever') return 'Forever';
  return `${c.durationInMonths ?? 0} month${(c.durationInMonths ?? 0) === 1 ? '' : 's'}`;
}

function fromDatetimeLocalValue(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface StripeCouponsSectionProps {
  podcastId: string;
  stripeCredentialsId: string | null;
  readOnly?: boolean;
  enabled: boolean;
}

export function StripeCouponsSection({
  podcastId,
  stripeCredentialsId,
  readOnly = false,
  enabled,
}: StripeCouponsSectionProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StripeCoupon | null>(null);
  const [pendingToggle, setPendingToggle] = useState<StripeCoupon | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [discountType, setDiscountType] =
    useState<StripeCouponDiscountType>('percent');
  const [percentOff, setPercentOff] = useState('10');
  const [amountOff, setAmountOff] = useState('5.00');
  const [currency, setCurrency] = useState('usd');
  const [duration, setDuration] = useState<StripeCouponDuration>('once');
  const [durationMonths, setDurationMonths] = useState('3');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['podcast-stripe-coupons', podcastId, stripeCredentialsId],
    queryFn: () => listPodcastStripeCoupons(podcastId),
    enabled: enabled && Boolean(stripeCredentialsId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['podcast-stripe-coupons', podcastId],
    });
  };

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createPodcastStripeCoupon>[1]) =>
      createPodcastStripeCoupon(podcastId, body),
    onSuccess: () => {
      setFormError(null);
      setAdding(false);
      resetDraft();
      invalidate();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      couponId,
      body,
    }: {
      couponId: string;
      body: Parameters<typeof updatePodcastStripeCoupon>[2];
    }) => updatePodcastStripeCoupon(podcastId, couponId, body),
    onSuccess: () => {
      setFormError(null);
      setPendingToggle(null);
      invalidate();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (couponId: string) =>
      deletePodcastStripeCoupon(podcastId, couponId),
    onSuccess: () => {
      setFormError(null);
      setPendingDelete(null);
      invalidate();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  function resetDraft() {
    setCode('');
    setName('');
    setDiscountType('percent');
    setPercentOff('10');
    setAmountOff('5.00');
    setCurrency('usd');
    setDuration('once');
    setDurationMonths('3');
    setStartsAt('');
    setEndsAt('');
    setMaxRedemptions('');
  }

  useEffect(() => {
    setAdding(false);
    setFormError(null);
    setPendingDelete(null);
    setPendingToggle(null);
    setExpandedId(null);
  }, [stripeCredentialsId]);

  if (!enabled) return null;

  const coupons = data?.coupons ?? [];
  const mode = data?.mode;
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  function submitCreate() {
    setFormError(null);
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      setFormError('Enter a coupon code.');
      return;
    }
    let percent: number | null = null;
    let amountCents: number | null = null;
    if (discountType === 'percent') {
      percent = Number.parseFloat(percentOff);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        setFormError('Enter a percent between 0 and 100.');
        return;
      }
    } else {
      const n = Number.parseFloat(amountOff);
      if (!Number.isFinite(n) || n <= 0) {
        setFormError('Enter a valid amount greater than zero.');
        return;
      }
      amountCents = Math.round(n * 100);
    }
    let months: number | null = null;
    if (duration === 'repeating') {
      months = Number.parseInt(durationMonths, 10);
      if (!Number.isFinite(months) || months < 1) {
        setFormError('Enter how many months the discount lasts.');
        return;
      }
    }
    let maxUses: number | null = null;
    if (maxRedemptions.trim()) {
      maxUses = Number.parseInt(maxRedemptions, 10);
      if (!Number.isFinite(maxUses) || maxUses < 1) {
        setFormError('Max uses must be a positive number.');
        return;
      }
    }
    createMutation.mutate({
      code: trimmedCode,
      name: name.trim() || null,
      discountType,
      percentOff: percent,
      amountOffCents: amountCents,
      currency: currency.trim().toLowerCase() || 'usd',
      duration,
      durationInMonths: months,
      startsAt: fromDatetimeLocalValue(startsAt),
      endsAt: fromDatetimeLocalValue(endsAt),
      maxRedemptions: maxUses,
      active: true,
    });
  }

  return (
    <div className={styles.plansBlock}>
      <div className={styles.plansHeader}>
        <div>
          <h3 className={styles.plansTitle}>Coupons</h3>
        </div>
        {!readOnly && mode && !adding && (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => {
              setFormError(null);
              setAdding(true);
            }}
          >
            <Plus size={16} strokeWidth={2} aria-hidden />
            Add Coupon
          </button>
        )}
      </div>

      {isLoading && <p className={styles.pdCardEmptyState}>Loading coupons…</p>}
      {isError && <p className={styles.error}>Could not load coupons.</p>}

      {adding && !readOnly && (
        <div className={styles.planForm}>
          <div className={styles.planFormHeader}>
            <h4 className={styles.planFormTitle}>New Coupon</h4>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => {
                setAdding(false);
                setFormError(null);
                resetDraft();
              }}
              aria-label="Close"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className={styles.planFormRow}>
            <label className={styles.label}>
              Code
              <input
                className={styles.input}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SAVE10"
                maxLength={64}
              />
            </label>
            <label className={styles.label}>
              Label (optional)
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Launch discount"
                maxLength={120}
              />
            </label>
          </div>
          <div className={styles.planFormRow}>
            <label className={styles.label}>
              Discount type
              <select
                className={styles.select}
                value={discountType}
                onChange={(e) =>
                  setDiscountType(e.target.value as StripeCouponDiscountType)
                }
              >
                <option value="percent">Percent off</option>
                <option value="amount">Fixed amount</option>
              </select>
            </label>
            {discountType === 'percent' ? (
              <label className={styles.label}>
                Percent
                <input
                  className={styles.input}
                  value={percentOff}
                  onChange={(e) => setPercentOff(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            ) : (
              <label className={styles.label}>
                Amount ({currency.toUpperCase()})
                <input
                  className={styles.input}
                  value={amountOff}
                  onChange={(e) => setAmountOff(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            )}
          </div>
          {discountType === 'amount' && (
            <label className={styles.label}>
              Currency
              <input
                className={styles.input}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toLowerCase())}
                maxLength={3}
              />
            </label>
          )}
          <div className={styles.planFormRow}>
            <label className={styles.label}>
              Duration
              <select
                className={styles.select}
                value={duration}
                onChange={(e) =>
                  setDuration(e.target.value as StripeCouponDuration)
                }
              >
                <option value="once">Once</option>
                <option value="repeating">Multiple months</option>
                <option value="forever">Forever</option>
              </select>
            </label>
            {duration === 'repeating' ? (
              <label className={styles.label}>
                Months
                <input
                  className={styles.input}
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                  inputMode="numeric"
                />
              </label>
            ) : (
              <label className={styles.label}>
                Max uses (optional)
                <input
                  className={styles.input}
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(e.target.value)}
                  inputMode="numeric"
                  placeholder="Unlimited"
                />
              </label>
            )}
          </div>
          {duration === 'repeating' && (
            <label className={styles.label}>
              Max uses (optional)
              <input
                className={styles.input}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                inputMode="numeric"
                placeholder="Unlimited"
              />
            </label>
          )}
          <div className={styles.planFormRow}>
            <label className={styles.label}>
              Starts (optional)
              <input
                className={styles.input}
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className={styles.label}>
              Ends (optional)
              <input
                className={styles.input}
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
          </div>
          <div className={styles.planFormActions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setFormError(null);
                resetDraft();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={busy}
              onClick={submitCreate}
            >
              Create coupon
            </button>
          </div>
        </div>
      )}

      {formError && (
        <div className={styles.fieldError} role="alert">
          <p className={styles.fieldErrorMessage}>{formError}</p>
        </div>
      )}

      {!isLoading && coupons.length === 0 && !adding && (
        <div className={styles.plansEmpty}>
          <p className={styles.plansEmptyTitle}>No coupons yet</p>
          <p className={styles.plansEmptyBody}>
            Create a promo code so listeners can get a discount at checkout.
          </p>
          {!readOnly && mode && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                setFormError(null);
                setAdding(true);
              }}
            >
              <Plus size={16} aria-hidden />
              Add Coupon
            </button>
          )}
        </div>
      )}

      {coupons.length > 0 && (
        <ul className={styles.planList}>
          {coupons.map((c) => {
            const expanded = expandedId === c.id;
            return (
              <li key={c.id} className={styles.planItem}>
                <div
                  className={`${styles.planItemMain}${
                    c.active ? '' : ` ${styles.planItemInactive}`
                  }`}
                >
                  <div className={styles.planItemTop}>
                    <span className={styles.planKind}>{c.code}</span>
                    <span className={styles.planPrice}>{discountLabel(c)}</span>
                  </div>
                  <div className={styles.planItemMeta}>
                    <span
                      className={c.active ? styles.planPillOn : styles.planPillOff}
                    >
                      {c.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className={styles.planPillMuted}>
                      {durationLabel(c)}
                    </span>
                    <span className={styles.planPillMuted}>
                      {c.redemptionCount}
                      {c.maxRedemptions != null
                        ? ` / ${c.maxRedemptions}`
                        : ''}{' '}
                      uses
                    </span>
                    {c.name ? (
                      <span className={styles.planPillMuted}>{c.name}</span>
                    ) : null}
                  </div>
                  {(c.startsAt || c.endsAt) && (
                    <p className={styles.muted}>
                      {c.startsAt ? formatDate(c.startsAt) : 'No start'}
                      {' → '}
                      {c.endsAt ? formatDate(c.endsAt) : 'No end'}
                    </p>
                  )}
                  {c.syncError ? (
                    <p className={styles.error} style={{ marginTop: '0.35rem' }}>
                      {c.syncError}
                    </p>
                  ) : null}
                  {expanded && (
                    <div className={styles.couponUses}>
                      {c.redemptions.length === 0 ? (
                        <p className={styles.muted}>No successful uses yet.</p>
                      ) : (
                        <ul className={styles.couponUsesList}>
                          {c.redemptions.map((r) => (
                            <li key={r.id}>
                              <span>{r.customerEmail || 'Unknown email'}</span>
                              <span className={styles.muted}>
                                {formatDate(r.createdAt)}
                              </span>
                              <span className={styles.muted}>
                                {r.subscriptionId.slice(0, 10)}…
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                <div className={styles.planActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                  >
                    {expanded ? 'Hide uses' : 'Show uses'}
                  </button>
                  {c.couponUrl && (
                    <a
                      className={`${styles.secondaryBtn} ${styles.planActionsStripe}`}
                      href={c.couponUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={14} aria-hidden />
                      Stripe
                    </a>
                  )}
                  {!readOnly && (
                    <div className={styles.planActionsManage}>
                      <button
                        type="button"
                        className={`${styles.secondaryBtn}${
                          c.active ? ` ${styles.warningBtn}` : ''
                        }`}
                        disabled={busy}
                        onClick={() => setPendingToggle(c)}
                      >
                        {c.active ? (
                          <PowerOff size={14} strokeWidth={2} aria-hidden />
                        ) : (
                          <Power size={14} strokeWidth={2} aria-hidden />
                        )}
                        {c.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className={`${styles.secondaryBtn} ${styles.dangerBtn}`}
                        disabled={busy}
                        onClick={() => setPendingDelete(c)}
                      >
                        <Trash2 size={14} aria-hidden />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <StripeConfirmDialog
        open={pendingDelete != null}
        title="Delete coupon?"
        description={
          pendingDelete
            ? `Delete “${pendingDelete.code}”? Listeners will no longer be able to use it.`
            : ''
        }
        pending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />

      <StripeConfirmDialog
        open={pendingToggle != null}
        title={pendingToggle?.active ? 'Deactivate coupon?' : 'Activate coupon?'}
        description={
          pendingToggle
            ? pendingToggle.active
              ? `Deactivate “${pendingToggle.code}”? It will stop appearing for new checkouts.`
              : `Activate “${pendingToggle.code}”?`
            : ''
        }
        confirmLabel={pendingToggle?.active ? 'Deactivate' : 'Activate'}
        pendingLabel={
          pendingToggle?.active ? 'Deactivating…' : 'Activating…'
        }
        pending={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingToggle(null);
        }}
        onConfirm={() => {
          if (!pendingToggle) return;
          updateMutation.mutate({
            couponId: pendingToggle.id,
            body: { active: !pendingToggle.active },
          });
        }}
      />
    </div>
  );
}
