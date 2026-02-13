/**
 * E2E: DNS domain-type switching and validation edge cases.
 *
 * - Setting managed_sub_domain without default_domain in settings returns 400.
 * - Switching from managed_domain to managed_sub_domain (or vice versa) is accepted; server runs DNS task (cleanup + ensure one CNAME).
 * - Switching from link_domain to managed_domain is accepted.
 *
 * DNS provider is "none" so Cloudflare is not called; we only assert API behavior and stored values.
 */
import {
  apiFetch,
  loginAsAdmin,
  createShow,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const ts = Date.now();

  results.push(
    await runOne('PATCH managed_sub_domain without default_domain is accepted and server clears value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_domain: '' }),
      }, jar);

      const slug = `e2e-dns-switch-${ts}`;
      const created = await createShow(jar, { title: 'E2E DNS Switch', slug });

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_sub_domain: 'mysub' }),
      }, jar);

      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when managed_sub_domain sent without default_domain (server clears it), got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managed_sub_domain || '').trim() !== '') {
        throw new Error(`Expected server to clear managed_sub_domain when default_domain not set, got ${data.managed_sub_domain}`);
      }
    })
  );

  results.push(
    await runOne('Switch from managed_domain to managed_sub_domain accepted', async () => {
      const baseDomain = `e2e-switch-${ts}.test`;
      const subPart = 'show';
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_domain: baseDomain,
          dns_default_allow_domain: true,
          dns_default_allow_sub_domain: true,
        }),
      }, jar);

      const slug = `e2e-switch-sub-${ts}`;
      const created = await createShow(jar, { title: 'E2E Switch Sub', slug });
      const managedHost = `e2e-managed-only-${ts}.test`;

      const res1 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: managedHost }),
      }, jar);
      if (res1.status !== 200) throw new Error(`PATCH managed_domain failed: ${res1.status}`);

      const res2 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: null, managed_sub_domain: subPart }),
      }, jar);
      if (res2.status !== 200) {
        const t = await res2.text();
        throw new Error(`PATCH switch to managed_sub_domain failed: ${res2.status} ${t}`);
      }
      const data = await res2.json();
      if ((data.managed_sub_domain || '').trim().toLowerCase() !== subPart) {
        throw new Error(`Expected managed_sub_domain "${subPart}", got ${data.managed_sub_domain}`);
      }
      if ((data.managed_domain || '').trim() !== '') {
        throw new Error(`Expected managed_domain cleared, got ${data.managed_domain}`);
      }
    })
  );

  results.push(
    await runOne('Switch from managed_sub_domain to managed_domain accepted', async () => {
      const baseDomain = `e2e-switch2-${ts}.test`;
      const subPart = 'feed';
      const slug = `e2e-switch-managed-${ts}`;
      const created = await createShow(jar, { title: 'E2E Switch Managed', slug });

      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managed_domain: null,
          managed_sub_domain: subPart,
        }),
      }, jar);

      const managedHost = `e2e-full-domain-${ts}.test`;
      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managed_domain: managedHost,
          managed_sub_domain: null,
        }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`PATCH switch to managed_domain failed: ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managed_domain || '').trim().toLowerCase() !== managedHost.toLowerCase()) {
        throw new Error(`Expected managed_domain "${managedHost}", got ${data.managed_domain}`);
      }
      if ((data.managed_sub_domain || '').trim() !== '') {
        throw new Error(`Expected managed_sub_domain cleared, got ${data.managed_sub_domain}`);
      }
    })
  );

  results.push(
    await runOne('Switch from link_domain to managed_domain accepted', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_allow_linking_domain: true }),
      }, jar);

      const slug = `e2e-switch-link-${ts}`;
      const created = await createShow(jar, { title: 'E2E Switch Link', slug });
      const linkHost = `e2e-link-then-managed-${ts}.test`;
      const managedHost = `e2e-managed-then-${ts}.test`;

      const res1 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_domain: linkHost }),
      }, jar);
      if (res1.status !== 200) throw new Error(`PATCH link_domain failed: ${res1.status}`);

      const res2 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_domain: null, managed_domain: managedHost }),
      }, jar);
      if (res2.status !== 200) {
        const t = await res2.text();
        throw new Error(`PATCH switch to managed_domain failed: ${res2.status} ${t}`);
      }
      const data = await res2.json();
      if ((data.managed_domain || '').trim().toLowerCase() !== managedHost.toLowerCase()) {
        throw new Error(`Expected managed_domain "${managedHost}", got ${data.managed_domain}`);
      }
      if ((data.link_domain || '').trim() !== '') {
        throw new Error(`Expected link_domain cleared, got ${data.link_domain}`);
      }
    })
  );

  results.push(
    await runOne('Clear all DNS then set only managed_sub_domain (with default_domain) accepted', async () => {
      const baseDomain = `e2e-clear-${ts}.test`;
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_domain: baseDomain }),
      }, jar);

      const slug = `e2e-clear-dns-${ts}`;
      const created = await createShow(jar, { title: 'E2E Clear DNS', slug });

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link_domain: null,
          managed_domain: null,
          managed_sub_domain: 'onlysub',
        }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`PATCH only managed_sub_domain failed: ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managed_sub_domain || '').trim().toLowerCase() !== 'onlysub') {
        throw new Error(`Expected managed_sub_domain "onlysub", got ${data.managed_sub_domain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_sub_domain disabled and podcast has managed_sub_domain, PATCH managed_domain with managed_sub_domain null succeeds', async () => {
      const baseDomain = `e2e-sub-then-off-${ts}.test`;
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_domain: baseDomain,
          dns_default_allow_domain: true,
          dns_default_allow_sub_domain: true,
        }),
      }, jar);

      const slug = `e2e-sub-disabled-${ts}`;
      const created = await createShow(jar, { title: 'E2E Sub Then Disabled', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_sub_domain: 'oldsub' }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_sub_domain: false }),
      }, jar);

      const managedHost = `e2e-managed-after-sub-${ts}.test`;
      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: managedHost, managed_sub_domain: null }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when setting managed_domain and clearing managed_sub_domain, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managed_domain || '').trim().toLowerCase() !== managedHost.toLowerCase()) {
        throw new Error(`Expected managed_domain "${managedHost}", got ${data.managed_domain}`);
      }
      if ((data.managed_sub_domain || '').trim() !== '') {
        throw new Error(`Expected managed_sub_domain cleared, got ${data.managed_sub_domain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_domain disabled, PATCH managed_domain null clears stored value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_allow_domain: true,
        }),
      }, jar);

      const slug = `e2e-allow-domain-off-${ts}`;
      const created = await createShow(jar, { title: 'E2E Allow Domain Off', slug });
      const managedHost = `e2e-had-managed-${ts}.test`;
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: managedHost }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_domain: false }),
      }, jar);

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: null }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when clearing managed_domain, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managed_domain || '').trim() !== '') {
        throw new Error(`Expected managed_domain cleared, got ${data.managed_domain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_domain disabled, server clears managed_domain even if client sends non-empty value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_domain: true }),
      }, jar);

      const slug = `e2e-server-clears-managed-${ts}`;
      const created = await createShow(jar, { title: 'E2E Server Clears Managed', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: `e2e-before-off-${ts}.test` }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_domain: false }),
      }, jar);

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: 'stale-when-disabled.test' }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managed_domain || '').trim() !== '') {
        throw new Error(`Expected server to clear managed_domain when allow_domain disabled, got ${data.managed_domain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_sub_domain disabled, server clears managed_sub_domain even if client sends non-empty value', async () => {
      const baseDomain = `e2e-sub-cleared-${ts}.test`;
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_domain: baseDomain,
          dns_default_allow_sub_domain: true,
        }),
      }, jar);

      const slug = `e2e-sub-server-clears-${ts}`;
      const created = await createShow(jar, { title: 'E2E Sub Server Clears', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_sub_domain: 'hadsub' }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_sub_domain: false }),
      }, jar);

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_sub_domain: 'stale-sub' }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managed_sub_domain || '').trim() !== '') {
        throw new Error(`Expected server to clear managed_sub_domain when allow_sub_domain disabled, got ${data.managed_sub_domain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_custom_key disabled, PATCH cloudflare_api_key null clears stored key', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_custom_key: true }),
      }, jar);

      const slug = `e2e-custom-key-off-${ts}`;
      const created = await createShow(jar, { title: 'E2E Custom Key Off', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflare_api_key: 'e2e-dummy-token-for-test' }),
      }, jar);

      const getAfterSet = await apiFetch(`/podcasts/${created.id}`, { method: 'GET' }, jar);
      const setData = await getAfterSet.json();
      if (!setData.cloudflare_api_key_set) {
        throw new Error('Expected cloudflare_api_key_set true after setting key');
      }

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_custom_key: false }),
      }, jar);

      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflare_api_key: null }),
      }, jar);

      const getAfterClear = await apiFetch(`/podcasts/${created.id}`, { method: 'GET' }, jar);
      const clearData = await getAfterClear.json();
      if (clearData.cloudflare_api_key_set) {
        throw new Error('Expected cloudflare_api_key_set false after clearing key with allow_custom_key disabled');
      }
    })
  );

  results.push(
    await runOne('When allow_custom_key disabled, server clears key even if client sends non-empty value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_custom_key: true }),
      }, jar);

      const slug = `e2e-custom-key-server-clears-${ts}`;
      const created = await createShow(jar, { title: 'E2E Custom Key Server Clears', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflare_api_key: 'e2e-another-dummy' }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_custom_key: false }),
      }, jar);

      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflare_api_key: 'stale-token-ignored' }),
      }, jar);

      const getAfter = await apiFetch(`/podcasts/${created.id}`, { method: 'GET' }, jar);
      const data = await getAfter.json();
      if (data.cloudflare_api_key_set) {
        throw new Error('Expected server to clear stored key when allow_custom_key disabled even if client sent a value');
      }
    })
  );

  results.push(
    await runOne('Restore DNS settings after dns-domain-switch', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_domain: '',
          dns_default_allow_domain: false,
          dns_default_allow_sub_domain: false,
          dns_default_allow_custom_key: false,
        }),
      }, jar);
    })
  );

  return results;
}
