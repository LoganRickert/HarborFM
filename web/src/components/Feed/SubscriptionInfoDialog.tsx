import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Lock,
  X,
  Unlock,
  LogOut,
  Mail,
  ArrowRight,
  TriangleAlert,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import {
  createPublicStripeBillingPortal,
  createPublicStripeCheckout,
  getPublicStripePlans,
  getPublicStripeSubscriptionStatus,
  recoverPublicStripeToken,
  regeneratePublicStripeToken,
  renewPublicStripeSubscription,
  setPublicStripeCancelAtPeriodEnd,
  requestPublicStripeRefund,
  type PublicStripePlan,
} from '../../api/public';
import { useSubscriberAuth } from '../../hooks/useSubscriberAuth';
import { StripeConfirmDialog } from '../StripePayments/StripeConfirmDialog';
import styles from './SubscriptionInfoDialog.module.css';

interface SubscriptionInfoDialogProps {
  open: boolean;
  onClose: () => void;
  isSubscriberOnly: boolean;
  podcastSlug: string;
}

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

function planKindLabel(kind: string): string {
  if (kind === 'month') return 'Monthly';
  if (kind === 'year') return 'Yearly';
  return 'One-time';
}

function subscriptionStatusLabel(sub: {
  status: string;
  isOneTime: boolean;
  cancelAtPeriodEnd: boolean;
}): string {
  if (sub.status === 'refunded' || sub.status === 'canceled') return 'Canceled';
  if (sub.status === 'paused') return 'Paused';
  if (sub.status === 'past_due') return 'Past due';
  if (sub.status === 'one_time') return 'One-time access';
  if (sub.cancelAtPeriodEnd) return 'Cancels at period end';
  if (sub.status === 'active' || sub.status === 'trialing') {
    return sub.isOneTime ? 'One-time access' : 'Active';
  }
  return sub.status;
}

function planBillingHint(plan: PublicStripePlan): string {
  if (plan.kind === 'month') {
    return plan.autoRenewDefault ? 'Billed every month' : 'Monthly access';
  }
  if (plan.kind === 'year') {
    return plan.autoRenewDefault ? 'Billed every year' : 'Yearly access';
  }
  return 'Pay once, keep access';
}

function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SubscriptionInfoDialog({
  open,
  onClose,
  isSubscriberOnly,
  podcastSlug,
}: SubscriptionInfoDialogProps) {
  const queryClient = useQueryClient();
  const [tokenInput, setTokenInput] = useState('');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageBusy, setManageBusy] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [refundRequestOpen, setRefundRequestOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedRss, setCopiedRss] = useState(false);
  const { getTokenIdForPodcast, authenticate, logout, isLoading, error, checkStatus } =
    useSubscriberAuth();

  // Cookie/session present (includes manage-only when access is paused).
  const isAuthenticated = Boolean(getTokenIdForPodcast(podcastSlug));

  const { data: stripeData } = useQuery({
    queryKey: ['public-stripe-plans', podcastSlug],
    queryFn: () => getPublicStripePlans(podcastSlug),
    enabled: open && Boolean(podcastSlug) && !isAuthenticated,
    staleTime: 30_000,
  });

  const {
    data: subStatus,
    isLoading: statusLoading,
    isError: statusMissing,
  } = useQuery({
    queryKey: ['public-stripe-subscription-status', podcastSlug],
    queryFn: () => getPublicStripeSubscriptionStatus(podcastSlug),
    enabled: open && Boolean(podcastSlug) && isAuthenticated,
    staleTime: 15_000,
    retry: false,
  });

  if (!open) return null;

  const stripePlans = stripeData?.enabled ? stripeData.plans : [];
  const showTokenRecover = Boolean(stripeData?.mode);

  const dialogTitle = isAuthenticated
    ? 'Manage Subscription'
    : isSubscriberOnly
      ? 'Subscription Required'
      : 'Premium Episodes Available';

  const lockMessage = isAuthenticated
    ? null
    : isSubscriberOnly
      ? 'This podcast is subscriber-only. You must subscribe to access all episodes.'
      : null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    await authenticate(tokenInput.trim(), podcastSlug);
  };

  const handleLogout = async () => {
    await logout(podcastSlug);
  };

  const handleSubscribe = async (planId: string) => {
    setCheckoutError(null);
    setCheckoutPlanId(planId);
    try {
      const { url } = await createPublicStripeCheckout(podcastSlug, planId);
      window.location.assign(url);
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Could not start checkout');
      setCheckoutPlanId(null);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoverEmail.trim()) return;
    setRecoverError(null);
    setRecoverMessage(null);
    setRecoverLoading(true);
    try {
      const result = await recoverPublicStripeToken(podcastSlug, recoverEmail.trim());
      setRecoverMessage(result.message);
    } catch (err) {
      setRecoverError(
        err instanceof Error ? err.message : 'Could not send access token',
      );
    } finally {
      setRecoverLoading(false);
    }
  };

  const refreshStatus = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['public-stripe-subscription-status', podcastSlug],
    });
  };

  const handlePortal = async () => {
    setManageError(null);
    setManageBusy(true);
    try {
      const { url } = await createPublicStripeBillingPortal(podcastSlug, {
        returnUrl: window.location.href,
      });
      window.location.assign(url);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Could not open billing portal');
      setManageBusy(false);
    }
  };

  const handleCancelToggle = async (cancel: boolean) => {
    setManageError(null);
    setManageBusy(true);
    try {
      await setPublicStripeCancelAtPeriodEnd(podcastSlug, cancel);
      await refreshStatus();
    } catch (err) {
      setManageError(
        err instanceof Error ? err.message : 'Could not update auto-renew',
      );
    } finally {
      setManageBusy(false);
    }
  };

  const handleRenew = async () => {
    setManageError(null);
    setManageBusy(true);
    try {
      const result = await renewPublicStripeSubscription(podcastSlug);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      await refreshStatus();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Could not renew');
    } finally {
      setManageBusy(false);
    }
  };

  const handleRegenerate = async () => {
    setManageError(null);
    setManageBusy(true);
    try {
      const { token } = await regeneratePublicStripeToken(podcastSlug);
      setNewToken(token);
      setCopiedToken(false);
      setCopiedRss(false);
      setRegenerateOpen(false);
      await checkStatus();
      await refreshStatus();
      // Keep dialog scrolled so the new token is visible at the top
      requestAnimationFrame(() => {
        const el = document.querySelector(`.${styles.newTokenBox}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    } catch (err) {
      setManageError(
        err instanceof Error ? err.message : 'Could not regenerate token',
      );
    } finally {
      setManageBusy(false);
    }
  };

  const handleRequestRefund = async () => {
    setManageError(null);
    setManageBusy(true);
    try {
      await requestPublicStripeRefund(podcastSlug);
      setRefundRequestOpen(false);
      await refreshStatus();
    } catch (err) {
      setManageError(
        err instanceof Error ? err.message : 'Could not request refund',
      );
    } finally {
      setManageBusy(false);
    }
  };

  const periodLabel = formatPeriodEnd(subStatus?.currentPeriodEnd ?? null);
  const newPrivateRssUrl = newToken
    ? `${window.location.origin}/api/public/podcasts/${encodeURIComponent(podcastSlug)}/private/${encodeURIComponent(newToken)}/rss`
    : null;

  return (
    <>
    <div
      className={styles.overlay}
      onClick={() => {
        if (!regenerateOpen && !refundRequestOpen && !manageBusy) onClose();
      }}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <Lock
            size={20}
            strokeWidth={2}
            className={isSubscriberOnly ? styles.lockIconGold : styles.lockIcon}
          />
          <h3 className={styles.title}>{dialogTitle}</h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {lockMessage && <p className={styles.message}>{lockMessage}</p>}

        {isAuthenticated && subStatus?.stripeMode === 'test' && (
          <span className={`${styles.testPill} ${styles.testPillBelow}`}>
            <TriangleAlert size={12} strokeWidth={2.5} aria-hidden />
            Test
          </span>
        )}

        {isAuthenticated && (
          <div className={styles.manageSection}>
            {newToken && newPrivateRssUrl && (
              <div className={styles.newTokenBox} role="status">
                <p className={styles.newTokenTitle}>New private RSS feed</p>
                <p className={styles.helpText}>
                  Save these somewhere safe. You will not see them again here, and your old
                  feed URL will stop working.
                </p>
                <code className={styles.newToken}>{newPrivateRssUrl}</code>
                <button
                  type="button"
                  className={styles.unlockButton}
                  onClick={() => {
                    void navigator.clipboard.writeText(newPrivateRssUrl).then(() => {
                      setCopiedRss(true);
                      setTimeout(() => setCopiedRss(false), 2000);
                    });
                  }}
                >
                  {copiedRss ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                  {copiedRss ? 'Copied' : 'Copy RSS feed'}
                </button>
                <p className={styles.newTokenLabel}>Access token</p>
                <code className={styles.newToken}>{newToken}</code>
                <button
                  type="button"
                  className={styles.recoverButton}
                  onClick={() => {
                    void navigator.clipboard.writeText(newToken).then(() => {
                      setCopiedToken(true);
                      setTimeout(() => setCopiedToken(false), 2000);
                    });
                  }}
                >
                  {copiedToken ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                  {copiedToken ? 'Copied' : 'Copy token'}
                </button>
              </div>
            )}

            {statusLoading && (
              <p className={styles.helpText}>Loading subscription…</p>
            )}
            {!statusLoading && statusMissing && (
              <p className={styles.helpText}>
                Access is active via your subscriber token. Stripe billing management is not
                linked to this token.
              </p>
            )}
            {subStatus && (
              <>
                <div className={styles.statusCard}>
                  <div className={styles.statusRow}>
                    <span className={styles.statusLabel}>Status</span>
                    <span className={styles.statusValue}>
                      {subscriptionStatusLabel(subStatus)}
                    </span>
                  </div>
                  {subStatus.plan && (
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Plan</span>
                      <span className={styles.statusValue}>
                        {planKindLabel(subStatus.plan.kind)} ·{' '}
                        {formatMoney(
                          subStatus.plan.amountCents,
                          subStatus.plan.currency,
                        )}
                      </span>
                    </div>
                  )}
                  {periodLabel && !subStatus.isOneTime && (
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>
                        {subStatus.cancelAtPeriodEnd ? 'Access until' : 'Renews'}
                      </span>
                      <span className={styles.statusValue}>{periodLabel}</span>
                    </div>
                  )}
                </div>

                <div className={styles.manageActions}>
                  {subStatus.canManageBilling && (
                    <button
                      type="button"
                      className={styles.managePrimary}
                      disabled={manageBusy}
                      onClick={() => void handlePortal()}
                    >
                      <ExternalLink size={18} aria-hidden />
                      Manage billing
                    </button>
                  )}
                  {subStatus.canCancelAtPeriodEnd && !subStatus.cancelAtPeriodEnd && (
                    <button
                      type="button"
                      className={styles.manageSecondary}
                      disabled={manageBusy}
                      onClick={() => void handleCancelToggle(true)}
                    >
                      Turn off auto-renew
                    </button>
                  )}
                  {subStatus.refundRequest?.status === 'pending' && (
                    <p className={styles.refundStatus}>Refund request pending</p>
                  )}
                  {subStatus.refundRequest?.status === 'rejected' && (
                    <p className={styles.refundStatus}>Refund denied</p>
                  )}
                  {subStatus.canRequestRefund && (
                    <button
                      type="button"
                      className={styles.manageSecondary}
                      disabled={manageBusy}
                      onClick={() => setRefundRequestOpen(true)}
                    >
                      Request refund
                    </button>
                  )}
                  {subStatus.canRenew && (
                    <button
                      type="button"
                      className={styles.manageSecondary}
                      disabled={manageBusy}
                      onClick={() => void handleRenew()}
                    >
                      <RefreshCw size={18} aria-hidden />
                      {subStatus.cancelAtPeriodEnd
                        ? 'Keep auto-renewing'
                        : 'Renew now'}
                    </button>
                  )}
                  {subStatus.canRegenerateAccessToken && (
                    <button
                      type="button"
                      className={styles.manageSecondary}
                      disabled={manageBusy}
                      onClick={() => setRegenerateOpen(true)}
                    >
                      Regenerate access token
                    </button>
                  )}
                </div>
              </>
            )}

            {manageError && <div className={styles.errorCard}>{manageError}</div>}

            <button
              type="button"
              onClick={handleLogout}
              className={styles.logoutButton}
              disabled={isLoading}
            >
              <LogOut size={18} />
              {isLoading ? 'Logging out...' : 'Logout'}
            </button>
          </div>
        )}

        {!isAuthenticated && stripePlans.length > 0 && (
          <div className={styles.stripePlans}>
            <div className={styles.stripePlansHeader}>
              <p className={styles.stripePlansLabel}>Subscribe with Stripe</p>
              {stripeData?.mode === 'test' && (
                <span className={styles.testPill}>
                  <TriangleAlert size={12} strokeWidth={2.5} aria-hidden />
                  Test
                </span>
              )}
            </div>
            <ul className={styles.stripePlanList}>
              {stripePlans.map((plan) => {
                const busy = checkoutPlanId != null;
                const thisBusy = checkoutPlanId === plan.id;
                return (
                  <li key={plan.id}>
                    <button
                      type="button"
                      className={styles.stripePlanCard}
                      disabled={busy}
                      onClick={() => void handleSubscribe(plan.id)}
                    >
                      <div className={styles.stripePlanCardMain}>
                        <span className={styles.stripePlanKind}>
                          {planKindLabel(plan.kind)}
                        </span>
                        <span className={styles.stripePlanPrice}>
                          {formatMoney(plan.amountCents, plan.currency)}
                        </span>
                        <span className={styles.stripePlanHint}>
                          {planBillingHint(plan)}
                        </span>
                      </div>
                      <span className={styles.stripePlanCta}>
                        {thisBusy ? 'Redirecting…' : 'Subscribe'}
                        {!thisBusy && (
                          <ArrowRight size={16} strokeWidth={2} aria-hidden />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {checkoutError && <div className={styles.errorCard}>{checkoutError}</div>}
            <p className={styles.termsNotice}>
              Payments are non-refundable except where required by law. Recurring plans renew
              automatically until you cancel. Canceling stops future charges; you keep access
              through the current period with no prorated refund. By continuing, you agree to the{' '}
              <Link to="/terms#subscriptions" className={styles.termsLink} target="_blank" rel="noopener noreferrer">
                Terms of Service
              </Link>
              .
            </p>
            <div className={styles.orDivider}>
              <span>or unlock with an existing token</span>
            </div>
          </div>
        )}

        {!isAuthenticated && (
          <>
            <form onSubmit={handleUnlock} className={styles.form}>
              <label htmlFor="token-input" className={styles.label}>
                Enter your subscriber token or RSS feed URL
              </label>
              <input
                id="token-input"
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="hfm_sub_... or paste RSS URL"
                className={styles.input}
                disabled={isLoading}
              />
              <p className={styles.helpText}>
                Paste your private RSS feed URL or subscriber token
              </p>
              {error && <div className={styles.errorCard}>{error}</div>}
              <button
                type="submit"
                className={styles.unlockButton}
                disabled={isLoading || !tokenInput.trim()}
              >
                {isLoading ? (
                  'Authenticating...'
                ) : (
                  <>
                    <Unlock size={18} />
                    Unlock Content
                  </>
                )}
              </button>
            </form>

            {showTokenRecover && (
              <form onSubmit={handleRecover} className={styles.recoverForm}>
                <div className={styles.orDivider}>
                  <span>lost your token?</span>
                </div>
                <label htmlFor="recover-email" className={styles.label}>
                  Email a new copy of your access token
                </label>
                <input
                  id="recover-email"
                  type="email"
                  autoComplete="email"
                  value={recoverEmail}
                  onChange={(e) => setRecoverEmail(e.target.value)}
                  placeholder="Email used at checkout"
                  className={styles.input}
                  disabled={recoverLoading}
                />
                <p className={styles.helpText}>
                  Use the same email you entered when purchasing with Stripe
                </p>
                {recoverError && <div className={styles.errorCard}>{recoverError}</div>}
                {recoverMessage && (
                  <div className={styles.successCard}>{recoverMessage}</div>
                )}
                <button
                  type="submit"
                  className={styles.recoverButton}
                  disabled={recoverLoading || !recoverEmail.trim()}
                >
                  {recoverLoading ? (
                    'Sending…'
                  ) : (
                    <>
                      <Mail size={18} />
                      Email my access token
                    </>
                  )}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>

    <StripeConfirmDialog
      open={regenerateOpen}
      title="Regenerate access token?"
      description="Your current token and private RSS URLs will stop working immediately. Apps using the old feed URL must be updated with the new token."
      confirmLabel="Regenerate"
      pendingLabel="Regenerating…"
      pending={manageBusy}
      onOpenChange={setRegenerateOpen}
      onConfirm={() => void handleRegenerate()}
    />

    <StripeConfirmDialog
      open={refundRequestOpen}
      title="Request a refund?"
      description="The show owner will review your request. If approved, access ends and payment is refunded through Stripe."
      confirmLabel="Request refund"
      pendingLabel="Submitting…"
      pending={manageBusy}
      onOpenChange={setRefundRequestOpen}
      onConfirm={() => void handleRequestRefund()}
    />
    </>
  );
}
