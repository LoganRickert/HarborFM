/**
 * API key with valid_until in 1s: works once, then after 2s wait returns 401.
 */
import { baseURL, loginAsAdmin, apiFetch } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('API key expires in 1s: 200 then after 2s wait returns 401', async () => {
      const oneSecondLater = new Date(Date.now() + 1000).toISOString();
      const createRes = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '1s Expiry E2E', valid_until: oneSecondLater }),
      }, adminJar);
      if (createRes.status !== 201) {
        const t = await createRes.text();
        throw new Error(`Create API key failed: ${createRes.status} ${t}`);
      }
      const data = await createRes.json();
      const rawKey = data.key;
      if (!rawKey) throw new Error('No key in response');

      const meRes = await fetch(`${baseURL}/podcasts`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (meRes.status !== 200) throw new Error(`Expected 200 with fresh key, got ${meRes.status}`);

      await new Promise((r) => setTimeout(r, 2100));

      const afterRes = await fetch(`${baseURL}/podcasts`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (afterRes.status !== 401) throw new Error(`Expected 401 after expiry, got ${afterRes.status}`);
    })
  );

  return results;
}
