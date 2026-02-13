import { baseURL, apiFetch, loginAsAdmin, createUser, createShow, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('Read-only user: POST /podcasts returns 403', async () => {
      const { email, password } = await createUser({ email: `ro-${Date.now()}@e2e.test` });
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read_only: true }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch('/podcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'RO Test', slug: `ro-${Date.now()}` }),
      }, jar);
      if (res.status !== 403) throw new Error(`Expected 403 for read-only user, got ${res.status}`);
      const data = await res.json();
      const err = (data.error || '').toLowerCase();
      if (!err.includes('read-only') && !err.includes('not allowed')) throw new Error('Expected read-only error message');
    })
  );

  results.push(
    await runOne('Read-only user: GET /podcasts returns 200', async () => {
      const { email, password } = await createUser({ email: `ro-get-${Date.now()}@e2e.test` });
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read_only: true }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch('/podcasts', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200 for read-only GET, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Disabled user: login returns 403', async () => {
      const { email, password } = await createUser({ email: `dis-${Date.now()}@e2e.test` });
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      }, adminJar);
      const res = await fetch(`${baseURL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.status !== 403) throw new Error(`Expected 403 for disabled login, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('disabled')) throw new Error('Expected disabled error message');
    })
  );

  results.push(
    await runOne('Disabled user: GET /auth/me with API key returns 403', async () => {
      const { email, password } = await createUser({ email: `dis-key-${Date.now()}@e2e.test` });
      const jar = cookieJar();
      await login(email, password, jar);
      const createKeyRes = await apiFetch('/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, jar);
      const keyData = await createKeyRes.json();
      const rawKey = keyData.key;
      if (!rawKey) throw new Error('Expected key');
      await apiFetch('/users?limit=100', {}, adminJar);
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      }, adminJar);
      const res = await fetch(`${baseURL}/auth/me`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (res.status !== 403) throw new Error(`Expected 403 for disabled user with API key, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('disabled')) throw new Error('Expected disabled error message');
    })
  );

  return results;
}
