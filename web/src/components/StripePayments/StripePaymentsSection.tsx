import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ExternalLink, Plus, Copy, Check, CircleAlert, Trash2, Info, LoaderCircle, X } from 'lucide-react';
import { me } from '../../api/auth';
import { getPublicConfig } from '../../api/public';
import {
  listPodcastStripeCredentials,
  createStripeCredentials,
  updateStripeCredentials,
  deleteStripeCredentials,
  updatePodcastStripe,
  verifyStripeCredentials,
  type StripeCredentials,
  type StripeCredentialsInput,
  type StripeMode,
  type StripeVerifyResult,
} from '../../api/stripe';
import { getSiteDisplayName } from '../../utils/siteBranding';
import { StripePlansSection } from './StripePlansSection';
import { StripeCouponsSection } from './StripeCouponsSection';
import { StripeRefundRequestsSection } from './StripeRefundRequestsSection';
import { StripeConfirmDialog } from './StripeConfirmDialog';
import localStyles from './StripePayments.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface StripePaymentsSectionProps {
  podcastId: string;
  readOnly?: boolean;
}

const TOTAL_STEPS = 5;

const STRIPE_DASHBOARD = {
  testKeys: 'https://dashboard.stripe.com/test/apikeys',
  liveKeys: 'https://dashboard.stripe.com/apikeys',
  testWebhooks: 'https://dashboard.stripe.com/test/webhooks',
  liveWebhooks: 'https://dashboard.stripe.com/webhooks',
  restrictedHelp:
    'https://docs.stripe.com/keys/restricted-api-keys',
};

/** Exact Stripe Dashboard resource names this app needs (all Write). */
const RESTRICTED_KEY_PERMISSIONS = [
  {
    id: 'customers',
    resource: 'Customers',
    why: 'Checkout creates a Stripe customer for each listener so their subscription, invoices, and refunds stay linked.',
  },
  {
    id: 'charges-refunds',
    resource: 'Charges and Refunds',
    why: 'Used when you approve a listener refund request. We look up the charge and issue the refund in Stripe.',
  },
  {
    id: 'payment-intents',
    resource: 'Payment Intents',
    why: 'Reads payment details for one-time purchases and refunds so access and refund status stay in sync.',
  },
  {
    id: 'products',
    resource: 'Products',
    why: 'Creates and updates Stripe products when you add or change subscription plans for this show.',
  },
  {
    id: 'coupons',
    resource: 'Coupons',
    why: 'Creates and deletes discount coupons you configure in Harbor for this show.',
  },
  {
    id: 'customer-portal',
    resource: 'Customer Portal',
    why: 'Opens Stripe’s customer portal so listeners can update payment methods or cancel on their own.',
  },
  {
    id: 'invoices',
    resource: 'Invoices',
    why: 'Looks up invoices for renewals and refunds, and can create invoices when managing subscriptions.',
  },
  {
    id: 'prices',
    resource: 'Prices',
    why: 'Creates and updates the prices attached to each subscription plan (monthly, yearly, one-time).',
  },
  {
    id: 'promotion-codes',
    resource: 'Promotion Codes',
    why: 'Creates the redeemable promo codes listeners enter at checkout for your coupons.',
  },
  {
    id: 'subscriptions',
    resource: 'Subscriptions',
    why: 'Syncs, updates, pauses, and cancels listener subscriptions when they change plans or request a refund.',
  },
  {
    id: 'checkout-sessions',
    resource: 'Checkout Sessions',
    why: 'Starts Stripe Checkout when a listener subscribes, and retrieves the session after they pay.',
  },
] as const;

type WizardForm = {
  displayName: string;
  mode: StripeMode;
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
};

const EMPTY_WIZARD: WizardForm = {
  displayName: '',
  mode: 'test',
  secretKey: '',
  publishableKey: '',
  webhookSecret: '',
};

function isPlaceholderKey(value: string): boolean {
  return value === '(set)';
}

/** Non-blocking: unrestricted secret key instead of restricted. */
function restrictedKeyWarning(value: string): string | null {
  const v = value.trim();
  if (!v || isPlaceholderKey(v)) return null;
  if (v.startsWith('sk_test_') || v.startsWith('sk_live_')) {
    return 'This looks like an unrestricted secret key (sk_…). A restricted key (rk_…) is recommended.';
  }
  return null;
}

function restrictedKeyError(value: string, mode: StripeMode): string | null {
  const v = value.trim();
  if (!v || isPlaceholderKey(v)) return null;
  if (mode === 'test' && (v.startsWith('rk_live_') || v.startsWith('sk_live_'))) {
    return 'This is a live key. Paste a test restricted key (rk_test_…), or create a separate live Stripe account.';
  }
  if (mode === 'live' && (v.startsWith('rk_test_') || v.startsWith('sk_test_'))) {
    return 'This is a test key. Paste a live restricted key (rk_live_…), or create a separate test Stripe account.';
  }
  const rkPrefix = mode === 'live' ? 'rk_live_' : 'rk_test_';
  const skPrefix = mode === 'live' ? 'sk_live_' : 'sk_test_';
  if (!v.startsWith(rkPrefix) && !v.startsWith(skPrefix)) {
    return `Restricted key must start with ${rkPrefix}`;
  }
  return null;
}

function publishableKeyError(value: string, mode: StripeMode): string | null {
  const v = value.trim();
  if (!v || isPlaceholderKey(v)) return null;
  const expected = mode === 'live' ? 'pk_live_' : 'pk_test_';
  if (mode === 'test' && v.startsWith('pk_live_')) {
    return 'This is a live publishable key. Paste a test key (pk_test_…), or create a separate live Stripe account.';
  }
  if (mode === 'live' && v.startsWith('pk_test_')) {
    return 'This is a test publishable key. Paste a live key (pk_live_…), or create a separate test Stripe account.';
  }
  if (!v.startsWith(expected)) {
    return `Publishable key must start with ${expected}`;
  }
  return null;
}

function webhookSecretError(value: string): string | null {
  const v = value.trim();
  if (!v || isPlaceholderKey(v)) return null;
  if (!v.startsWith('whsec_')) {
    return 'Webhook signing secret must start with whsec_';
  }
  return null;
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function secretPlaceholder(set: boolean): string {
  return set ? '(set)' : '';
}

function packHasActiveSecret(pack: StripeCredentials): boolean {
  return pack.activeSecretKeySet;
}

export function StripePaymentsSection({
  podcastId,
  readOnly = false,
}: StripePaymentsSectionProps) {
  const queryClient = useQueryClient();
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const canStripe = meData?.user?.canStripe === 1;
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig'],
    queryFn: getPublicConfig,
    staleTime: 10_000,
  });
  const siteName = getSiteDisplayName(publicConfig?.whiteLabel);
  const instanceUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://your-harborfm-hostname';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['podcast-stripe', podcastId],
    queryFn: () => listPodcastStripeCredentials(podcastId),
    enabled: canStripe,
  });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<WizardForm>(EMPTY_WIZARD);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedField, setCopiedField] = useState<'name' | 'url' | null>(null);
  const [openPermissionInfo, setOpenPermissionInfo] = useState<string | null>(null);
  const permissionsListRef = useRef<HTMLDivElement | null>(null);
  const [verifyResult, setVerifyResult] = useState<StripeVerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  /** After create in step 4, hold pack so we can show webhook URL before finish. */
  const [draftPack, setDraftPack] = useState<StripeCredentials | null>(null);
  const [packPendingDelete, setPackPendingDelete] = useState<StripeCredentials | null>(null);

  useEffect(() => {
    if (!openPermissionInfo) return;
    function onPointerDown(e: PointerEvent) {
      const el = permissionsListRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpenPermissionInfo(null);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPermissionInfo]);

  async function runVerify(credentialsId: string) {
    setVerifyLoading(true);
    setVerifyError(null);
    setVerifyResult(null);
    try {
      const result = await verifyStripeCredentials(credentialsId);
      setVerifyResult(result);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'Verification failed');
      setVerifyResult(null);
    } finally {
      setVerifyLoading(false);
    }
  }

  useEffect(() => {
    if (step !== 5) return;
    const id = draftPack?.id ?? editingId;
    if (!id) return;
    void runVerify(id);
  }, [step, draftPack?.id, editingId]);

  const credentials = data?.credentials ?? [];
  const selectedId = data?.stripeCredentialsId ?? null;
  const paymentsEnabled = Boolean(data?.stripePaymentsEnabled);
  const canEditPacks = Boolean(data?.canEditPacks);
  const hasAccounts = credentials.length > 0;

  const selectedPack = useMemo(
    () => (data?.credentials ?? []).find((c) => c.id === selectedId) ?? null,
    [data?.credentials, selectedId],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['podcast-stripe', podcastId] });
    queryClient.invalidateQueries({ queryKey: ['podcast-stripe-plans', podcastId] });
    queryClient.invalidateQueries({ queryKey: ['stripe-credentials'] });
  };

  const createMutation = useMutation({
    mutationFn: (body: StripeCredentialsInput) => createStripeCredentials(body),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; body: StripeCredentialsInput }) =>
      updateStripeCredentials(vars.id, vars.body),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStripeCredentials(id),
    onSuccess: () => {
      setPackPendingDelete(null);
      invalidate();
    },
  });

  const attachMutation = useMutation({
    mutationFn: (body: {
      stripeCredentialsId?: string | null;
      stripePaymentsEnabled?: boolean;
    }) => updatePodcastStripe(podcastId, body),
    onSuccess: invalidate,
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  function resetWizard() {
    setWizardOpen(false);
    setEditingId(null);
    setStep(1);
    setForm(EMPTY_WIZARD);
    setFormError(null);
    setDraftPack(null);
    setOpenPermissionInfo(null);
    setVerifyResult(null);
    setVerifyError(null);
    setVerifyLoading(false);
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_WIZARD);
    setStep(1);
    setFormError(null);
    setDraftPack(null);
    setOpenPermissionInfo(null);
    setVerifyResult(null);
    setVerifyError(null);
    setWizardOpen(true);
  }

  function openEdit(pack: StripeCredentials) {
    setEditingId(pack.id);
    setDraftPack(pack);
    setForm({
      displayName: pack.displayName,
      mode: pack.mode,
      secretKey: secretPlaceholder(
        pack.mode === 'live' ? pack.liveSecretKeySet : pack.testSecretKeySet,
      ),
      publishableKey: secretPlaceholder(
        pack.mode === 'live' ? pack.livePublishableKeySet : pack.testPublishableKeySet,
      ),
      webhookSecret: secretPlaceholder(
        pack.mode === 'live' ? pack.liveWebhookSecretSet : pack.testWebhookSecretSet,
      ),
    });
    setStep(1);
    setFormError(null);
    setVerifyResult(null);
    setVerifyError(null);
    setWizardOpen(true);
  }

  function buildModeKeyedPayload(
    wizard: WizardForm,
    opts?: { includeWebhook?: boolean; includeMode?: boolean },
  ): StripeCredentialsInput {
    const out: StripeCredentialsInput = {
      displayName: wizard.displayName.trim() || 'Stripe',
    };
    if (opts?.includeMode) out.mode = wizard.mode;
    const secret =
      wizard.secretKey === '(set)' ? undefined : wizard.secretKey.trim();
    const publishable =
      wizard.publishableKey === '(set)' ? undefined : wizard.publishableKey.trim();
    const webhook =
      wizard.webhookSecret === '(set)' ? undefined : wizard.webhookSecret.trim();

    if (wizard.mode === 'live') {
      if (secret !== undefined) out.liveSecretKey = secret;
      if (publishable !== undefined) out.livePublishableKey = publishable;
      if (opts?.includeWebhook && webhook !== undefined) out.liveWebhookSecret = webhook;
    } else {
      if (secret !== undefined) out.testSecretKey = secret;
      if (publishable !== undefined) out.testPublishableKey = publishable;
      if (opts?.includeWebhook && webhook !== undefined) out.testWebhookSecret = webhook;
    }
    return out;
  }

  function validateStep(current: number): string | null {
    if (current === 1) {
      if (!form.displayName.trim()) return 'Give this Stripe account a name (e.g. “Main Stripe”).';
      return null;
    }
    if (current === 2) return null;
    if (current === 3) {
      const editingKeepsSecret = Boolean(editingId && form.secretKey === '(set)');
      const editingKeepsPub = Boolean(editingId && form.publishableKey === '(set)');
      if (!editingKeepsSecret && !form.secretKey.trim()) {
        return 'Paste your restricted key from Stripe’s Token column (starts with rk_).';
      }
      if (!editingKeepsPub && !form.publishableKey.trim()) {
        return 'Paste your Stripe publishable key (starts with pk_).';
      }
      const secretErr = restrictedKeyError(form.secretKey, form.mode);
      if (secretErr) return secretErr;
      const pubErr = publishableKeyError(form.publishableKey, form.mode);
      if (pubErr) return pubErr;
      return null;
    }
    return null;
  }

  async function goNext() {
    setFormError(null);
    const err = validateStep(step);
    if (err) {
      setFormError(err);
      return;
    }

    // Entering step 4: create or update pack so we have a webhook URL
    if (step === 3) {
      try {
        const payload = buildModeKeyedPayload(form, {
          includeWebhook: false,
          includeMode: !editingId,
        });
        if (editingId) {
          const updated = await updateMutation.mutateAsync({
            id: editingId,
            body: payload,
          });
          setDraftPack(updated);
        } else if (!draftPack) {
          const created = await createMutation.mutateAsync(payload);
          setDraftPack(created);
          setEditingId(created.id);
          // Auto-select only when this is the user's first Stripe account
          if (credentials.length === 0) {
            await updatePodcastStripe(podcastId, {
              stripeCredentialsId: created.id,
              stripePaymentsEnabled: true,
            });
          }
          invalidate();
        }
        setStep(4);
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Could not save Stripe account');
      }
      return;
    }

    // Entering step 5 (verify): require valid webhook secret format if provided
    if (step === 4) {
      const whErr = webhookSecretError(form.webhookSecret);
      if (whErr) {
        setFormError(whErr);
        return;
      }
      setVerifyResult(null);
      setVerifyError(null);
      setStep(5);
      return;
    }

    // Mode is fixed after create - skip mode step when editing
    if (step === 1 && editingId) {
      setStep(3);
      return;
    }

    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  async function finishWizard() {
    setFormError(null);
    if (!draftPack && !editingId) {
      setFormError('Missing Stripe account. Go back and try again.');
      return;
    }
    if (verifyLoading) {
      setFormError('Wait for verification to finish.');
      return;
    }
    if (!verifyResult?.ok) {
      setFormError(
        'Fix the failed checks below (or re-run verification) before finishing setup.',
      );
      return;
    }
    const webhookErr = webhookSecretError(form.webhookSecret);
    if (webhookErr) {
      setFormError(webhookErr);
      return;
    }
    const id = draftPack?.id ?? editingId!;
    try {
      const payload = buildModeKeyedPayload(form, { includeWebhook: true });
      await updateMutation.mutateAsync({ id, body: payload });
      const otherPacks = credentials.filter((c) => c.id !== id);
      const shouldSelect =
        selectedId === id || (selectedId == null && otherPacks.length === 0);
      if (shouldSelect) {
        await updatePodcastStripe(podcastId, {
          stripeCredentialsId: id,
          stripePaymentsEnabled: true,
        });
      }
      invalidate();
      resetWizard();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not finish setup');
    }
  }

  function goBack() {
    setFormError(null);
    if (step === 3 && editingId) {
      setStep(1);
      return;
    }
    setStep((s) => Math.max(1, s - 1));
  }

  function copyText(value: string, field: 'name' | 'url' | 'webhook') {
    navigator.clipboard.writeText(value).then(() => {
      if (field === 'webhook') {
        setCopiedWebhook(true);
        setTimeout(() => setCopiedWebhook(false), 2000);
      } else {
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
      }
    });
  }

  function copyWebhook(url: string) {
    copyText(url, 'webhook');
  }

  if (!canStripe) {
    return (
      <div className={styles.card}>
        <div className={styles.exportHeader}>
          <div className={styles.exportTitle}>
            <CreditCard size={18} strokeWidth={2} aria-hidden="true" />
            <h2 className={styles.sectionTitle}>Stripe Payments</h2>
          </div>
        </div>
        <p className={styles.pdCardSectionSub}>
          Stripe is not enabled for your account. Ask an administrator to turn on Can Stripe.
        </p>
      </div>
    );
  }

  const keysDashboard =
    form.mode === 'live' ? STRIPE_DASHBOARD.liveKeys : STRIPE_DASHBOARD.testKeys;
  const webhooksDashboard =
    form.mode === 'live' ? STRIPE_DASHBOARD.liveWebhooks : STRIPE_DASHBOARD.testWebhooks;
  const webhookUrl = draftPack?.webhookUrl ?? selectedPack?.webhookUrl ?? null;
  const secretKeyModeError = restrictedKeyError(form.secretKey, form.mode);
  const secretKeySkWarning = restrictedKeyWarning(form.secretKey);
  const pubKeyError = publishableKeyError(form.publishableKey, form.mode);
  const webhookErr = webhookSecretError(form.webhookSecret);

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <CreditCard size={18} strokeWidth={2} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>Stripe Payments</h2>
          {selectedPack && (
            <span
              className={
                selectedPack.mode === 'live'
                  ? styles.headerModeLive
                  : styles.headerModeTest
              }
            >
              {selectedPack.mode === 'live' ? 'Live' : 'Test'}
            </span>
          )}
        </div>
        {!readOnly && canEditPacks && hasAccounts && !wizardOpen && (
          <div className={styles.exportHeaderActions}>
            <button type="button" className={styles.secondaryBtn} onClick={openCreate}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              Add Another Account
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className={styles.pdCardEmptyState}>Loading Stripe settings…</p>
      ) : isError ? (
        <p className={styles.error}>Failed to load Stripe credentials.</p>
      ) : wizardOpen && !readOnly && canEditPacks ? (
        <div className={styles.wizard}>
          <ol className={styles.wizardSteps} aria-label="Setup steps">
            {['Name', 'Mode', 'API keys', 'Webhook', 'Verify'].map((label, i) => {
              const n = i + 1;
              const className = [
                styles.wizardStep,
                n === step ? styles.wizardStepActive : '',
                n < step ? styles.wizardStepDone : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={label} className={className}>
                  {n}. {label}
                </li>
              );
            })}
          </ol>

          {step === 1 && (
            <>
              <h3 className={styles.wizardTitle}>Name this Stripe account</h3>
              <p className={styles.wizardHelp}>
                Pick a label you will recognize later (you can reuse this account on your other
                shows).
              </p>
              <label className={styles.label}>
                Display name
                <input
                  className={styles.input}
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="e.g. Main Stripe"
                  autoFocus
                />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <h3 className={styles.wizardTitle}>Test or live account?</h3>
              <p className={styles.wizardHelp}>
                Each account is either test or live and cannot be switched later. Use a test account
                while setting up, then add a separate live account and select it on this show when
                you are ready for real payments.
              </p>
              <div className={styles.modeCards}>
                <button
                  type="button"
                  className={`${styles.modeCard}${form.mode === 'test' ? ` ${styles.modeCardActive}` : ''}`}
                  onClick={() => setForm((f) => ({ ...f, mode: 'test' }))}
                >
                  <span className={styles.modeCardTitle}>Test (recommended)</span>
                  <span className={styles.modeCardBody}>
                    Fake cards, no real money. Perfect for checking that everything works.
                  </span>
                </button>
                <button
                  type="button"
                  className={`${styles.modeCard}${form.mode === 'live' ? ` ${styles.modeCardActive}` : ''}`}
                  onClick={() => setForm((f) => ({ ...f, mode: 'live' }))}
                >
                  <span className={styles.modeCardTitle}>Live</span>
                  <span className={styles.modeCardBody}>
                    Real payments. Add this as a second account after you have verified the flow in
                    test.
                  </span>
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h3 className={styles.wizardTitle}>
                Paste your {form.mode === 'live' ? 'live' : 'test'} API keys
              </h3>
              <p className={styles.wizardHelp}>
                Stripe does not let apps pull your API keys automatically. Open Stripe, create a{' '}
                <strong>Restricted key</strong>, copy its <strong>Token</strong>, then copy your{' '}
                <strong>Publishable key</strong> from the <strong>Standard keys</strong> table on the
                same page.
              </p>
              <div className={styles.helperRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => openExternal(keysDashboard)}
                >
                  <ExternalLink size={14} aria-hidden />
                  Open Stripe API Keys
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => openExternal(STRIPE_DASHBOARD.restrictedHelp)}
                >
                  How To Make A Restricted Key
                </button>
              </div>
              <ol className={styles.stripeSteps}>
                <li>
                  Make sure you are in <strong>{form.mode === 'live' ? 'Live' : 'Test'}</strong> mode
                  in the Stripe Dashboard (toggle in the top right).
                </li>
                <li>
                  Click <strong>Create restricted key</strong>.
                </li>
                <li>
                  When Stripe asks <strong>How will you be using this key?</strong>, choose{' '}
                  <strong>Providing this key to a third-party application</strong>
                  {' '}(connect to a third-party application or plugin that needs access to Stripe).
                </li>
                <li>
                  Enter website details using the values below (click to copy):
                  <div className={styles.detailCard}>
                    <div className={styles.detailRow}>
                      <div className={styles.detailMeta}>
                        <span className={styles.detailLabel}>Name</span>
                        <span className={styles.detailValue}>{siteName}</span>
                      </div>
                      <button
                        type="button"
                        className={styles.detailCopyBtn}
                        onClick={() => copyText(siteName, 'name')}
                        aria-label={`Copy name ${siteName}`}
                      >
                        {copiedField === 'name' ? (
                          <Check size={14} aria-hidden />
                        ) : (
                          <Copy size={14} aria-hidden />
                        )}
                        {copiedField === 'name' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className={styles.detailRow}>
                      <div className={styles.detailMeta}>
                        <span className={styles.detailLabel}>URL</span>
                        <span className={styles.detailValue}>{instanceUrl}</span>
                      </div>
                      <button
                        type="button"
                        className={styles.detailCopyBtn}
                        onClick={() => copyText(instanceUrl, 'url')}
                        aria-label={`Copy URL ${instanceUrl}`}
                      >
                        {copiedField === 'url' ? (
                          <Check size={14} aria-hidden />
                        ) : (
                          <Copy size={14} aria-hidden />
                        )}
                        {copiedField === 'url' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </li>
                <li>
                  Click <strong>Customize permissions for this key</strong>. Set these to{' '}
                  <span className={styles.permissionLevel}>Write</span>. Set the others to None
                  unless you know you need it.
                  <div className={styles.permissionsGuide} ref={permissionsListRef}>
                    <ul className={styles.permissionsList}>
                      {RESTRICTED_KEY_PERMISSIONS.map((perm) => {
                        const infoOpen = openPermissionInfo === perm.id;
                        return (
                          <li key={perm.id} className={styles.permissionItem}>
                            <span className={styles.permissionName}>{perm.resource}</span>
                            <span className={styles.permissionInfoWrap}>
                              <button
                                type="button"
                                className={styles.permissionInfoBtn}
                                aria-label={`Why ${perm.resource} is needed`}
                                aria-expanded={infoOpen}
                                onClick={() =>
                                  setOpenPermissionInfo(infoOpen ? null : perm.id)
                                }
                              >
                                <Info size={13} strokeWidth={2.25} aria-hidden />
                              </button>
                              {infoOpen && (
                                <div className={styles.permissionInfoPopover} role="tooltip">
                                  {perm.why}
                                </div>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
                <li>
                  Click <strong>Create restricted key</strong> and complete any verification. Stripe
                  should show the full token once: click it to copy. It starts with{' '}
                  <code>{form.mode === 'live' ? 'rk_live_' : 'rk_test_'}</code>. That token is your
                  restricted key.
                </li>
                <li>
                  After that you land back on the API keys page under{' '}
                  <strong>Restricted keys</strong>. You will see Name / Token / Access policy for
                  your new key. The <strong>Token</strong> column is that same{' '}
                  <code>rk_…</code> key.
                </li>
                <li>
                  On the <strong>same</strong> API keys page, find the{' '}
                  <strong>Standard keys</strong> table (below Restricted keys). Copy the{' '}
                  <strong>Publishable key</strong> starting with{' '}
                  <code>{form.mode === 'live' ? 'pk_live_' : 'pk_test_'}</code>. Do not use the
                  unrestricted <strong>Secret key</strong> (<code>sk_…</code>) here.
                </li>
              </ol>
              <div className={styles.formGrid}>
                <label className={styles.label}>
                  Restricted key ({form.mode === 'live' ? 'rk_live_' : 'rk_test_'})
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="off"
                    value={form.secretKey}
                    onChange={(e) => setForm((f) => ({ ...f, secretKey: e.target.value }))}
                    placeholder={form.mode === 'live' ? 'rk_live_…' : 'rk_test_…'}
                    autoFocus
                  />
                  {secretKeyModeError && (
                    <div className={styles.fieldError} role="alert">
                      <CircleAlert size={16} className={styles.fieldErrorIcon} aria-hidden />
                      <p className={styles.fieldErrorMessage}>{secretKeyModeError}</p>
                    </div>
                  )}
                  {!secretKeyModeError && secretKeySkWarning && (
                    <div className={styles.fieldWarning} role="status">
                      <CircleAlert size={16} className={styles.fieldWarningIcon} aria-hidden />
                      <p className={styles.fieldWarningMessage}>{secretKeySkWarning}</p>
                    </div>
                  )}
                </label>
                <label className={styles.label}>
                  Publishable key ({form.mode === 'live' ? 'pk_live_' : 'pk_test_'})
                  <input
                    className={styles.input}
                    value={form.publishableKey}
                    onChange={(e) => setForm((f) => ({ ...f, publishableKey: e.target.value }))}
                    placeholder={form.mode === 'live' ? 'pk_live_…' : 'pk_test_…'}
                  />
                  {pubKeyError && (
                    <div className={styles.fieldError} role="alert">
                      <CircleAlert size={16} className={styles.fieldErrorIcon} aria-hidden />
                      <p className={styles.fieldErrorMessage}>{pubKeyError}</p>
                    </div>
                  )}
                </label>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h3 className={styles.wizardTitle}>Add a webhook in Stripe</h3>
              <p className={styles.wizardHelp}>
                Stripe will call HarborFM when someone pays or cancels. Create an endpoint in Stripe,
                paste the URL below, then copy the signing secret back here.
              </p>
              {webhookUrl && (
                <div className={styles.webhookBox}>
                  Webhook URL (copy into Stripe):
                  <code>{webhookUrl}</code>
                  <div className={styles.helperRow}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => copyWebhook(webhookUrl)}
                    >
                      {copiedWebhook ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                      {copiedWebhook ? 'Copied' : 'Copy URL'}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => openExternal(webhooksDashboard)}
                    >
                      <ExternalLink size={14} aria-hidden />
                      Open Stripe Webhooks
                    </button>
                  </div>
                </div>
              )}
              <label className={styles.label} style={{ marginTop: '0.75rem' }}>
                Webhook signing secret (whsec_…)
                <input
                  className={styles.input}
                  type="password"
                  autoComplete="off"
                  value={form.webhookSecret}
                  onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                  placeholder="whsec_… (optional for now; add before going live)"
                  aria-invalid={Boolean(webhookErr)}
                />
              </label>
              {webhookErr && (
                <div className={styles.fieldError} role="alert">
                  <p className={styles.fieldErrorMessage}>{webhookErr}</p>
                </div>
              )}
            </>
          )}

          {step === 5 && (
            <>
              <h3 className={styles.wizardTitle}>Verify your keys</h3>
              <p className={styles.wizardHelp}>
                We check that Stripe accepts your restricted and publishable keys, then probe Write
                access for each permission Harbor needs. Fake IDs are used so nothing is created in
                your Stripe account.
              </p>
              <div className={styles.verifyPanel}>
                {verifyLoading && (
                  <div className={styles.verifyStatusRow} role="status">
                    <LoaderCircle size={16} className={styles.verifySpinner} aria-hidden />
                    <span>Checking keys and permissions with Stripe…</span>
                  </div>
                )}
                {verifyError && !verifyLoading && (
                  <div className={styles.fieldError} role="alert">
                    <CircleAlert size={16} className={styles.fieldErrorIcon} aria-hidden />
                    <p className={styles.fieldErrorMessage}>{verifyError}</p>
                  </div>
                )}
                {verifyResult && !verifyLoading && (
                  <>
                    <div
                      className={
                        verifyResult.ok ? styles.verifyBannerOk : styles.verifyBannerFail
                      }
                      role="status"
                    >
                      {verifyResult.ok
                        ? verifyResult.checks.some((c) => c.status === 'unknown')
                          ? 'Keys look good. Some permission checks could not be confirmed; you can finish setup.'
                          : 'All checks passed. You can finish setup.'
                        : 'Some checks failed. Fix the restricted key permissions in Stripe, then re-check.'}
                    </div>
                    <ul className={styles.verifyList}>
                      {verifyResult.checks.map((check) => (
                        <li key={check.id} className={styles.verifyItem}>
                          <span
                            className={
                              check.status === 'ok'
                                ? styles.verifyIconOk
                                : check.status === 'fail'
                                  ? styles.verifyIconFail
                                  : styles.verifyIconUnknown
                            }
                            aria-hidden
                          >
                            {check.status === 'ok' ? (
                              <Check size={14} strokeWidth={2.5} />
                            ) : check.status === 'fail' ? (
                              <X size={14} strokeWidth={2.5} />
                            ) : (
                              <CircleAlert size={14} strokeWidth={2.5} />
                            )}
                          </span>
                          <div className={styles.verifyItemBody}>
                            <span className={styles.verifyItemLabel}>{check.label}</span>
                            {check.detail && (
                              <span className={styles.verifyItemDetail}>{check.detail}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!verifyLoading && (draftPack?.id || editingId) && (
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void runVerify((draftPack?.id ?? editingId)!)}
                  >
                    Re-check
                  </button>
                )}
              </div>
            </>
          )}

          {formError && <p className={styles.error}>{formError}</p>}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={saving}
              onClick={resetWizard}
            >
              Cancel
            </button>
            <div className={styles.formActionsEnd}>
              {step > 1 && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={saving}
                  onClick={goBack}
                >
                  Back
                </button>
              )}
              {step < TOTAL_STEPS ? (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={
                    saving ||
                    (step === 3 && Boolean(secretKeyModeError || pubKeyError)) ||
                    (step === 4 && Boolean(webhookErr))
                  }
                  onClick={() => void goNext()}
                >
                  {saving && step === 3 ? 'Saving…' : 'Continue'}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={
                    saving ||
                    verifyLoading ||
                    Boolean(verifyError) ||
                    !verifyResult?.ok
                  }
                  onClick={() => void finishWizard()}
                >
                  {saving ? 'Finishing…' : 'Finish Setup'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : !hasAccounts ? (
        <div className={styles.emptyFocus}>
          <p className={styles.emptyTitle}>You don&apos;t have any Stripe accounts yet</p>
          <p className={styles.emptyBody}>
            {canEditPacks
              ? 'Add a Stripe account to accept paid subscriptions for this show.'
              : 'The show owner needs to add a Stripe account before payments can be enabled.'}
          </p>
          {!readOnly && canEditPacks && (
            <button type="button" className={styles.primaryBtn} onClick={openCreate}>
              <Plus size={16} strokeWidth={2} aria-hidden />
              Add Stripe Account
            </button>
          )}
        </div>
      ) : (
        <>
          <p className={styles.pdCardSectionSub}>
            Choose which Stripe account this show uses. Create separate test and live accounts, then
            select the one you want for this show. You can reuse accounts across your other shows.
          </p>

          {selectedPack && packHasActiveSecret(selectedPack) && (
            <label className={`toggle ${styles.enableRow}`}>
              <input
                type="checkbox"
                checked={paymentsEnabled}
                disabled={readOnly || attachMutation.isPending}
                onChange={(e) =>
                  attachMutation.mutate({ stripePaymentsEnabled: e.target.checked })
                }
              />
              <span className="toggle__track" aria-hidden="true" />
              <span>Accept Stripe payments on this show</span>
            </label>
          )}

          <ul className={styles.packList}>
            {credentials.map((pack) => {
              const active = pack.id === selectedId;
              return (
                <li
                  key={pack.id}
                  className={`${styles.packItem}${active ? ` ${styles.packItemActive}` : ''}`}
                >
                  <div className={styles.packMeta}>
                    <span className={styles.packName}>{pack.displayName}</span>
                    <div className={styles.packBadges}>
                      <span
                        className={
                          pack.mode === 'live' ? styles.packModeLive : styles.packModeTest
                        }
                      >
                        {pack.mode === 'live' ? 'Live' : 'Test'}
                      </span>
                    </div>
                  </div>
                  <div className={styles.packActions}>
                    {!readOnly && (
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={attachMutation.isPending || active}
                        onClick={() =>
                          attachMutation.mutate({
                            stripeCredentialsId: pack.id,
                            stripePaymentsEnabled: true,
                          })
                        }
                      >
                        {active ? 'Selected' : 'Select'}
                      </button>
                    )}
                    {!readOnly && canEditPacks && (
                      <>
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={() => openEdit(pack)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${styles.secondaryBtn} ${styles.dangerBtn}`}
                          disabled={deleteMutation.isPending}
                          onClick={() => setPackPendingDelete(pack)}
                          aria-label={`Delete ${pack.displayName}`}
                        >
                          <Trash2 size={14} strokeWidth={2} aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {selectedPack && (
            <div className={styles.webhookBox}>
              Webhook URL for the selected account:
              <div className={styles.webhookUrlRow}>
                <code>{selectedPack.webhookUrl}</code>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => copyWebhook(selectedPack.webhookUrl)}
                  aria-label="Copy webhook URL"
                >
                  {copiedWebhook ? (
                    <Check size={14} aria-hidden />
                  ) : (
                    <Copy size={14} aria-hidden />
                  )}
                  {copiedWebhook ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <StripePlansSection
            podcastId={podcastId}
            stripeCredentialsId={selectedId}
            readOnly={readOnly}
            enabled={Boolean(
              selectedPack &&
                packHasActiveSecret(selectedPack) &&
                paymentsEnabled,
            )}
          />

          <StripeCouponsSection
            podcastId={podcastId}
            stripeCredentialsId={selectedId}
            readOnly={readOnly}
            enabled={Boolean(
              selectedPack &&
                packHasActiveSecret(selectedPack) &&
                paymentsEnabled,
            )}
          />

          <StripeRefundRequestsSection
            podcastId={podcastId}
            readOnly={readOnly}
            enabled={Boolean(
              selectedPack &&
                packHasActiveSecret(selectedPack) &&
                paymentsEnabled,
            )}
          />

          {formError && <p className={styles.error}>{formError}</p>}
        </>
      )}

      <StripeConfirmDialog
        open={packPendingDelete != null}
        title="Delete Stripe account?"
        description={
          packPendingDelete
            ? `Delete “${packPendingDelete.displayName}”? Shows using it will be unlinked.`
            : ''
        }
        pending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPackPendingDelete(null);
        }}
        onConfirm={() => {
          if (packPendingDelete) deleteMutation.mutate(packPendingDelete.id);
        }}
      />
    </div>
  );
}
