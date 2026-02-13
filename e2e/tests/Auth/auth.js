import { baseURL, loginAsAdmin, createUser, apiFetch, cookieJar } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('POST /auth/login returns 200 and sets session', async () => {
      const res = await fetch(`${baseURL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@e2e.test', password: 'admin-password-123' }),
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.user?.id) throw new Error('Expected user in response');
      const setCookie = res.headers.get('set-cookie');
      if (!setCookie || !setCookie.includes('harborfm_jwt')) throw new Error('Expected JWT cookie');
    })
  );

  results.push(
    await runOne('GET /auth/me with session returns user', async () => {
      const res = await apiFetch('/auth/me', {}, adminJar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const user = data.user || data;
      if (!user.id || user.email !== 'admin@e2e.test') throw new Error('Expected admin user');
    })
  );

  results.push(
    await runOne('POST /auth/register creates new user when registration enabled', async () => {
      const { email, password } = await createUser({ email: `reg-${Date.now()}@e2e.test` });
      const jar = cookieJar();
      const loginRes = await fetch(`${baseURL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (loginRes.status !== 200) throw new Error(`Login after register failed: ${loginRes.status}`);
    })
  );

  results.push(
    await runOne('POST /auth/api-keys creates key and returns raw key', async () => {
      const res = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, adminJar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
      const data = await res.json();
      const rawKey = data.key ?? data.raw_key ?? data.api_key;
      if (!rawKey || typeof rawKey !== 'string') throw new Error('Expected key in response');
      if (!rawKey.startsWith('hfm_')) throw new Error('Expected key to start with hfm_');
    })
  );

  results.push(
    await runOne('GET /auth/me with API key returns user', async () => {
      const createRes = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, adminJar);
      const created = await createRes.json();
      const rawKey = created.key ?? created.raw_key ?? created.api_key;
      if (!rawKey) throw new Error('Expected key in create response');
      const meRes = await fetch(`${baseURL}/auth/me`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (meRes.status !== 200) throw new Error(`Expected 200 with API key, got ${meRes.status}`);
      const me = await meRes.json();
      const user = me.user || me;
      if (!user.id) throw new Error('Expected user from API key auth');
    })
  );

  return results;
}
