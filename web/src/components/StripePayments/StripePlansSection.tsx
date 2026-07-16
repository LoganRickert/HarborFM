import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ExternalLink, Plus, Power, PowerOff, Trash2, X } from 'lucide-react';
import {
  listPodcastStripePlans,
  createPodcastStripePlan,
  updatePodcastStripePlan,
  deletePodcastStripePlan,
  type StripePlan,
  type StripePlanKind,
} from '../../api/stripe';
import { StripeConfirmDialog } from './StripeConfirmDialog';
import localStyles from './StripePayments.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

const KIND_LABEL: Record<StripePlanKind, string> = {
  month: 'Monthly',
  year: 'Yearly',
  one_time: 'One-time',
};

const KIND_ORDER: StripePlanKind[] = ['month', 'year', 'one_time'];

/** Common Stripe currencies (code + label). Zero-decimal currencies use whole units. */
const CURRENCIES: Array<{ code: string; label: string; zeroDecimal?: boolean }> = [
  { code: 'usd', label: 'US Dollar' },
  { code: 'eur', label: 'Euro' },
  { code: 'gbp', label: 'British Pound' },
  { code: 'cad', label: 'Canadian Dollar' },
  { code: 'aud', label: 'Australian Dollar' },
  { code: 'nzd', label: 'New Zealand Dollar' },
  { code: 'chf', label: 'Swiss Franc' },
  { code: 'sek', label: 'Swedish Krona' },
  { code: 'nok', label: 'Norwegian Krone' },
  { code: 'dkk', label: 'Danish Krone' },
  { code: 'pln', label: 'Polish Złoty' },
  { code: 'mxn', label: 'Mexican Peso' },
  { code: 'brl', label: 'Brazilian Real' },
  { code: 'inr', label: 'Indian Rupee' },
  { code: 'sgd', label: 'Singapore Dollar' },
  { code: 'hkd', label: 'Hong Kong Dollar' },
  { code: 'jpy', label: 'Japanese Yen', zeroDecimal: true },
];

function currencyMeta(code: string) {
  return CURRENCIES.find((c) => c.code === code.toLowerCase());
}

function formatMoney(cents: number, currency: string): string {
  const zero = currencyMeta(currency)?.zeroDecimal;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: zero ? 0 : 2,
      maximumFractionDigits: zero ? 0 : 2,
    }).format(zero ? cents : cents / 100);
  } catch {
    return zero
      ? `${cents} ${currency.toUpperCase()}`
      : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function amountToCents(raw: string, currency: string): number | null {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (currencyMeta(currency)?.zeroDecimal) return Math.round(n);
  return Math.round(n * 100);
}

interface StripePlansSectionProps {
  podcastId: string;
  /** Selected Stripe account - scopes the plans query cache to that account. */
  stripeCredentialsId: string | null;
  readOnly?: boolean;
  enabled: boolean;
}

export function StripePlansSection({
  podcastId,
  stripeCredentialsId,
  readOnly = false,
  enabled,
}: StripePlansSectionProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftKind, setDraftKind] = useState<StripePlanKind>('month');
  const [draftAmount, setDraftAmount] = useState('5.00');
  const [draftCurrency, setDraftCurrency] = useState('usd');
  const [draftAutoRenew, setDraftAutoRenew] = useState(true);
  const [planPendingDelete, setPlanPendingDelete] = useState<StripePlan | null>(null);
  const [planPendingToggle, setPlanPendingToggle] = useState<StripePlan | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['podcast-stripe-plans', podcastId, stripeCredentialsId],
    queryFn: () => listPodcastStripePlans(podcastId),
    enabled: enabled && Boolean(stripeCredentialsId),
  });

  const subscriberCounts = data?.subscriberCounts;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['podcast-stripe-plans', podcastId] });
    void queryClient.invalidateQueries({ queryKey: ['podcast-stripe', podcastId] });
  };

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createPodcastStripePlan>[1]) =>
      createPodcastStripePlan(podcastId, body),
    onSuccess: () => {
      setFormError(null);
      setAdding(false);
      setDraftAmount('5.00');
      setDraftAutoRenew(true);
      invalidate();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      planId,
      body,
    }: {
      planId: string;
      body: Parameters<typeof updatePodcastStripePlan>[2];
    }) => updatePodcastStripePlan(podcastId, planId, body),
    onSuccess: () => {
      setFormError(null);
      setPlanPendingToggle(null);
      invalidate();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => deletePodcastStripePlan(podcastId, planId),
    onSuccess: () => {
      setFormError(null);
      setPlanPendingDelete(null);
      invalidate();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const plans = data?.plans ?? [];
  const mode = data?.mode;
  const activePlans = plans.filter((p) => p.active);
  const deactivatedPlans = plans.filter((p) => !p.active);
  const availableKinds = KIND_ORDER.filter(
    (k) => !activePlans.some((p) => p.kind === k),
  );
  const availableKindsKey = availableKinds.join(',');
  const activateBlockedKinds = new Set(
    activePlans.map((p) => p.kind),
  );
  const firstPlanCurrency = data?.plans?.[0]?.currency;

  useEffect(() => {
    setAdding(false);
    setFormError(null);
    setPlanPendingDelete(null);
    setPlanPendingToggle(null);
  }, [stripeCredentialsId]);

  useEffect(() => {
    if (firstPlanCurrency) {
      setDraftCurrency(firstPlanCurrency.toLowerCase());
    }
  }, [firstPlanCurrency]);

  useEffect(() => {
    if (!availableKindsKey) {
      setAdding(false);
      return;
    }
    const kinds = availableKindsKey.split(',') as StripePlanKind[];
    if (!kinds.includes(draftKind)) {
      setDraftKind(kinds[0]);
    }
  }, [availableKindsKey, draftKind]);

  if (!enabled) return null;

  function openAddForm() {
    setFormError(null);
    if (availableKinds[0]) setDraftKind(availableKinds[0]);
    setAdding(true);
  }

  function cancelAdd() {
    setAdding(false);
    setFormError(null);
  }

  function submitCreate() {
    setFormError(null);
    const kind = availableKinds.includes(draftKind) ? draftKind : availableKinds[0];
    if (!kind) {
      setFormError('All plan types already have an active plan.');
      return;
    }
    const currency = draftCurrency.trim().toLowerCase() || 'usd';
    const amountCents = amountToCents(draftAmount, currency);
    if (amountCents == null) {
      setFormError('Enter a valid price greater than zero.');
      return;
    }
    createMutation.mutate({
      kind,
      amountCents,
      currency,
      autoRenewDefault: kind === 'one_time' ? false : draftAutoRenew,
      active: true,
    });
  }

  const zeroDecimal = Boolean(currencyMeta(draftCurrency)?.zeroDecimal);
  const busy =
    updateMutation.isPending || deleteMutation.isPending || createMutation.isPending;

  return (
    <div className={styles.plansBlock}>
      <div className={styles.plansHeader}>
        <div>
          <h3 className={styles.plansTitle}>Subscription plans</h3>
          <p className={styles.plansSubtitle}>
            Set the prices listeners pay to subscribe to this show.
          </p>
          {mode === 'test' && (
            <div className={styles.fieldWarning} role="status">
              <CircleAlert size={16} className={styles.fieldWarningIcon} aria-hidden />
              <p className={styles.fieldWarningMessage}>
                Test and live mode keep separate subscription plans. Plans you create here will
                need to be remade when you switch to live mode.
              </p>
            </div>
          )}
        </div>
      </div>

      {subscriberCounts && mode ? (
        <div className={styles.subscriberStats} aria-live="polite">
          <div className={styles.subscriberStatsIntro}>
            <span className={styles.subscriberStatsEyebrow}>Active subscribers</span>
            <strong className={styles.subscriberStatsTotal}>
              {subscriberCounts.total === 0
                ? 'Waiting for the first listener'
                : subscriberCounts.total === 1
                  ? '1 listener supporting this show'
                  : `${subscriberCounts.total} listeners supporting this show`}
            </strong>
          </div>
          <div className={styles.subscriberStatsGrid} role="list">
            {(
              [
                {
                  key: 'month',
                  label: 'Monthly',
                  value: subscriberCounts.month,
                  revenueCents: subscriberCounts.monthRevenueCents,
                  revenueSuffix: ' / month',
                },
                {
                  key: 'year',
                  label: 'Yearly',
                  value: subscriberCounts.year,
                  revenueCents: subscriberCounts.yearRevenueCents,
                  revenueSuffix: ' / year',
                },
                {
                  key: 'one_time',
                  label: 'One-time',
                  value: subscriberCounts.one_time,
                  revenueCents: subscriberCounts.oneTimeRevenueCents,
                  revenueSuffix: ' total',
                },
              ] as const
            ).map((item) => (
              <div
                key={item.key}
                role="listitem"
                className={
                  item.value > 0
                    ? styles.subscriberStatLive
                    : styles.subscriberStat
                }
              >
                <span className={styles.subscriberStatValue}>{item.value}</span>
                <span className={styles.subscriberStatLabel}>{item.label}</span>
                {item.revenueCents > 0 && subscriberCounts.currency ? (
                  <span className={styles.subscriberStatRevenue}>
                    {formatMoney(item.revenueCents, subscriberCounts.currency)}
                    {item.revenueSuffix}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!readOnly && mode && availableKinds.length > 0 && !adding && (
        <div className={styles.addPlanRow}>
          <button type="button" className={styles.secondaryBtn} onClick={openAddForm}>
            <Plus size={16} strokeWidth={2} aria-hidden />
            Add Plan
          </button>
        </div>
      )}

      {adding && mode && !readOnly && availableKinds.length > 0 && (
        <div className={styles.planForm}>
          <div className={styles.planFormHeader}>
            <h4 className={styles.planFormTitle}>New Plan</h4>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={cancelAdd}
              aria-label="Cancel"
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          <div className={styles.planFormField}>
            <span className={styles.plansSettingLabel}>Plan Type</span>
            <div className={styles.segmented} role="group" aria-label="Plan Type">
              {availableKinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={
                    draftKind === k ? styles.segmentedActive : styles.segmentedBtn
                  }
                  aria-pressed={draftKind === k}
                  onClick={() => setDraftKind(k)}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.planFormRow}>
            <label className={styles.label}>
              Price
              <input
                className={styles.input}
                inputMode="decimal"
                value={draftAmount}
                onChange={(e) => setDraftAmount(e.target.value)}
                placeholder={zeroDecimal ? '500' : '5.00'}
                autoFocus
              />
            </label>
            <label className={styles.label}>
              Currency
              <select
                className={styles.input}
                value={draftCurrency}
                onChange={(e) => {
                  const next = e.target.value;
                  const wasZero = currencyMeta(draftCurrency)?.zeroDecimal;
                  const nowZero = currencyMeta(next)?.zeroDecimal;
                  setDraftCurrency(next);
                  if (wasZero !== nowZero) {
                    setDraftAmount(nowZero ? '500' : '5.00');
                  }
                }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code.toUpperCase()} - {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draftKind !== 'one_time' && (
            <label className={`toggle ${styles.enableRow}`}>
              <input
                type="checkbox"
                checked={draftAutoRenew}
                onChange={(e) => setDraftAutoRenew(e.target.checked)}
              />
              <span className="toggle__track" aria-hidden="true" />
              <span>Auto-renew by default</span>
            </label>
          )}

          <div className={styles.planFormActions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={cancelAdd}
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={createMutation.isPending}
              onClick={submitCreate}
            >
              <Plus size={16} strokeWidth={2} aria-hidden />
              {createMutation.isPending ? 'Creating…' : 'Add Plan'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className={styles.pdCardEmptyState}>Loading plans…</p>
      ) : isError ? (
        <p className={styles.error}>Failed to load plans.</p>
      ) : !mode ? (
        <p className={styles.pdCardEmptyState}>
          Select a Stripe account with keys before adding plans.
        </p>
      ) : (
        <>
          {plans.length === 0 && !adding ? (
            <div className={styles.plansEmpty}>
              <p className={styles.plansEmptyTitle}>No plans yet</p>
              <p className={styles.plansEmptyBody}>
                Add a monthly, yearly, or one-time price to start accepting payments.
              </p>
            </div>
          ) : (
            <>
              {activePlans.length > 0 && (
                <ul className={styles.planList}>
                  {KIND_ORDER.flatMap((kind) =>
                    activePlans
                      .filter((p) => p.kind === kind)
                      .map((plan) => (
                        <PlanRow
                          key={plan.id}
                          plan={plan}
                          readOnly={readOnly}
                          busy={busy}
                          activateDisabled={false}
                          onToggleActive={() => setPlanPendingToggle(plan)}
                          onDelete={() => setPlanPendingDelete(plan)}
                        />
                      )),
                  )}
                </ul>
              )}

              {deactivatedPlans.length > 0 && (
                <div className={styles.plansDeactivated}>
                  <h4 className={styles.plansDeactivatedTitle}>Deactivated</h4>
                  <ul className={styles.planList}>
                    {KIND_ORDER.flatMap((kind) =>
                      deactivatedPlans
                        .filter((p) => p.kind === kind)
                        .map((plan) => (
                          <PlanRow
                            key={plan.id}
                            plan={plan}
                            readOnly={readOnly}
                            busy={busy}
                            activateDisabled={activateBlockedKinds.has(plan.kind)}
                            onToggleActive={() => setPlanPendingToggle(plan)}
                            onDelete={() => setPlanPendingDelete(plan)}
                          />
                        )),
                    )}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}

      {formError && (
        <div className={styles.fieldError} role="alert">
          <p className={styles.fieldErrorMessage}>{formError}</p>
        </div>
      )}

      <StripeConfirmDialog
        open={planPendingToggle != null}
        title={
          planPendingToggle?.active ? 'Deactivate plan?' : 'Activate plan?'
        }
        description={
          planPendingToggle
            ? planPendingToggle.active
              ? `Deactivate the ${KIND_LABEL[planPendingToggle.kind]} plan? Listeners won’t see it at checkout until you turn it back on.`
              : `Activate the ${KIND_LABEL[planPendingToggle.kind]} plan? Listeners will be able to choose it at checkout.`
            : ''
        }
        confirmLabel={planPendingToggle?.active ? 'Deactivate' : 'Activate'}
        pendingLabel={
          planPendingToggle?.active ? 'Deactivating…' : 'Activating…'
        }
        pending={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPlanPendingToggle(null);
        }}
        onConfirm={() => {
          if (!planPendingToggle) return;
          updateMutation.mutate({
            planId: planPendingToggle.id,
            body: { active: !planPendingToggle.active },
          });
        }}
      />

      <StripeConfirmDialog
        open={planPendingDelete != null}
        title="Delete plan?"
        description={
          planPendingDelete
            ? planPendingDelete.kind === 'one_time'
              ? `Delete the ${KIND_LABEL[planPendingDelete.kind]} plan? The Stripe product will be archived. Existing one-time purchases keep access.`
              : `Delete the ${KIND_LABEL[planPendingDelete.kind]} plan? This will cancel all active subscriptions on this plan in the current mode and revoke their access immediately. The Stripe product will also be archived.`
            : ''
        }
        pending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPlanPendingDelete(null);
        }}
        onConfirm={() => {
          if (planPendingDelete) deleteMutation.mutate(planPendingDelete.id);
        }}
      />
    </div>
  );
}

function PlanRow({
  plan,
  readOnly,
  busy,
  activateDisabled,
  onToggleActive,
  onDelete,
}: {
  plan: StripePlan;
  readOnly: boolean;
  busy: boolean;
  activateDisabled: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const activateBlocked = !plan.active && activateDisabled;
  return (
    <li className={`${styles.planItem}${plan.active ? '' : ` ${styles.planItemInactive}`}`}>
      <div className={styles.planItemMain}>
        <div className={styles.planItemTop}>
          <span className={styles.planKind}>{KIND_LABEL[plan.kind]}</span>
          <span className={styles.planPrice}>
            {formatMoney(plan.amountCents, plan.currency)}
            {plan.kind === 'month' ? (
              <span className={styles.planPriceSuffix}> / month</span>
            ) : plan.kind === 'year' ? (
              <span className={styles.planPriceSuffix}> / year</span>
            ) : null}
          </span>
        </div>
        <div className={styles.planItemMeta}>
          <span className={plan.active ? styles.planPillOn : styles.planPillOff}>
            {plan.active ? 'Active' : 'Inactive'}
          </span>
          {plan.kind !== 'one_time' ? (
            <span className={styles.planPillMuted}>
              {plan.autoRenewDefault ? 'Auto-renew' : 'Manual renew'}
            </span>
          ) : null}
        </div>
        {plan.syncError ? (
          <p className={styles.error} style={{ marginTop: '0.35rem' }}>
            {plan.syncError}
          </p>
        ) : null}
        {activateBlocked ? (
          <p className={styles.planActivateHint}>
            Deactivate the current {KIND_LABEL[plan.kind].toLowerCase()} plan before
            reactivating this one.
          </p>
        ) : null}
      </div>
      <div className={styles.planActions}>
        {plan.productUrl && (
          <a
            className={`${styles.secondaryBtn} ${styles.planActionsStripe}`}
            href={plan.productUrl}
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
                plan.active ? ` ${styles.warningBtn}` : ''
              }`}
              disabled={busy || activateBlocked}
              title={
                activateBlocked
                  ? `An active ${KIND_LABEL[plan.kind].toLowerCase()} plan already exists`
                  : undefined
              }
              onClick={onToggleActive}
            >
              {plan.active ? (
                <PowerOff size={14} strokeWidth={2} aria-hidden />
              ) : (
                <Power size={14} strokeWidth={2} aria-hidden />
              )}
              {plan.active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              type="button"
              className={styles.deleteIconBtn}
              disabled={busy}
              onClick={onDelete}
              aria-label="Delete plan"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
