/**
 * Bad API key (random string): request until 429, admin unban, then confirm 401.
 */
import { randomBytes } from 'crypto';
import { baseURL, loginAsAdmin, apiFetch } from '../../lib/helpers.js';

const E2E_CLIENT_IP = process.env.E2E_CLIENT_IP || '127.0.0.1';
const MAX_ATTEMPTS = 15;

/** Unban both common loopback IPs so server-stored IP (IPv4 or IPv6) is cleared. */
async function unbanLoopback(adminJar) {
  for (const ip of [E2E_CLIENT_IP, '127.0.0.1', '::1']) {
    await apiFetch(`/bans/${encodeURIComponent(ip)}`, { method: 'DELETE' }, adminJar);
  }
}

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('Bad API key: eventually 429, then unban yields 401', async () => {
      const badKey = 'hfm_' + randomBytes(32).toString('hex');
      let lastStatus = 0;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const res = await fetch(`${baseURL}/podcasts`, {
          headers: { Authorization: `Bearer ${badKey}` },
        });
        lastStatus = res.status;
        if (res.status === 429) break;
        if (res.status !== 401) throw new Error(`Expected 401 or 429, got ${res.status}`);
      }
      if (lastStatus !== 429) throw new Error(`Expected 429 after ${MAX_ATTEMPTS} bad API key attempts, got ${lastStatus}`);

      await unbanLoopback(adminJar);

      const afterRes = await fetch(`${baseURL}/podcasts`, {
        headers: { Authorization: `Bearer ${badKey}` },
      });
      if (afterRes.status !== 401) throw new Error(`After unban expected 401, got ${afterRes.status}`);
    })
  );

  return results;
}
