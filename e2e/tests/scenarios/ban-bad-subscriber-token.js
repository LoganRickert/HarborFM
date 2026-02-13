/**
 * Bad subscriber token (random string): request private RSS until 429, admin unban, then confirm 404.
 */
import { randomBytes } from 'crypto';
import { baseURL, loginAsAdmin, apiFetch, createShow } from '../../lib/helpers.js';

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
  const { jar } = await loginAsAdmin();
  const slug = `e2e-ban-sub-${Date.now()}`;
  await createShow(jar, { title: 'E2E Ban Sub Show', slug });

  results.push(
    await runOne('Bad subscriber token: eventually 429, then unban yields 404', async () => {
      const badToken = 'hfm_sub_' + randomBytes(24).toString('hex');
      const url = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(badToken)}/rss`;
      let lastStatus = 0;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const res = await fetch(url);
        lastStatus = res.status;
        if (res.status === 429) break;
        if (res.status !== 404) throw new Error(`Expected 404 or 429, got ${res.status}`);
      }
      if (lastStatus !== 429) throw new Error(`Expected 429 after ${MAX_ATTEMPTS} bad token attempts, got ${lastStatus}`);

      await unbanLoopback(jar);

      const afterRes = await fetch(url);
      if (afterRes.status !== 404) throw new Error(`After unban expected 404, got ${afterRes.status}`);
    })
  );

  return results;
}
