/**
 * E2E: Managed domain and managed sub-domain vs custom_feed_slug.
 *
 * - managed_domain (exact host, e.g. domain.com): custom_feed_slug only when dns_default_allow_domain is true.
 * - managed_sub_domain (sub.domain.com): custom_feed_slug only when dns_default_allow_sub_domain is true and dns_default_domain is set.
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
    await runOne('Managed domain: when allow_domain false, custom_feed_slug is empty', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_allow_domain: false,
          dns_default_allow_sub_domain: false,
        }),
      }, jar);

      const created = await createShow(jar, { title: 'E2E Managed Domain Show', slug: slugManaged });
      podcastManagedId = created.id;

      await apiFetch(`/podcasts/${podcastManagedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: managedHost }),
      }, jar);

      const data = await getPublicConfig(managedHost);
      if (data.custom_feed_slug !== undefined && data.custom_feed_slug !== null) {
        throw new Error(`Expected no custom_feed_slug when allow_domain false (Host=${managedHost}), got ${data.custom_feed_slug}`);
      }
    })
  );

  results.push(
    await runOne('Managed domain: when allow_domain true, custom_feed_slug is set', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_default_allow_domain: true }),
      }, jar);

      await apiFetch(`/podcasts/${podcastManagedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_domain: managedHost }),
      }, jar);

      const data = await getPublicConfig(managedHost);
      if (data.custom_feed_slug !== slugManaged) {
        throw new Error(`Expected custom_feed_slug "${slugManaged}" when Host=${managedHost}, got ${data.custom_feed_slug}`);
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
    await runOne('Managed sub-domain: when allow_sub_domain false, custom_feed_slug is empty', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_domain: baseDomain,
          dns_default_allow_sub_domain: false,
        }),
      }, jar);

      const created = await createShow(jar, { title: 'E2E Managed Sub Show', slug: slugSub });
      podcastSubId = created.id;

      await apiFetch(`/podcasts/${podcastSubId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_sub_domain: subPart }),
      }, jar);

      const data = await getPublicConfig(subHost);
      if (data.custom_feed_slug !== undefined && data.custom_feed_slug !== null) {
        throw new Error(`Expected no custom_feed_slug when allow_sub_domain false (Host=${subHost}), got ${data.custom_feed_slug}`);
      }
    })
  );

  results.push(
    await runOne('Managed sub-domain: when allow_sub_domain true, custom_feed_slug is set', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_domain: baseDomain,
          dns_default_allow_sub_domain: true,
        }),
      }, jar);

      await apiFetch(`/podcasts/${podcastSubId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managed_sub_domain: subPart }),
      }, jar);

      const data = await getPublicConfig(subHost);
      if (data.custom_feed_slug !== slugSub) {
        throw new Error(`Expected custom_feed_slug "${slugSub}" when Host=${subHost}, got ${data.custom_feed_slug}`);
      }
    })
  );

  results.push(
    await runOne('Restore DNS default settings for other tests', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_default_allow_domain: false,
          dns_default_allow_sub_domain: false,
          dns_default_domain: '',
        }),
      }, jar);
    })
  );

  return results;
}
