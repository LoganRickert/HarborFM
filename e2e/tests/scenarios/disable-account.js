import { baseURL, apiFetch, loginAsAdmin, createUser, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('Regular user disables account then login returns 401', async () => {
      const { email, password } = await createUser({ email: `disacc-${Date.now()}@e2e.test` });
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch('/auth/me/disable-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }, jar);
      if (res.status !== 200) {
        const data = await res.json().catch(() => ({}));
        throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
      }
      const loginRes = await fetch(`${baseURL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (loginRes.status !== 401) throw new Error(`Expected 401 after disable, got ${loginRes.status}`);
      const loginData = await loginRes.json();
      if (!loginData.error || !String(loginData.error).toLowerCase().includes('invalid')) {
        throw new Error('Expected invalid credentials or similar message for disabled user');
      }
    })
  );

  results.push(
    await runOne('Wrong password: POST /auth/me/disable-account returns 401', async () => {
      const { email, password } = await createUser({ email: `disacc-wrong-${Date.now()}@e2e.test` });
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch('/auth/me/disable-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong-password-' + Date.now() }),
      }, jar);
      if (res.status !== 401) throw new Error(`Expected 401 for wrong password, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !String(data.error).toLowerCase().includes('password')) {
        throw new Error('Expected invalid password error message');
      }
    })
  );

  results.push(
    await runOne('Only admin cannot disable: POST /auth/me/disable-account returns 403', async () => {
      const { jar } = await loginAsAdmin();
      const res = await apiFetch('/auth/me/disable-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'admin-password-123' }),
      }, jar);
      if (res.status !== 403) throw new Error(`Expected 403 for only admin, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !String(data.error).toLowerCase().includes('administrator')) {
        throw new Error('Expected only administrator error message');
      }
    })
  );

  results.push(
    await runOne('Unauthenticated: POST /auth/me/disable-account returns 401', async () => {
      const res = await apiFetch('/auth/me/disable-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'any' }),
      });
      if (res.status !== 401) throw new Error(`Expected 401 when unauthenticated, got ${res.status}`);
    })
  );

  return results;
}
