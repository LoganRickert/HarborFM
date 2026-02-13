import { SettingsFormProps, ProviderOption } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { ProviderToggle } from './ProviderToggle';
import { AppSettings } from '../../api/settings';
import styles from '../../pages/Settings.module.css';

const CLOUDFLARE_API_TOKENS_URL = 'https://dash.cloudflare.com/profile/api-tokens';

const DNS_PROVIDER_OPTIONS: ProviderOption<AppSettings['dns_provider']>[] = [
  { value: 'none', label: 'None' },
  { value: 'cloudflare', label: 'CloudFlare' },
];

function parseDomainsList(value: string): string[] {
  const raw = (value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function formatDomainsList(arr: string[]): string {
  return arr.length === 0 ? '' : arr.join(', ');
}

export function DnsConfigurationSection({ form, onFormChange }: SettingsFormProps) {
  const domainsList = parseDomainsList(
    typeof form.dns_default_allow_domains === 'string'
      ? form.dns_default_allow_domains
      : '[]',
  );

  return (
    <SectionCard
      title="DNS Configuration"
      subtitle="Optional. Configure custom domains for podcast feeds (e.g. Link Domain, Managed Domain). Use None to disable; CloudFlare to manage CNAME records."
    >
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.dns_allow_linking_domain}
          onChange={(e) => onFormChange({ dns_allow_linking_domain: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Allow Linking Domain</span>
      </label>
      <p className={styles.inputHelp}>
        When on, podcast owners can set a &quot;link domain&quot; so their feed is reachable at their own domain (e.g. podcast.example.com) instead of only the main HarborFM URL.
      </p>

      <div className={styles.label}>
        Provider
        <ProviderToggle
          value={form.dns_provider}
          options={DNS_PROVIDER_OPTIONS}
          onChange={(value) => onFormChange({ dns_provider: value })}
          ariaLabel="DNS provider"
        />
      </div>
      <p className={styles.inputHelp}>
        Choose how custom domains are set up. &quot;None&quot; turns off automatic DNS. &quot;CloudFlare&quot; lets HarborFM create or update DNS records in your CloudFlare account so custom domains work.
      </p>

      {form.dns_provider === 'cloudflare' && (
        <>
          <label className={styles.label}>
            Provider API Token
            <input
              type="password"
              className={styles.input}
              placeholder={form.dns_provider_api_token_set ? '(saved)' : 'Enter API token'}
              value={form.dns_provider_api_token ?? ''}
              onChange={(e) => onFormChange({ dns_provider_api_token: e.target.value })}
              autoComplete="off"
            />
            <p className={styles.inputHelp}>
              Your CloudFlare API token is used to create or update DNS records. Create one with &quot;Zone:DNS:Edit&quot; permission.{' '}
              <a href={CLOUDFLARE_API_TOKENS_URL} target="_blank" rel="noopener noreferrer">Create a token at CloudFlare</a>.
            </p>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.dns_use_cname}
              onChange={(e) => onFormChange({ dns_use_cname: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Use CNAME</span>
          </label>
          <p className={styles.inputHelp}>
            When on, HarborFM creates a CNAME record pointing your custom domain to this server. Turn off if your host or network requires an A record (a numeric IP) instead.
          </p>
          {!form.dns_use_cname && (
            <label className={styles.label}>
              Server IP for A Record
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. 192.0.2.1"
                value={form.dns_a_record_ip ?? ''}
                onChange={(e) => onFormChange({ dns_a_record_ip: e.target.value })}
                autoComplete="off"
              />
              <p className={styles.inputHelp}>
                The public IPv4 address of this server. Used when creating an A record so the custom domain points to this machine. Ask your host or network admin if you don’t know it.
              </p>
            </label>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.dns_default_allow_domain}
              onChange={(e) => onFormChange({ dns_default_allow_domain: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Allow Domain</span>
          </label>
          <p className={styles.inputHelp}>
            When on, podcast owners can set a &quot;managed domain&quot; (a full domain you allow). You can restrict which domains they can pick using the list below.
          </p>
          {form.dns_default_allow_domain && (
            <label className={styles.label}>
              Allow Domains
              <input
                type="text"
                className={styles.input}
                placeholder="example.com, show.example.com"
                value={formatDomainsList(domainsList)}
                onChange={(e) =>
                  onFormChange({
                    dns_default_allow_domains: JSON.stringify(
                      e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    ),
                  })
                }
              />
              <p className={styles.inputHelp}>
                Comma-separated list of domains you allow. When non-empty, the managed-domain dropdown in each podcast will only offer these. Leave empty to allow any domain (if &quot;Allow Domain&quot; is on).
              </p>
            </label>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.dns_default_allow_custom_key}
              onChange={(e) => onFormChange({ dns_default_allow_custom_key: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Allow Custom Key</span>
          </label>
          <p className={styles.inputHelp}>
            When on, each podcast can use its own CloudFlare API token instead of the global one above. Useful if different shows are in different CloudFlare accounts.
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.dns_default_allow_sub_domain}
              onChange={(e) => onFormChange({ dns_default_allow_sub_domain: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Allow Sub-Domain</span>
          </label>
          <p className={styles.inputHelp}>
            When on, podcast owners can use a sub-domain of a shared base domain (e.g. &quot;myshow&quot; under example.com → myshow.example.com). You must set the base domain below.
          </p>
          {form.dns_default_allow_sub_domain && (
            <label className={styles.label}>
              Domain (Required)
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. example.com"
                value={form.dns_default_domain}
                onChange={(e) => onFormChange({ dns_default_domain: e.target.value })}
                autoComplete="off"
              />
              <p className={styles.inputHelp}>
                The base domain used for sub-domains (e.g. example.com). Podcasts can then choose a sub-name like &quot;myshow&quot; to get myshow.example.com. Required when &quot;Allow Sub-Domain&quot; is on.
              </p>
            </label>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.dns_default_enable_cloudflare_proxy}
              onChange={(e) => onFormChange({ dns_default_enable_cloudflare_proxy: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Enable CloudFlare Proxy</span>
          </label>
          <p className={styles.inputHelp}>
            When on, new DNS records are created with CloudFlare’s proxy (orange cloud) so traffic goes through CloudFlare. This can improve performance and add DDoS protection; turn off if you need traffic to hit your server IP directly.
          </p>
        </>
      )}
    </SectionCard>
  );
}
