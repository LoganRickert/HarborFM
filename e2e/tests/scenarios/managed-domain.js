/**
 * E2E: Managed domain and managed sub-domain vs customFeedSlug.
 *
 * - managedDomain (exact host, e.g. domain.com): customFeedSlug only when dnsDefaultAllowDomain is true.
 * - managedSubDomain (sub.domain.com): customFeedSlug only when dnsDefaultAllowSubDomain is true and dnsDefaultDomain is set.
 *
 * DNS provider is left as "none" so Cloudflare is never called; values are still saved and resolution is tested via host override.
 */
import {
  apiFetch,
  loginAsAdmin,
  createShow,
  getPublicConfig,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const ts = Date.now();

  // --- Managed domain (exact host: domain.com) ---
  const managedHost = `e2e-managed-${ts}.test`;
  const slugManaged = `e2e-managed-slug-${ts}`;
  let podcastManagedId;

  results.push(
    await runOne('Managed domain: when allow_domain false, customFeedSlug is empty', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultAllowDomain: false,
          dnsDefaultAllowSubDomain: false,
        }),
      }, jar);

      const created = await createShow(jar, { title: 'E2E Managed Domain Show', slug: slugManaged });
      podcastManagedId = created.id;

      await apiFetch(`/podcasts/${podcastManagedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: managedHost }),
      }, jar);

      const data = await getPublicConfig(managedHost);
      if (data.customFeedSlug !== undefined && data.customFeedSlug !== null) {
        throw new Error(`Expected no customFeedSlug when allow_domain false (Host=${managedHost}), got ${data.customFeedSlug}`);
      }
    })
  );

  results.push(
    await runOne('Managed domain: when allow_domain true, customFeedSlug is set', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsDefaultAllowDomain: true }),
      }, jar);

      await apiFetch(`/podcasts/${podcastManagedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedDomain: managedHost }),
      }, jar);

      const data = await getPublicConfig(managedHost);
      if (data.customFeedSlug !== slugManaged) {
        throw new Error(`Expected customFeedSlug "${slugManaged}" when Host=${managedHost}, got ${data.customFeedSlug}`);
      }
    })
  );

  // --- Managed sub-domain (sub.domain.com) ---
  const baseDomain = `e2e-sub-${ts}.test`;
  const subPart = 'myshow';
  const subHost = `${subPart}.${baseDomain}`;
  const slugSub = `e2e-managed-sub-${ts}`;
  let podcastSubId;

  results.push(
    await runOne('Managed sub-domain: when allow_sub_domain false, customFeedSlug is empty', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultDomain: baseDomain,
          dnsDefaultAllowSubDomain: false,
        }),
      }, jar);

      const created = await createShow(jar, { title: 'E2E Managed Sub Show', slug: slugSub });
      podcastSubId = created.id;

      await apiFetch(`/podcasts/${podcastSubId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedSubDomain: subPart }),
      }, jar);

      const data = await getPublicConfig(subHost);
      if (data.customFeedSlug !== undefined && data.customFeedSlug !== null) {
        throw new Error(`Expected no customFeedSlug when allow_sub_domain false (Host=${subHost}), got ${data.customFeedSlug}`);
      }
    })
  );

  results.push(
    await runOne('Managed sub-domain: when allow_sub_domain true, customFeedSlug is set', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultDomain: baseDomain,
          dnsDefaultAllowSubDomain: true,
        }),
      }, jar);

      await apiFetch(`/podcasts/${podcastSubId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managedSubDomain: subPart }),
      }, jar);

      const data = await getPublicConfig(subHost);
      if (data.customFeedSlug !== slugSub) {
        throw new Error(`Expected customFeedSlug "${slugSub}" when Host=${subHost}, got ${data.customFeedSlug}`);
      }
    })
  );

  results.push(
    await runOne('Restore DNS default settings for other tests', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsDefaultAllowDomain: false,
          dnsDefaultAllowSubDomain: false,
          dnsDefaultDomain: '',
        }),
      }, jar);
    })
  );

  return results;
}
