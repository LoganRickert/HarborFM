/**
 * API keys and subscriber tokens: valid_from (1 year ahead), valid_until (2 years ahead),
 * and API key enabled/disabled (PATCH).
 * Uses a dedicated user for the API key tests to avoid hitting the 5-keys-per-user limit
 * (admin may already have keys from Auth, apikey-expiry, ban-expired-apikey).
 */
import { baseURL, loginAsAdmin, apiFetch, createShow, createUser, login, cookieJar } from '../../lib/helpers.js';

function oneYearFromNow() {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
}
function twoYearsFromNow() {
  return new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
}
function oneYearAgo() {
  return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
}

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  // Dedicated user for API key tests so we don't hit the 5-keys-per-user limit
  const { email: apiKeyUserEmail, password: apiKeyUserPassword } = await createUser({
    email: `apikey-valid-${Date.now()}@e2e.test`,
  });
  const apiKeyUserJar = cookieJar();
  await login(apiKeyUserEmail, apiKeyUserPassword, apiKeyUserJar);

  // --- API key: valid_from 1 year in future, valid_until 2 years in future -> 401 now (not yet valid)
  results.push(
    await runOne('API key with valid_from 1yr future and valid_until 2yr future returns 401 until valid_from', async () => {
      const createRes = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Valid From Future',
          valid_from: oneYearFromNow(),
          valid_until: twoYearsFromNow(),
        }),
      }, apiKeyUserJar);
      if (createRes.status !== 201) {
        const t = await createRes.text();
        throw new Error(`Create API key failed: ${createRes.status} ${t}`);
      }
      const data = await createRes.json();
      const rawKey = data.key;
      if (!rawKey) throw new Error('No key in response');

      const meRes = await fetch(`${baseURL}/auth/me`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (meRes.status !== 401) throw new Error(`Expected 401 when key not yet valid (valid_from in future), got ${meRes.status}`);
    })
  );

  // --- API key: valid_from in past, valid_until 2 years in future -> 200
  results.push(
    await runOne('API key with valid_from in past and valid_until 2yr future returns 200', async () => {
      const createRes = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Valid Window Key',
          valid_from: oneYearAgo(),
          valid_until: twoYearsFromNow(),
        }),
      }, apiKeyUserJar);
      if (createRes.status !== 201) {
        const t = await createRes.text();
        throw new Error(`Create API key failed: ${createRes.status} ${t}`);
      }
      const data = await createRes.json();
      const rawKey = data.key;
      if (!rawKey) throw new Error('No key in response');

      const meRes = await fetch(`${baseURL}/auth/me`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (meRes.status !== 200) throw new Error(`Expected 200 with key in valid window, got ${meRes.status}`);
    })
  );

  // --- API key: PATCH disabled true -> 401; PATCH disabled false -> 200
  results.push(
    await runOne('API key PATCH disabled: true returns 401; PATCH disabled: false returns 200', async () => {
      const createRes = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Disable Test Key', valid_until: twoYearsFromNow() }),
      }, apiKeyUserJar);
      if (createRes.status !== 201) {
        const t = await createRes.text();
        throw new Error(`Create API key failed: ${createRes.status} ${t}`);
      }
      const created = await createRes.json();
      const rawKey = created.key;
      const keyId = created.id;
      if (!rawKey || !keyId) throw new Error('No key or id in response');

      const meBefore = await fetch(`${baseURL}/auth/me`, { headers: { Authorization: `Bearer ${rawKey}` } });
      if (meBefore.status !== 200) throw new Error(`Expected 200 before disable, got ${meBefore.status}`);

      const patchDisableRes = await apiFetch(`/auth/api-keys/${keyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      }, apiKeyUserJar);
      if (patchDisableRes.status !== 200) {
        const t = await patchDisableRes.text();
        throw new Error(`PATCH disabled: true failed: ${patchDisableRes.status} ${t}`);
      }

      const meDisabled = await fetch(`${baseURL}/auth/me`, { headers: { Authorization: `Bearer ${rawKey}` } });
      if (meDisabled.status !== 401) throw new Error(`Expected 401 when API key disabled, got ${meDisabled.status}`);

      const patchEnableRes = await apiFetch(`/auth/api-keys/${keyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: false }),
      }, apiKeyUserJar);
      if (patchEnableRes.status !== 200) {
        const t = await patchEnableRes.text();
        throw new Error(`PATCH disabled: false failed: ${patchEnableRes.status} ${t}`);
      }

      const meAfter = await fetch(`${baseURL}/auth/me`, { headers: { Authorization: `Bearer ${rawKey}` } });
      if (meAfter.status !== 200) throw new Error(`Expected 200 after re-enabling API key, got ${meAfter.status}`);
    })
  );

  // --- Subscriber token: valid_from 1 year in future, valid_until 2 years in future -> 404 for private RSS
  const slug = `e2e-valid-${Date.now()}`;
  const podcast = await createShow(adminJar, { title: 'E2E Validity Show', slug });
  await apiFetch(`/podcasts/${podcast.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_only_feed_enabled: 1 }),
  }, adminJar);

  results.push(
    await runOne('Subscriber token with valid_from 1yr future and valid_until 2yr future returns 404 until valid_from', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Token Valid From Future',
          valid_from: oneYearFromNow(),
          valid_until: twoYearsFromNow(),
        }),
      }, adminJar);
      if (createRes.status !== 201) {
        const t = await createRes.text();
        throw new Error(`Create subscriber token failed: ${createRes.status} ${t}`);
      }
      const created = await createRes.json();
      const token = created.token;
      if (!token) throw new Error('No token in response');

      const rssRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(token)}/rss`);
      if (rssRes.status !== 404) throw new Error(`Expected 404 when token not yet valid (valid_from in future), got ${rssRes.status}`);
    })
  );

  // --- Subscriber token: valid_from in past, valid_until 2 years in future -> 200 for private RSS
  results.push(
    await runOne('Subscriber token with valid_from in past and valid_until 2yr future returns 200 for private RSS', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Token Valid Window',
          valid_from: oneYearAgo(),
          valid_until: twoYearsFromNow(),
        }),
      }, adminJar);
      if (createRes.status !== 201) {
        const t = await createRes.text();
        throw new Error(`Create subscriber token failed: ${createRes.status} ${t}`);
      }
      const created = await createRes.json();
      const token = created.token;
      if (!token) throw new Error('No token in response');

      const rssRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(token)}/rss`);
      if (rssRes.status !== 200) throw new Error(`Expected 200 for token in valid window, got ${rssRes.status}`);
      const text = await rssRes.text();
      if (!text.includes('<?xml') && !text.includes('<rss')) throw new Error('Expected RSS XML');
    })
  );

  return results;
}
