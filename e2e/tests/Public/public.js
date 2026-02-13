import { baseURL, loginAsAdmin, createShow, apiFetch } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-public-${Date.now()}`;
  await createShow(jar, { title: 'E2E Public Show', slug });

  results.push(
    await runOne('GET /public/config returns public_feeds_enabled', async () => {
      const res = await fetch(`${baseURL}/public/config`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (typeof data.public_feeds_enabled !== 'boolean') throw new Error('Expected public_feeds_enabled');
    })
  );

  results.push(
    await runOne('GET /public/podcasts returns list when feeds enabled', async () => {
      const res = await fetch(`${baseURL}/public/podcasts`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.podcasts)) throw new Error('Expected podcasts array');
    })
  );

  results.push(
    await runOne('GET /public/podcasts/:slug returns podcast when feeds enabled', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.slug !== slug) throw new Error('Expected same slug');
    })
  );

  results.push(
    await runOne('GET /public/podcasts/:slug/rss returns XML when feeds enabled', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<?xml') && !text.includes('<rss')) throw new Error('Expected RSS XML');
    })
  );

  results.push(
    await runOne('When admin disables public feed, GET /public/config returns public_feeds_enabled false', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_feeds_enabled: false }),
      }, jar);
      const res = await fetch(`${baseURL}/public/config`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.public_feeds_enabled !== false) throw new Error('Expected public_feeds_enabled: false');
    })
  );

  results.push(
    await runOne('When public feed disabled, GET /public/podcasts returns 404', async () => {
      const res = await fetch(`${baseURL}/public/podcasts`);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    })
  );

  results.push(
    await runOne('When public feed disabled, GET /public/podcasts/:slug returns 404', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    })
  );

  results.push(
    await runOne('When admin re-enables public feed, GET /public/config returns 200', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_feeds_enabled: true }),
      }, jar);
      const res = await fetch(`${baseURL}/public/config`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.public_feeds_enabled !== true) throw new Error('Expected public_feeds_enabled true');
    })
  );

  results.push(
    await runOne('When public feed enabled, GET /public/podcasts returns 200', async () => {
      const res = await fetch(`${baseURL}/public/podcasts`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    })
  );

  return results;
}
