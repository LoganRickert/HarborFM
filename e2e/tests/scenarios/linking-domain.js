/**
 * E2E: Link domain server setting and custom_feed_slug.
 *
 * - User cannot set link_domain when server "allow linking domain" is disabled (API rejects).
 * - User can set link_domain when server "allow linking domain" is enabled.
 * - When linking enabled and podcast has link_domain: GET /public/config with that host returns custom_feed_slug.
 * - When linking disabled (even if podcast has link_domain): GET /public/config with that host does not return custom_feed_slug.
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
  const linkHost = `e2e-link-${Date.now()}.test`;
  const slug = `e2e-link-slug-${Date.now()}`;
  let podcastId;

  results.push(
    await runOne('With linking domain disabled, PATCH podcast with link_domain is rejected', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_allow_linking_domain: false }),
      }, jar);

      const created = await createShow(jar, { title: 'E2E Link Domain Show', slug });
      podcastId = created.id;

      const res = await apiFetch(`/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_domain: linkHost }),
      }, jar);

      if (res.status !== 400) {
        const t = await res.text();
        throw new Error(`Expected 400 when linking disabled, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('linking')) {
        throw new Error('Expected error message about linking domain disabled');
      }
    })
  );

  results.push(
    await runOne('With linking domain enabled, PATCH podcast with link_domain is accepted', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_allow_linking_domain: true }),
      }, jar);

      const res = await apiFetch(`/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_domain: linkHost }),
      }, jar);

      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when linking enabled, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.link_domain || '').trim().toLowerCase() !== linkHost.toLowerCase()) {
        throw new Error(`Expected link_domain to be set to ${linkHost}, got ${data.link_domain}`);
      }
    })
  );

  results.push(
    await runOne('When linking enabled and podcast has link_domain, GET /public/config with that host returns custom_feed_slug', async () => {
      const data = await getPublicConfig(linkHost);
      if (data.custom_feed_slug !== slug) {
        throw new Error(`Expected custom_feed_slug "${slug}" when Host=${linkHost}, got ${data.custom_feed_slug}`);
      }
    })
  );

  results.push(
    await runOne('When linking disabled and podcast has link_domain, GET /public/config with that host does not return custom_feed_slug', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_allow_linking_domain: false }),
      }, jar);

      const data = await getPublicConfig(linkHost);
      if (data.custom_feed_slug !== undefined && data.custom_feed_slug !== null) {
        throw new Error(`Expected no custom_feed_slug when linking disabled, got ${data.custom_feed_slug}`);
      }
    })
  );

  results.push(
    await runOne('Re-enable linking domain for other tests', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_allow_linking_domain: true }),
      }, jar);
    })
  );

  return results;
}
