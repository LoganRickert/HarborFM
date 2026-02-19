/**
 * E2E: DNS domain-type switching and validation edge cases.
 *
 * - Setting managedSubDomain without default_domain in settings returns 400.
 * - Switching from managedDomain to managedSubDomain (or vice versa) is accepted; server runs DNS task (cleanup + ensure one CNAME).
 * - Switching from linkDomain to managedDomain is accepted.
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
    await runOne('PATCH managedSubDomain without default_domain is accepted and server clears value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultDomain: '' }),
      }, jar);

      const slug = `e2e-dns-switch-${ts}`;
      const created = await createShow(jar, { title: 'E2E DNS Switch', slug });

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedSubDomain: 'mysub' }),
      }, jar);

      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when managedSubDomain sent without default_domain (server clears it), got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managedSubDomain || '').trim() !== '') {
        throw new Error(`Expected server to clear managedSubDomain when default_domain not set, got ${data.managedSubDomain}`);
      }
    })
  );

  results.push(
    await runOne('Switch from managedDomain to managedSubDomain accepted', async () => {
      const baseDomain = `e2e-switch-${ts}.test`;
      const subPart = 'show';
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultDomain: baseDomain,
          dnsDefaultAllowDomain: true,
          dnsDefaultAllowSubDomain: true,
        }),
      }, jar);

      const slug = `e2e-switch-sub-${ts}`;
      const created = await createShow(jar, { title: 'E2E Switch Sub', slug });
      const managedHost = `e2e-managed-only-${ts}.test`;

      const res1 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: managedHost }),
      }, jar);
      if (res1.status !== 200) throw new Error(`PATCH managedDomain failed: ${res1.status}`);

      const res2 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: null, managedSubDomain: subPart }),
      }, jar);
      if (res2.status !== 200) {
        const t = await res2.text();
        throw new Error(`PATCH switch to managedSubDomain failed: ${res2.status} ${t}`);
      }
      const data = await res2.json();
      if ((data.managedSubDomain || '').trim().toLowerCase() !== subPart) {
        throw new Error(`Expected managedSubDomain "${subPart}", got ${data.managedSubDomain}`);
      }
      if ((data.managedDomain || '').trim() !== '') {
        throw new Error(`Expected managedDomain cleared, got ${data.managedDomain}`);
      }
    })
  );

  results.push(
    await runOne('Switch from managedSubDomain to managedDomain accepted', async () => {
      const baseDomain = `e2e-switch2-${ts}.test`;
      const subPart = 'feed';
      const slug = `e2e-switch-managed-${ts}`;
      const created = await createShow(jar, { title: 'E2E Switch Managed', slug });

      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managedDomain: null,
          managedSubDomain: subPart,
        }),
      }, jar);

      const managedHost = `e2e-full-domain-${ts}.test`;
      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managedDomain: managedHost,
          managedSubDomain: null,
        }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`PATCH switch to managedDomain failed: ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managedDomain || '').trim().toLowerCase() !== managedHost.toLowerCase()) {
        throw new Error(`Expected managedDomain "${managedHost}", got ${data.managedDomain}`);
      }
      if ((data.managedSubDomain || '').trim() !== '') {
        throw new Error(`Expected managedSubDomain cleared, got ${data.managedSubDomain}`);
      }
    })
  );

  results.push(
    await runOne('Switch from linkDomain to managedDomain accepted', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsAllowLinkingDomain: true }),
      }, jar);

      const slug = `e2e-switch-link-${ts}`;
      const created = await createShow(jar, { title: 'E2E Switch Link', slug });
      const linkHost = `e2e-link-then-managed-${ts}.test`;
      const managedHost = `e2e-managed-then-${ts}.test`;

      const res1 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkDomain: linkHost }),
      }, jar);
      if (res1.status !== 200) throw new Error(`PATCH linkDomain failed: ${res1.status}`);

      const res2 = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkDomain: null, managedDomain: managedHost }),
      }, jar);
      if (res2.status !== 200) {
        const t = await res2.text();
        throw new Error(`PATCH switch to managedDomain failed: ${res2.status} ${t}`);
      }
      const data = await res2.json();
      if ((data.managedDomain || '').trim().toLowerCase() !== managedHost.toLowerCase()) {
        throw new Error(`Expected managedDomain "${managedHost}", got ${data.managedDomain}`);
      }
      if ((data.linkDomain || '').trim() !== '') {
        throw new Error(`Expected linkDomain cleared, got ${data.linkDomain}`);
      }
    })
  );

  results.push(
    await runOne('Clear all DNS then set only managedSubDomain (with default_domain) accepted', async () => {
      const baseDomain = `e2e-clear-${ts}.test`;
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultDomain: baseDomain }),
      }, jar);

      const slug = `e2e-clear-dns-${ts}`;
      const created = await createShow(jar, { title: 'E2E Clear DNS', slug });

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkDomain: null,
          managedDomain: null,
          managedSubDomain: 'onlysub',
        }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`PATCH only managedSubDomain failed: ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managedSubDomain || '').trim().toLowerCase() !== 'onlysub') {
        throw new Error(`Expected managedSubDomain "onlysub", got ${data.managedSubDomain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_sub_domain disabled and podcast has managedSubDomain, PATCH managedDomain with managedSubDomain null succeeds', async () => {
      const baseDomain = `e2e-sub-then-off-${ts}.test`;
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultDomain: baseDomain,
          dnsDefaultAllowDomain: true,
          dnsDefaultAllowSubDomain: true,
        }),
      }, jar);

      const slug = `e2e-sub-disabled-${ts}`;
      const created = await createShow(jar, { title: 'E2E Sub Then Disabled', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedSubDomain: 'oldsub' }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowSubDomain: false }),
      }, jar);

      const managedHost = `e2e-managed-after-sub-${ts}.test`;
      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: managedHost, managedSubDomain: null }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when setting managedDomain and clearing managedSubDomain, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managedDomain || '').trim().toLowerCase() !== managedHost.toLowerCase()) {
        throw new Error(`Expected managedDomain "${managedHost}", got ${data.managedDomain}`);
      }
      if ((data.managedSubDomain || '').trim() !== '') {
        throw new Error(`Expected managedSubDomain cleared, got ${data.managedSubDomain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_domain disabled, PATCH managedDomain null clears stored value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultAllowDomain: true,
        }),
      }, jar);

      const slug = `e2e-allow-domain-off-${ts}`;
      const created = await createShow(jar, { title: 'E2E Allow Domain Off', slug });
      const managedHost = `e2e-had-managed-${ts}.test`;
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: managedHost }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowDomain: false }),
      }, jar);

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: null }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when clearing managedDomain, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managedDomain || '').trim() !== '') {
        throw new Error(`Expected managedDomain cleared, got ${data.managedDomain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_domain disabled, server clears managedDomain even if client sends non-empty value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowDomain: true }),
      }, jar);

      const slug = `e2e-server-clears-managed-${ts}`;
      const created = await createShow(jar, { title: 'E2E Server Clears Managed', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: `e2e-before-off-${ts}.test` }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowDomain: false }),
      }, jar);

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: 'stale-when-disabled.test' }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managedDomain || '').trim() !== '') {
        throw new Error(`Expected server to clear managedDomain when allow_domain disabled, got ${data.managedDomain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_sub_domain disabled, server clears managedSubDomain even if client sends non-empty value', async () => {
      const baseDomain = `e2e-sub-cleared-${ts}.test`;
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultDomain: baseDomain,
          dnsDefaultAllowSubDomain: true,
        }),
      }, jar);

      const slug = `e2e-sub-server-clears-${ts}`;
      const created = await createShow(jar, { title: 'E2E Sub Server Clears', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedSubDomain: 'hadsub' }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowSubDomain: false }),
      }, jar);

      const res = await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedSubDomain: 'stale-sub' }),
      }, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.managedSubDomain || '').trim() !== '') {
        throw new Error(`Expected server to clear managedSubDomain when allow_sub_domain disabled, got ${data.managedSubDomain}`);
      }
    })
  );

  results.push(
    await runOne('When allow_custom_key disabled, PATCH cloudflare_api_key null clears stored key', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowCustomKey: true }),
      }, jar);

      const slug = `e2e-custom-key-off-${ts}`;
      const created = await createShow(jar, { title: 'E2E Custom Key Off', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflareApiKey: 'e2e-dummy-token-for-test' }),
      }, jar);

      const getAfterSet = await apiFetch(`/podcasts/${created.id}`, { method: 'GET' }, jar);
      const setData = await getAfterSet.json();
      if (!setData.cloudflareApiKeySet) {
        throw new Error('Expected cloudflareApiKeySet true after setting key');
      }

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowCustomKey: false }),
      }, jar);

      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflareApiKey: null }),
      }, jar);

      const getAfterClear = await apiFetch(`/podcasts/${created.id}`, { method: 'GET' }, jar);
      const clearData = await getAfterClear.json();
      if (clearData.cloudflareApiKeySet) {
        throw new Error('Expected cloudflareApiKeySet false after clearing key with allow_custom_key disabled');
      }
    })
  );

  results.push(
    await runOne('When allow_custom_key disabled, server clears key even if client sends non-empty value', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowCustomKey: true }),
      }, jar);

      const slug = `e2e-custom-key-server-clears-${ts}`;
      const created = await createShow(jar, { title: 'E2E Custom Key Server Clears', slug });
      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflareApiKey: 'e2e-another-dummy' }),
      }, jar);

      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowCustomKey: false }),
      }, jar);

      await apiFetch(`/podcasts/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudflareApiKey: 'stale-token-ignored' }),
      }, jar);

      const getAfter = await apiFetch(`/podcasts/${created.id}`, { method: 'GET' }, jar);
      const data = await getAfter.json();
      if (data.cloudflareApiKeySet) {
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
          dnsDefaultDomain: '',
          dnsDefaultAllowDomain: false,
          dnsDefaultAllowSubDomain: false,
          dnsDefaultAllowCustomKey: false,
        }),
      }, jar);
    })
  );

  return results;
}
