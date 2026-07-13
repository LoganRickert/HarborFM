import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Copy, Check } from 'lucide-react';
import { UnsavedChangesConfirmDialog } from '../UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import { useBaselineDirty, snapshotForDirty } from '../../hooks/useBaselineDirty';
import sharedStyles from '../PodcastDetail/shared.module.css';
import styles from '../../pages/Settings.module.css';

export type SamlProvider = {
  id?: string;
  name?: string;
  entryPoint?: string;
  issuer?: string;
  callbackUrl?: string;
  cert?: string;
  idpCert?: string;
  subjectAttribute?: string;
  emailAttribute?: string;
  trustEmail?: boolean;
  /** When true, require the IdP to sign the assertion. Default false. */
  wantAssertionsSigned?: boolean;
  /** Simple Icons slug (e.g. google, keycloak). See simpleicons.org */
  iconSlug?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
};

const emptyProvider = (): SamlProvider => ({
  id: '',
  name: '',
  entryPoint: '',
  cert: '',
  idpCert: '',
  trustEmail: true,
  wantAssertionsSigned: false,
  iconSlug: '',
  buttonBgColor: '',
  buttonTextColor: '',
});

interface SamlProviderDialogProps {
  open: boolean;
  onClose: () => void;
  provider?: SamlProvider | null;
  baseUrl: string;
  onSubmit: (provider: SamlProvider) => void;
}

export function SamlProviderDialog({
  open,
  onClose,
  provider,
  baseUrl,
  onSubmit,
}: SamlProviderDialogProps) {
  const [form, setForm] = useState<SamlProvider>(() => emptyProvider());
  const [formBaseline, setFormBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const next = provider ? { ...emptyProvider(), ...provider } : emptyProvider();
      setForm(next);
      setFormBaseline(snapshotForDirty(next));
    }
  }, [open, provider]);

  const update = (updates: Partial<SamlProvider>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
    onClose();
  };

  const isEdit = !!provider;
  const baseNoSlash = baseUrl?.replace(/\/$/, '') ?? '';
  const clientId = baseNoSlash
    ? `${baseNoSlash}/api/auth/sso/saml`
    : 'Set Hostname above to see your client ID';
  const callbackUrl =
    baseUrl && (form.id ?? '').trim()
      ? `${baseNoSlash}/api/auth/sso/saml/callback/${(form.id ?? '').trim()}`
      : baseUrl
        ? `${baseNoSlash}/api/auth/sso/saml/callback/provider-id`
        : 'Set Hostname above to see your callback URL';

  const [copiedKey, setCopiedKey] = useState<'clientId' | 'callbackUrl' | null>(null);
  const copyToClipboard = (text: string, key: 'clientId' | 'callbackUrl') => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1000);
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
              {isEdit ? 'Edit SAML Provider' : 'Add SAML Provider'}
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
              ? 'Update the SAML provider settings.'
              : 'Configure a SAML provider. Set Hostname above to see the correct callback URL.'}
          </Dialog.Description>

          <div className={sharedStyles.dialogBodyScroll}>
            <form
              id="saml-provider-form"
              onSubmit={handleSubmit}
              className={sharedStyles.form}
            >
            <label className={styles.label}>
              Provider ID
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. okta"
                value={form.id ?? ''}
                onChange={(e) => update({ id: e.target.value.trim() })}
              />
            </label>
            <div className={styles.callbackUrlCard}>
              <p className={styles.callbackUrlLabel}>Client ID</p>
              <div className={styles.callbackUrlRow}>
                <p className={styles.callbackUrlValue}>{clientId}</p>
                <button
                  type="button"
                  className={styles.callbackUrlCopyBtn}
                  onClick={() => copyToClipboard(clientId, 'clientId')}
                  title="Copy to clipboard"
                  aria-label="Copy to clipboard"
                >
                  {copiedKey === 'clientId' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <label className={styles.label}>
              Display Name
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. Okta"
                value={String(form.name ?? '')}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              IdP Entry Point URL
              <input
                type="url"
                className={styles.input}
                placeholder="https://idp.example.com/app/abc/sso/saml"
                value={form.entryPoint ?? ''}
                onChange={(e) =>
                  update({ entryPoint: e.target.value.trim() })
                }
              />
            </label>
            <div className={styles.callbackUrlCard}>
              <p className={styles.callbackUrlLabel}>Callback URL</p>
              <div className={styles.callbackUrlRow}>
                <p className={styles.callbackUrlValue}>{callbackUrl}</p>
                <button
                  type="button"
                  className={styles.callbackUrlCopyBtn}
                  onClick={() => copyToClipboard(callbackUrl, 'callbackUrl')}
                  title="Copy to clipboard"
                  aria-label="Copy to clipboard"
                >
                  {copiedKey === 'callbackUrl' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <label className={styles.label}>
              IdP Certificate (PEM)
              <span className={styles.inputHelp}>
                You can paste multiple certificates one after another (e.g. signing + encryption, or key rotation).
              </span>
              <textarea
                className={styles.input}
                rows={4}
                placeholder={
                  form.idpCert === '(set)'
                    ? '(saved)'
                    : '-----BEGIN CERTIFICATE-----\n...'
                }
                value={form.idpCert === '(set)' ? '' : (form.idpCert ?? '')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' && form.idpCert === '(set)') return;
                  update({ idpCert: v || undefined });
                }}
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.8125rem',
                }}
              />
            </label>
            <label className={styles.label}>
              SP Private Key (PEM) (Optional)
              <span className={styles.inputHelp}>
                Required when the IdP has &quot;Want AuthnRequests signed&quot; enabled. Use an <strong>unencrypted</strong> PEM key (no passphrase). Paste it here and add the matching public certificate to the IdP client (e.g. Keycloak Keys).
              </span>
              <textarea
                className={styles.input}
                rows={4}
                placeholder={
                  form.cert === '(set)' ? '(saved)' : '-----BEGIN PRIVATE KEY-----\n...'
                }
                value={form.cert === '(set)' ? '' : (form.cert ?? '')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' && form.cert === '(set)') return;
                  update({ cert: v || undefined });
                }}
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.8125rem',
                }}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={false}
                disabled
                readOnly
              />
              <span className="toggle__track" aria-hidden="true" />
              <span>Require Signed Assertion</span>
            </label>
            <span className={styles.inputHelp}>
              Signed Assertion is not implemented yet. If you need this feature, please add it and create a pull request.
            </span>
            <label className={styles.label}>
              Subject Attribute (Optional)
              <input
                type="text"
                className={styles.input}
                placeholder="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
                value={form.subjectAttribute ?? ''}
                onChange={(e) =>
                  update({ subjectAttribute: e.target.value.trim() })
                }
              />
            </label>
            <label className={styles.label}>
              Email Attribute (Optional)
              <input
                type="text"
                className={styles.input}
                placeholder="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
                value={form.emailAttribute ?? ''}
                onChange={(e) =>
                  update({ emailAttribute: e.target.value.trim() })
                }
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.trustEmail ?? true}
                onChange={(e) => update({ trustEmail: e.target.checked })}
              />
              <span className="toggle__track" aria-hidden="true" />
              <span>Trust email from provider</span>
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
              onClick={() => {
                onSubmit(form);
                onClose();
              }}
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
