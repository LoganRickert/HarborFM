import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

type OidcProvider = {
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
};
type SamlProvider = {
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
};

const emptyOidcProvider = (): OidcProvider => ({
  id: '',
  name: '',
  discoveryUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  trustEmail: true,
});

const emptySamlProvider = (baseUrl: string): SamlProvider => ({
  id: '',
  name: '',
  entryPoint: '',
  issuer: baseUrl ? `${baseUrl}/api/auth/sso/saml` : '',
  callbackUrl: baseUrl ? `${baseUrl}/api/auth/sso/saml/callback` : '',
  cert: '',
  idpCert: '',
  trustEmail: true,
});

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

  const addOidc = () => {
    onFormChange({ ssoOidcProviders: [...oidcProviders, emptyOidcProvider()] });
  };

  const updateOidc = (index: number, updates: Partial<OidcProvider>) => {
    onFormChange({
      ssoOidcProviders: updateOidcProvider(oidcProviders, index, updates),
    });
  };

  const removeOidc = (index: number) => {
    onFormChange({
      ssoOidcProviders: oidcProviders.filter((_, i) => i !== index),
    });
  };

  const addSaml = () => {
    onFormChange({
      ssoSamlProviders: [...samlProviders, emptySamlProvider(baseUrl)],
    });
  };

  const updateSaml = (index: number, updates: Partial<SamlProvider>) => {
    onFormChange({
      ssoSamlProviders: updateSamlProvider(samlProviders, index, updates),
    });
  };

  const removeSaml = (index: number) => {
    onFormChange({
      ssoSamlProviders: samlProviders.filter((_, i) => i !== index),
    });
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
            Add provider
          </button>
        </div>
        <p className={styles.inputHelp}>
          Use a discovery URL (e.g. https://accounts.google.com) or enter authorization and token endpoints manually.
        </p>
        {oidcProviders.length === 0 ? (
          <p className={styles.ssoEmpty}>No OIDC providers. Click Add provider to add one.</p>
        ) : (
          oidcProviders.map((p, i) => (
            <div key={i} className={styles.providerCard}>
              <div className={styles.providerCardHeader}>
                <span className={styles.providerCardLabel}>{p.name || `Provider ${i + 1}`}</span>
                <button
                  type="button"
                  className={styles.deleteProviderBtn}
                  onClick={() => removeOidc(i)}
                  aria-label="Remove provider"
                >
                  Remove
                </button>
              </div>
              <div className={styles.providerCardBody}>
                <label className={styles.label}>
                  Provider ID
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. google"
                    value={String(p.id ?? '')}
                    onChange={(e) => updateOidc(i, { id: e.target.value.trim() })}
                  />
                  <p className={styles.inputHelp}>Unique identifier used in URLs. Letters, numbers, hyphens only.</p>
                </label>
                <label className={styles.label}>
                  Display name
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Google"
                    value={String(p.name ?? '')}
                    onChange={(e) => updateOidc(i, { name: e.target.value })}
                  />
                </label>
                <label className={styles.label}>
                  Discovery URL
                  <input
                    type="url"
                    className={styles.input}
                    placeholder="https://accounts.google.com"
                    value={p.discoveryUrl ?? ''}
                    onChange={(e) =>
                      updateOidc(i, {
                        discoveryUrl: e.target.value.trim(),
                        authorizationEndpoint: e.target.value.trim() ? undefined : p.authorizationEndpoint,
                        tokenEndpoint: e.target.value.trim() ? undefined : p.tokenEndpoint,
                      })
                    }
                  />
                  <p className={styles.inputHelp}>Leave blank to use manual endpoints below.</p>
                </label>
                {p.discoveryUrl && (
                  <label className={styles.label}>
                    Issuer override (optional)
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="e.g. https://keycloak.local/realms/myrealm"
                      value={String(p.issuer ?? '')}
                      onChange={(e) => updateOidc(i, { issuer: e.target.value.trim() })}
                    />
                    <p className={styles.inputHelp}>
                      If you get &quot;issuer does not match&quot;, set this to the exact issuer from your IdP&apos;s .well-known/openid-configuration.
                    </p>
                  </label>
                )}
                {!p.discoveryUrl && (
                  <>
                    <label className={styles.label}>
                      Authorization endpoint
                      <input
                        type="url"
                        className={styles.input}
                        placeholder="https://idp.example.com/oauth/authorize"
                        value={p.authorizationEndpoint ?? ''}
                        onChange={(e) => updateOidc(i, { authorizationEndpoint: e.target.value.trim() })}
                      />
                    </label>
                    <label className={styles.label}>
                      Token endpoint
                      <input
                        type="url"
                        className={styles.input}
                        placeholder="https://idp.example.com/oauth/token"
                        value={p.tokenEndpoint ?? ''}
                        onChange={(e) => updateOidc(i, { tokenEndpoint: e.target.value.trim() })}
                      />
                    </label>
                    <label className={styles.label}>
                      UserInfo endpoint (optional)
                      <input
                        type="url"
                        className={styles.input}
                        placeholder="https://idp.example.com/oauth/userinfo"
                        value={p.userinfoEndpoint ?? ''}
                        onChange={(e) => updateOidc(i, { userinfoEndpoint: e.target.value.trim() })}
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
                    value={p.clientId ?? ''}
                    onChange={(e) => updateOidc(i, { clientId: e.target.value })}
                  />
                </label>
                <label className={styles.label}>
                  Client secret
                  <input
                    type="password"
                    className={styles.input}
                    placeholder={p.clientSecret === '(set)' ? '(saved)' : 'Enter client secret'}
                    value={p.clientSecret === '(set)' ? '' : (p.clientSecret ?? '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' && p.clientSecret === '(set)') return;
                      updateOidc(i, { clientSecret: v || undefined });
                    }}
                    autoComplete="off"
                  />
                  <p className={styles.inputHelp}>Enter new value to change; leave blank and save to keep existing. Use "(set)" when editing to preserve.</p>
                </label>
                <label className={styles.label}>
                  Scopes
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="openid profile email"
                    value={p.scopes ?? 'openid profile email'}
                    onChange={(e) => updateOidc(i, { scopes: e.target.value })}
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={p.trustEmail ?? true}
                    onChange={(e) => updateOidc(i, { trustEmail: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Trust email from provider (use for account linking)</span>
                </label>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.ssoBlock}>
        <div className={styles.ssoBlockHeader}>
          <h3 className={styles.ssoBlockTitle}>SAML providers</h3>
          <button type="button" className={styles.addProviderBtn} onClick={addSaml}>
            Add provider
          </button>
        </div>
        <p className={styles.inputHelp}>
          Each provider needs an entry point URL from the IdP, issuer, and callback URL. Set Hostname above to see the correct callback URL.
        </p>
        {samlProviders.length === 0 ? (
          <p className={styles.ssoEmpty}>No SAML providers. Click Add provider to add one.</p>
        ) : (
          samlProviders.map((p, i) => (
            <div key={i} className={styles.providerCard}>
              <div className={styles.providerCardHeader}>
                <span className={styles.providerCardLabel}>{p.name || `Provider ${i + 1}`}</span>
                <button
                  type="button"
                  className={styles.deleteProviderBtn}
                  onClick={() => removeSaml(i)}
                  aria-label="Remove provider"
                >
                  Remove
                </button>
              </div>
              <div className={styles.providerCardBody}>
                <label className={styles.label}>
                  Provider ID
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. okta"
                    value={p.id ?? ''}
                    onChange={(e) => updateSaml(i, { id: e.target.value.trim() })}
                  />
                </label>
                <label className={styles.label}>
                  Display name
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Okta"
                    value={String(p.name ?? '')}
                    onChange={(e) => updateSaml(i, { name: e.target.value })}
                  />
                </label>
                <label className={styles.label}>
                  IdP entry point URL
                  <input
                    type="url"
                    className={styles.input}
                    placeholder="https://idp.example.com/app/abc/sso/saml"
                    value={p.entryPoint ?? ''}
                    onChange={(e) => updateSaml(i, { entryPoint: e.target.value.trim() })}
                  />
                </label>
                <label className={styles.label}>
                  Issuer (Entity ID)
                  <input
                    type="text"
                    className={styles.input}
                    placeholder={baseUrl ? `${baseUrl}/api/auth/sso/saml` : 'https://yoursite.com/api/auth/sso/saml'}
                    value={p.issuer ?? ''}
                    onChange={(e) => updateSaml(i, { issuer: e.target.value.trim() })}
                  />
                </label>
                <label className={styles.label}>
                  Callback URL (ACS URL)
                  <input
                    type="url"
                    className={styles.input}
                    placeholder={
                      baseUrl && p.id
                        ? `${baseUrl}/api/auth/sso/saml/callback/${p.id}`
                        : 'https://yoursite.com/api/auth/sso/saml/callback/provider-id'
                    }
                    value={p.callbackUrl ?? ''}
                    onChange={(e) => updateSaml(i, { callbackUrl: e.target.value.trim() })}
                  />
                  <p className={styles.inputHelp}>
                    Must match your server. Format: <code>{baseUrl || 'https://yoursite.com'}/api/auth/sso/saml/callback/provider-id</code>
                  </p>
                </label>
                <label className={styles.label}>
                  SP certificate (PEM)
                  <textarea
                    className={styles.input}
                    rows={4}
                    placeholder={p.cert === '(set)' ? '(saved)' : '-----BEGIN CERTIFICATE-----\n...'}
                    value={p.cert === '(set)' ? '' : (p.cert ?? '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' && p.cert === '(set)') return;
                      updateSaml(i, { cert: v || undefined });
                    }}
                    style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}
                  />
                </label>
                <label className={styles.label}>
                  IdP certificate (PEM)
                  <textarea
                    className={styles.input}
                    rows={4}
                    placeholder={p.idpCert === '(set)' ? '(saved)' : '-----BEGIN CERTIFICATE-----\n...'}
                    value={p.idpCert === '(set)' ? '' : (p.idpCert ?? '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' && p.idpCert === '(set)') return;
                      updateSaml(i, { idpCert: v || undefined });
                    }}
                    style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}
                  />
                </label>
                <label className={styles.label}>
                  Subject attribute (optional)
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
                    value={p.subjectAttribute ?? ''}
                    onChange={(e) => updateSaml(i, { subjectAttribute: e.target.value.trim() })}
                  />
                </label>
                <label className={styles.label}>
                  Email attribute (optional)
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
                    value={p.emailAttribute ?? ''}
                    onChange={(e) => updateSaml(i, { emailAttribute: e.target.value.trim() })}
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={p.trustEmail ?? true}
                    onChange={(e) => updateSaml(i, { trustEmail: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Trust email from provider</span>
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}
