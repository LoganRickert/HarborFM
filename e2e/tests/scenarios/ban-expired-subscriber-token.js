/**
 * Expired subscriber token: reject with 404 every time, never 429 (no ban).
 */
import { baseURL, loginAsAdmin, apiFetch, createShow } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-expired-sub-${Date.now()}`;
  const podcast = await createShow(jar, { title: 'E2E Expired Sub Show', slug });

  await apiFetch(`/podcasts/${podcast.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_only_feed_enabled: 1 }),
  }, jar);

  results.push(
    await runOne('Expired subscriber token returns 404 repeatedly, never 429', async () => {
      const oneSecondLater = new Date(Date.now() + 1000).toISOString();
      const createTokenRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Expired E2E', valid_until: oneSecondLater }),
      }, jar);
      if (createTokenRes.status !== 201) {
        const t = await createTokenRes.text();
        throw new Error(`Create subscriber token failed: ${createTokenRes.status} ${t}`);
      }
      const tokenData = await createTokenRes.json();
      const token = tokenData.token;
      if (!token) throw new Error('No token in response');

      await new Promise((r) => setTimeout(r, 2100));

      const url = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(token)}/rss`;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(url);
        if (res.status === 429) throw new Error('Expired token must not trigger ban (got 429)');
        if (res.status !== 404) throw new Error(`Expected 404 for expired token, got ${res.status}`);
      }
    })
  );

  return results;
}
