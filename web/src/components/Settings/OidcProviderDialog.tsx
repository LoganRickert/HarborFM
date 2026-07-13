import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Copy, Check } from 'lucide-react';
import { UnsavedChangesConfirmDialog } from '../UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import { useBaselineDirty, snapshotForDirty } from '../../hooks/useBaselineDirty';
import sharedStyles from '../PodcastDetail/shared.module.css';
import styles from '../../pages/Settings.module.css';

export type OidcProvider = {
  id?: string;
  name?: string;
  discoveryUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  trustEmail?: boolean;
  /** Simple Icons slug (e.g. google, keycloak). See simpleicons.org */
  iconSlug?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
};

const emptyProvider = (): OidcProvider => ({
  id: '',
  name: '',
  discoveryUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  trustEmail: true,
  iconSlug: '',
  buttonBgColor: '',
  buttonTextColor: '',
});

interface OidcProviderDialogProps {
  open: boolean;
  onClose: () => void;
  provider?: OidcProvider | null;
  baseUrl: string;
  onSubmit: (provider: OidcProvider) => void;
}

export function OidcProviderDialog({
  open,
  onClose,
  provider,
  baseUrl,
  onSubmit,
}: OidcProviderDialogProps) {
  const [form, setForm] = useState<OidcProvider>(emptyProvider);
  const [error, setError] = useState<string | null>(null);
  const [formBaseline, setFormBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const next = provider ? { ...emptyProvider(), ...provider } : emptyProvider();
      setForm(next);
      setFormBaseline(snapshotForDirty(next));
      setError(null);
    }
  }, [open, provider]);

  const update = (updates: Partial<OidcProvider>) => {
    setForm((prev) => ({ ...prev, ...updates }));
    setError(null);
  };

  function validate(): string | null {
    const id = (form.id ?? '').trim();
    const name = (form.name ?? '').trim();
    const clientId = (form.clientId ?? '').trim();
    const discoveryUrl = (form.discoveryUrl ?? '').trim();
    const authEndpoint = (form.authorizationEndpoint ?? '').trim();
    const tokenEndpoint = (form.tokenEndpoint ?? '').trim();

    if (!id) return 'Provider ID is required.';
    if (!name) return 'Display name is required.';
    if (!clientId) return 'Client ID is required.';

    if (discoveryUrl) {
      try {
        new URL(discoveryUrl);
      } catch {
        return 'Discovery URL must be a valid URL.';
      }
    } else if (authEndpoint && tokenEndpoint) {
      try {
        new URL(authEndpoint);
        new URL(tokenEndpoint);
      } catch {
        return 'Authorization and token endpoints must be valid URLs.';
      }
    } else {
      return 'Discovery URL, or both Authorization and token endpoints, are required.';
    }

    return null;
  }

  const handleSave = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    onSubmit(form);
    onClose();
  };

  const isEdit = !!provider;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = baseUrl || origin;
  const providerId = (form.id ?? '').trim() || 'your-provider-id';
  const callbackUrl = base
    ? `${base}/api/auth/sso/oidc/callback/${providerId}`
    : `Set Hostname above or use: ${origin || 'https://yoursite.com'}/api/auth/sso/oidc/callback/${providerId}`;

  const [copied, setCopied] = useState(false);
  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  const isDirty = useBaselineDirty(formBaseline, form);
  const {
    confirmOpen,
    requestClose,
    onOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
  } = useDialogCloseGuard({ isDirty, onClose });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={sharedStyles.dialogOverlay} />
        <Dialog.Content
          className={`${sharedStyles.dialogContent} ${sharedStyles.dialogContentWide} ${sharedStyles.dialogContentScrollable}`}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            dialogContentProps.onPointerDownOutside(e);
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            dialogContentProps.onInteractOutside(e);
          }}
          onEscapeKeyDown={dialogContentProps.onEscapeKeyDown}
        >
          <div className={sharedStyles.dialogHeaderRow}>
            <Dialog.Title className={sharedStyles.dialogTitle}>
              {isEdit ? 'Edit OIDC Provider' : 'Add OIDC Provider'}
            </Dialog.Title>
            <button
              type="button"
              className={sharedStyles.dialogClose}
              aria-label="Close"
              onClick={requestClose}
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <Dialog.Description className={sharedStyles.dialogDescription}>
            {isEdit
              ? 'Update the OIDC provider settings.'
              : 'Configure an OpenID Connect provider. Use a discovery URL or enter endpoints manually.'}
          </Dialog.Description>

          {error && (
            <div className={styles.noticeError} style={{ margin: '0 1.5rem 1rem' }}>
              <span className={styles.noticeTitle}>{error}</span>
            </div>
          )}

          <div className={sharedStyles.dialogBodyScroll}>
            <form
              id="oidc-provider-form"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSave();
              }}
              className={sharedStyles.form}
            >
            <label className={styles.label}>
              Provider ID
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. google"
                value={String(form.id ?? '')}
                onChange={(e) => update({ id: e.target.value.trim() })}
              />
              <p className={styles.inputHelp}>
                Unique identifier used in URLs. Letters, numbers, hyphens only.
              </p>
            </label>
            <div className={styles.callbackUrlCard}>
              <p className={styles.callbackUrlLabel}>Allowed Callback URL</p>
              <div className={styles.callbackUrlRow}>
                <p className={styles.callbackUrlValue}>{callbackUrl}</p>
                <button
                  type="button"
                  className={styles.callbackUrlCopyBtn}
                  onClick={() => copyToClipboard(callbackUrl)}
                  title="Copy to clipboard"
                  aria-label="Copy to clipboard"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <label className={styles.label}>
              Display Name
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. Google"
                value={String(form.name ?? '')}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Discovery URL
              <input
                type="url"
                className={styles.input}
                placeholder="https://accounts.google.com"
                value={form.discoveryUrl ?? ''}
                onChange={(e) =>
                  update({
                    discoveryUrl: e.target.value.trim(),
                    authorizationEndpoint: e.target.value.trim()
                      ? undefined
                      : form.authorizationEndpoint,
                    tokenEndpoint: e.target.value.trim()
                      ? undefined
                      : form.tokenEndpoint,
                  })
                }
              />
              <p className={styles.inputHelp}>
                Leave blank to use manual endpoints below.
              </p>
            </label>
            {form.discoveryUrl && (
              <label className={styles.label}>
                Issuer Override (Optional)
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. https://keycloak.local/realms/myrealm"
                  value={String(form.issuer ?? '')}
                  onChange={(e) => update({ issuer: e.target.value.trim() })}
                />
                <p className={styles.inputHelp}>
                  If you get &quot;issuer does not match&quot;, set this to the
                  exact issuer from your IdP&apos;s
                  .well-known/openid-configuration.
                </p>
              </label>
            )}
            {!form.discoveryUrl && (
              <>
                <label className={styles.label}>
                  Authorization Endpoint
                  <input
                    type="url"
                    className={styles.input}
                    placeholder="https://idp.example.com/oauth/authorize"
                    value={form.authorizationEndpoint ?? ''}
                    onChange={(e) =>
                      update({ authorizationEndpoint: e.target.value.trim() })
                    }
                  />
                </label>
                <label className={styles.label}>
                  Token Endpoint
                  <input
                    type="url"
                    className={styles.input}
                    placeholder="https://idp.example.com/oauth/token"
                    value={form.tokenEndpoint ?? ''}
                    onChange={(e) =>
                      update({ tokenEndpoint: e.target.value.trim() })
                    }
                  />
                </label>
                <label className={styles.label}>
                  UserInfo Endpoint (Optional)
                  <input
                    type="url"
                    className={styles.input}
                    placeholder="https://idp.example.com/oauth/userinfo"
                    value={form.userinfoEndpoint ?? ''}
                    onChange={(e) =>
                      update({ userinfoEndpoint: e.target.value.trim() })
                    }
                  />
                </label>
              </>
            )}
            <label className={styles.label}>
              Client ID
              <input
                type="text"
                className={styles.input}
                placeholder="Your OAuth client ID"
                value={form.clientId ?? ''}
                onChange={(e) => update({ clientId: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Client Secret
              <input
                type="password"
                className={styles.input}
                placeholder={
                  form.clientSecret === '(set)' ? '(saved)' : 'Enter client secret'
                }
                value={form.clientSecret === '(set)' ? '' : (form.clientSecret ?? '')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' && form.clientSecret === '(set)') return;
                  update({ clientSecret: v || undefined });
                }}
                autoComplete="off"
              />
              <p className={styles.inputHelp}>
                Enter new value to change; leave blank and save to keep existing.
                Use &quot;(set)&quot; when editing to preserve.
              </p>
            </label>
            <label className={styles.label}>
              Scopes
              <input
                type="text"
                className={styles.input}
                placeholder="openid profile email"
                value={form.scopes ?? 'openid profile email'}
                onChange={(e) => update({ scopes: e.target.value })}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.trustEmail ?? true}
                onChange={(e) => update({ trustEmail: e.target.checked })}
              />
              <span className="toggle__track" aria-hidden="true" />
              <span>Trust email from provider (use for account linking)</span>
            </label>
            <fieldset className={styles.ssoButtonAppearanceFieldset}>
              <legend className={styles.ssoButtonAppearanceLegend}>Login button appearance</legend>
              <label className={styles.label}>
                Icon (Simple Icons slug)
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. google, keycloak, okta"
                  value={form.iconSlug ?? ''}
                  onChange={(e) => update({ iconSlug: e.target.value.trim() || undefined })}
                />
                <p className={`${styles.inputHelp} ${styles.inputHelpWithMargin}`}>
                  Slug from <a href="https://simpleicons.org" target="_blank" rel="noopener noreferrer" className={styles.link}>simpleicons.org</a> (e.g. google, apple, keycloak, okta, github, auth0).
                </p>
              </label>
              <div className={styles.ssoButtonColorRow}>
                <label className={styles.label}>
                  Button background
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. #4285f4"
                    value={form.buttonBgColor ?? ''}
                    onChange={(e) => update({ buttonBgColor: e.target.value.trim() || undefined })}
                  />
                </label>
                <label className={styles.label}>
                  Button text color
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. #ffffff"
                    value={form.buttonTextColor ?? ''}
                    onChange={(e) => update({ buttonTextColor: e.target.value.trim() || undefined })}
                  />
                </label>
              </div>
            </fieldset>
            </form>
          </div>
          <div
            className={`${sharedStyles.dialogFooter} ${sharedStyles.dialogFooterCancelLeft}`}
          >
            <button
              type="button"
              className={sharedStyles.cancel}
              onClick={requestClose}
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              className={sharedStyles.submit}
              aria-label={isEdit ? 'Save provider' : 'Add provider'}
              onClick={handleSave}
            >
              {isEdit ? 'Save' : 'Add'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      <UnsavedChangesConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </Dialog.Root>
  );
}
