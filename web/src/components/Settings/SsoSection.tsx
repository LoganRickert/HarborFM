import { useState } from 'react';
import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { OidcProviderDialog, type OidcProvider } from './OidcProviderDialog';
import { SamlProviderDialog, type SamlProvider } from './SamlProviderDialog';
import { DisableEmailSigninConfirmDialog } from './DisableEmailSigninConfirmDialog';
import { SsoButtonIcon } from '../SsoButtonIcon';
import styles from '../../pages/Settings.module.css';
import { Pencil, Trash2 } from 'lucide-react';

function updateOidcProvider(
  providers: OidcProvider[],
  index: number,
  updates: Partial<OidcProvider>
): OidcProvider[] {
  const next = [...providers];
  next[index] = { ...next[index], ...updates };
  return next;
}

function updateSamlProvider(
  providers: SamlProvider[],
  index: number,
  updates: Partial<SamlProvider>
): SamlProvider[] {
  const next = [...providers];
  next[index] = { ...next[index], ...updates };
  return next;
}

export function SsoSection({ form, onFormChange }: SettingsFormProps) {
  const oidcProviders: OidcProvider[] = (form.ssoOidcProviders ?? []) as OidcProvider[];
  const samlProviders: SamlProvider[] = (form.ssoSamlProviders ?? []) as SamlProvider[];
  const hostname = (form.hostname || '').trim();
  const baseUrl = hostname ? (hostname.startsWith('http') ? hostname : `https://${hostname}`) : '';

  const [oidcDialogOpen, setOidcDialogOpen] = useState(false);
  const [editingOidcIndex, setEditingOidcIndex] = useState<number | null>(null);
  const [samlDialogOpen, setSamlDialogOpen] = useState(false);
  const [editingSamlIndex, setEditingSamlIndex] = useState<number | null>(null);
  const [disableEmailSigninConfirmOpen, setDisableEmailSigninConfirmOpen] = useState(false);
  const hasAnyProvider = oidcProviders.length + samlProviders.length > 0;
  const emailSigninDisabled = Boolean(form.emailSigninDisabled);

  const addOidc = () => {
    setEditingOidcIndex(null);
    setOidcDialogOpen(true);
  };

  const updateOidc = (index: number, updates: Partial<OidcProvider>) => {
    onFormChange({
      ssoOidcProviders: updateOidcProvider(oidcProviders, index, updates),
    });
  };

  const removeOidc = (index: number) => {
    const nextOidc = oidcProviders.filter((_, i) => i !== index);
    const totalAfter = nextOidc.length + samlProviders.length;
    onFormChange({
      ssoOidcProviders: nextOidc,
      ...(emailSigninDisabled && totalAfter === 0 ? { emailSigninDisabled: false } : {}),
    });
  };

  const openEditOidc = (index: number) => {
    setEditingOidcIndex(index);
    setOidcDialogOpen(true);
  };

  const handleOidcSubmit = (provider: OidcProvider) => {
    if (editingOidcIndex !== null) {
      updateOidc(editingOidcIndex, provider);
    } else {
      onFormChange({ ssoOidcProviders: [...oidcProviders, provider] });
    }
    setOidcDialogOpen(false);
    setEditingOidcIndex(null);
  };

  const addSaml = () => {
    setEditingSamlIndex(null);
    setSamlDialogOpen(true);
  };

  const updateSaml = (index: number, updates: Partial<SamlProvider>) => {
    onFormChange({
      ssoSamlProviders: updateSamlProvider(samlProviders, index, updates),
    });
  };

  const removeSaml = (index: number) => {
    const nextSaml = samlProviders.filter((_, i) => i !== index);
    const totalAfter = oidcProviders.length + nextSaml.length;
    onFormChange({
      ssoSamlProviders: nextSaml,
      ...(emailSigninDisabled && totalAfter === 0 ? { emailSigninDisabled: false } : {}),
    });
  };

  const openEditSaml = (index: number) => {
    setEditingSamlIndex(index);
    setSamlDialogOpen(true);
  };

  const handleSamlSubmit = (provider: SamlProvider) => {
    if (editingSamlIndex !== null) {
      updateSaml(editingSamlIndex, provider);
    } else {
      onFormChange({ ssoSamlProviders: [...samlProviders, provider] });
    }
    setSamlDialogOpen(false);
    setEditingSamlIndex(null);
  };

  return (
    <SectionCard
      title="SSO (OIDC / SAML)"
      subtitle={'Configure OIDC or SAML providers for single sign-on. Configured providers appear as sign-in options on the login page. Use "(set)" in password/cert fields to keep existing secrets when editing.'}
    >
      <div className={styles.ssoBlock}>
        <div className={styles.ssoBlockHeader}>
          <h3 className={styles.ssoBlockTitle}>OIDC providers</h3>
          <button type="button" className={styles.addProviderBtn} onClick={addOidc}>
            Add Provider
          </button>
        </div>
        <p className={styles.inputHelp}>
          Use a discovery URL (e.g. https://accounts.google.com) or enter authorization and token endpoints manually.
        </p>
        {oidcProviders.length === 0 ? (
          <p className={styles.ssoEmpty}>No OIDC providers. Click Add provider to add one.</p>
        ) : (
          <ul className={styles.ssoProviderList}>
            {oidcProviders.map((p, i) => (
              <li key={i} className={styles.ssoProviderItem}>
                <div className={styles.ssoProviderRow}>
                  <span className={styles.ssoProviderMeta}>
                    {p.iconSlug && (
                      <span
                        className={styles.ssoProviderIcon}
                        style={{
                          backgroundColor: p.buttonBgColor || undefined,
                          color: p.buttonTextColor || undefined,
                        }}
                      >
                        <SsoButtonIcon slug={p.iconSlug} size={18} />
                      </span>
                    )}
                    {p.name || `Provider ${i + 1}`}
                  </span>
                  <div className={styles.ssoProviderActions}>
                    <button
                      type="button"
                      className={styles.ssoProviderEditBtn}
                      onClick={() => openEditOidc(i)}
                      aria-label={`Edit ${p.name || `provider ${i + 1}`}`}
                    >
                      <Pencil size={16} aria-hidden />
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.deleteProviderBtn}
                      onClick={() => removeOidc(i)}
                      aria-label="Remove provider"
                    >
                      <Trash2 size={16} aria-hidden />
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {oidcDialogOpen && (
        <OidcProviderDialog
          open={oidcDialogOpen}
          onClose={() => {
            setOidcDialogOpen(false);
            setEditingOidcIndex(null);
          }}
          provider={editingOidcIndex !== null ? oidcProviders[editingOidcIndex] : undefined}
          baseUrl={baseUrl}
          onSubmit={handleOidcSubmit}
        />
      )}

      <div className={styles.ssoBlock}>
        <div className={styles.ssoBlockHeader}>
          <h3 className={styles.ssoBlockTitle}>SAML providers</h3>
          <button type="button" className={styles.addProviderBtn} onClick={addSaml}>
            Add Provider
          </button>
        </div>
        <p className={styles.inputHelp}>
          Each provider needs an entry point URL from the IdP, issuer, and callback URL. Set Hostname above to see the correct callback URL.
        </p>
        {samlProviders.length === 0 ? (
          <p className={styles.ssoEmpty}>No SAML providers. Click Add provider to add one.</p>
        ) : (
          <ul className={styles.ssoProviderList}>
            {samlProviders.map((p, i) => (
              <li key={i} className={styles.ssoProviderItem}>
                <div className={styles.ssoProviderRow}>
                  <span className={styles.ssoProviderMeta}>
                    {p.iconSlug && (
                      <span
                        className={styles.ssoProviderIcon}
                        style={{
                          backgroundColor: p.buttonBgColor || undefined,
                          color: p.buttonTextColor || undefined,
                        }}
                      >
                        <SsoButtonIcon slug={p.iconSlug} size={18} />
                      </span>
                    )}
                    {p.name || `Provider ${i + 1}`}
                  </span>
                  <div className={styles.ssoProviderActions}>
                    <button
                      type="button"
                      className={styles.ssoProviderEditBtn}
                      onClick={() => openEditSaml(i)}
                      aria-label={`Edit ${p.name || `provider ${i + 1}`}`}
                    >
                      <Pencil size={16} aria-hidden />
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.deleteProviderBtn}
                      onClick={() => removeSaml(i)}
                      aria-label="Remove provider"
                    >
                      <Trash2 size={16} aria-hidden />
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {samlDialogOpen && (
        <SamlProviderDialog
          open={samlDialogOpen}
          onClose={() => {
            setSamlDialogOpen(false);
            setEditingSamlIndex(null);
          }}
          provider={editingSamlIndex !== null ? samlProviders[editingSamlIndex] : undefined}
          baseUrl={baseUrl}
          onSubmit={handleSamlSubmit}
        />
      )}

      <div className={styles.ssoBlock} style={{ marginTop: '1rem' }}>
        <label className="toggle">
          <input
            type="checkbox"
            checked={emailSigninDisabled}
            onChange={(e) => {
              if (e.target.checked) {
                setDisableEmailSigninConfirmOpen(true);
              } else {
                onFormChange({ emailSigninDisabled: false });
              }
            }}
            disabled={!hasAnyProvider}
            aria-describedby={!hasAnyProvider ? 'email-signin-disabled-help' : undefined}
          />
          <span className="toggle__track" aria-hidden="true" />
          <span>Disable email sign-in (SSO only)</span>
        </label>
        {!hasAnyProvider && (
          <p id="email-signin-disabled-help" className={styles.inputHelp}>
            Add at least one SSO provider before enabling this.
          </p>
        )}
      </div>

      <DisableEmailSigninConfirmDialog
        isOpen={disableEmailSigninConfirmOpen}
        onClose={() => setDisableEmailSigninConfirmOpen(false)}
        onConfirm={() => onFormChange({ emailSigninDisabled: true })}
      />
    </SectionCard>
  );
}
