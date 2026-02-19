/**
 * E2E: Link domain server setting and customFeedSlug.
 *
 * - User cannot set linkDomain when server "allow linking domain" is disabled (API rejects).
 * - User can set linkDomain when server "allow linking domain" is enabled.
 * - When linking enabled and podcast has linkDomain: GET /public/config with that host returns customFeedSlug.
 * - When linking disabled (even if podcast has linkDomain): GET /public/config with that host does not return customFeedSlug.
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
    await runOne('With linking domain disabled, PATCH podcast with linkDomain is rejected', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsAllowLinkingDomain: false }),
      }, jar);

      const created = await createShow(jar, { title: 'E2E Link Domain Show', slug });
      podcastId = created.id;

      const res = await apiFetch(`/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkDomain: linkHost }),
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
    await runOne('With linking domain enabled, PATCH podcast with linkDomain is accepted', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsAllowLinkingDomain: true }),
      }, jar);

      const res = await apiFetch(`/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkDomain: linkHost }),
      }, jar);

      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200 when linking enabled, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if ((data.linkDomain || '').trim().toLowerCase() !== linkHost.toLowerCase()) {
        throw new Error(`Expected linkDomain to be set to ${linkHost}, got ${data.linkDomain}`);
      }
    })
  );

  results.push(
    await runOne('When linking enabled and podcast has linkDomain, GET /public/config with that host returns customFeedSlug', async () => {
      const data = await getPublicConfig(linkHost);
      if (data.customFeedSlug !== slug) {
        throw new Error(`Expected customFeedSlug "${slug}" when Host=${linkHost}, got ${data.customFeedSlug}`);
      }
    })
  );

  results.push(
    await runOne('When linking disabled and podcast has linkDomain, GET /public/config with that host does not return customFeedSlug', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsAllowLinkingDomain: false }),
      }, jar);

      const data = await getPublicConfig(linkHost);
      if (data.customFeedSlug !== undefined && data.customFeedSlug !== null) {
        throw new Error(`Expected no customFeedSlug when linking disabled, got ${data.customFeedSlug}`);
      }
    })
  );

  results.push(
    await runOne('Re-enable linking domain for other tests', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsAllowLinkingDomain: true }),
      }, jar);
    })
  );

  return results;
}
