import { baseURL, apiFetch, loginAsAdmin, createUser, cookieJar } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('GET /settings returns settings (admin)', async () => {
      const res = await apiFetch('/settings', {}, adminJar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (typeof data.registrationEnabled !== 'boolean') throw new Error('Expected registrationEnabled');
      if (typeof data.publicFeedsEnabled !== 'boolean') throw new Error('Expected publicFeedsEnabled');
      if (typeof data.timezone !== 'string') throw new Error('Expected timezone string');
      if (typeof data.effectiveTimezone !== 'string' || !data.effectiveTimezone.trim()) {
        throw new Error('Expected non-empty effectiveTimezone');
      }
    })
  );

  results.push(
    await runOne('PATCH /settings can set timezone to a valid IANA zone', async () => {
      const patchRes = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: 'America/Chicago' }),
      }, adminJar);
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);
      const patched = await patchRes.json();
      if (patched.timezone !== 'America/Chicago') {
        throw new Error(`Expected timezone America/Chicago, got ${patched.timezone}`);
      }
      if (patched.effectiveTimezone !== 'America/Chicago') {
        throw new Error(`Expected effectiveTimezone America/Chicago, got ${patched.effectiveTimezone}`);
      }
      const getRes = await apiFetch('/settings', {}, adminJar);
      const data = await getRes.json();
      if (data.timezone !== 'America/Chicago') {
        throw new Error(`GET Expected timezone America/Chicago, got ${data.timezone}`);
      }
    })
  );

  results.push(
    await runOne('PATCH /settings rejects invalid timezone', async () => {
      const res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: 'Not/A_Real_Zone' }),
      }, adminJar);
      if (res.status !== 400) throw new Error(`Expected 400 for invalid timezone, got ${res.status}`);
    })
  );

  results.push(
    await runOne('PATCH /settings can clear timezone to system default', async () => {
      const res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: '' }),
      }, adminJar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.timezone !== '') throw new Error(`Expected empty timezone, got ${data.timezone}`);
      if (typeof data.effectiveTimezone !== 'string' || !data.effectiveTimezone.trim()) {
        throw new Error('Expected effectiveTimezone after clear');
      }
    })
  );

  results.push(
    await runOne('PATCH /settings can set registration_enabled false', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationEnabled: false }),
      }, adminJar);
      const res = await fetch(`${baseURL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `blocked-${Date.now()}@e2e.test`, password: 'pass123456' }),
      });
      if (res.status !== 403) throw new Error(`Expected 403 when registration disabled, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('disabled')) throw new Error('Expected registration disabled error');
    })
  );

  results.push(
    await runOne('PATCH /settings can set registration_enabled true', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationEnabled: true }),
      }, adminJar);
      const { email, password } = await createUser({ email: `reopen-${Date.now()}@e2e.test` });
      const jar = cookieJar();
      const loginRes = await fetch(`${baseURL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (loginRes.status !== 200) throw new Error(`Expected 200 after re-enabling registration, got ${loginRes.status}`);
    })
  );

  return results;
}
