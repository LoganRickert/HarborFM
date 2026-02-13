/**
 * Expired API key: reject with 401 every time, never 429 (no ban).
 */
import { baseURL, loginAsAdmin, apiFetch } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('Expired API key returns 401 repeatedly, never 429', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const createRes = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Expired E2E', valid_until: past }),
      }, adminJar);
      if (createRes.status !== 201) {
        const t = await createRes.text();
        throw new Error(`Create API key failed: ${createRes.status} ${t}`);
      }
      const data = await createRes.json();
      const rawKey = data.key;
      if (!rawKey) throw new Error('No key in response');

      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseURL}/podcasts`, {
          headers: { Authorization: `Bearer ${rawKey}` },
        });
        if (res.status === 429) throw new Error('Expired key must not trigger ban (got 429)');
        if (res.status !== 401) throw new Error(`Expected 401 for expired key, got ${res.status}`);
      }
    })
  );

  return results;
}
