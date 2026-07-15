import { apiFetch, loginAsAdmin, createUser, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  results.push(
    await runOne('GET /settings includes defaultCanStripe (default true)', async () => {
      const res = await apiFetch('/settings', {}, adminJar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (typeof data.defaultCanStripe !== 'boolean') {
        throw new Error('Expected defaultCanStripe boolean');
      }
      if (data.defaultCanStripe !== true) {
        throw new Error(`Expected defaultCanStripe true by default, got ${data.defaultCanStripe}`);
      }
    })
  );

  results.push(
    await runOne('PATCH /settings can set defaultCanStripe false then true', async () => {
      let res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCanStripe: false }),
      }, adminJar);
      if (res.status !== 200) throw new Error(`Expected 200 setting false, got ${res.status}`);
      let data = await res.json();
      if (data.defaultCanStripe !== false) throw new Error('Expected defaultCanStripe false after PATCH');

      res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCanStripe: true }),
      }, adminJar);
      if (res.status !== 200) throw new Error(`Expected 200 setting true, got ${res.status}`);
      data = await res.json();
      if (data.defaultCanStripe !== true) throw new Error('Expected defaultCanStripe true after PATCH');
    })
  );

  results.push(
    await runOne('New user inherits defaultCanStripe true', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCanStripe: true, registrationEnabled: true }),
      }, adminJar);

      const { email, password } = await createUser({ email: `stripe-yes-${Date.now()}@e2e.test` });
      const jar = cookieJar();
      await login(email, password, jar);
      const meRes = await apiFetch('/auth/me', {}, jar);
      if (meRes.status !== 200) throw new Error(`Expected 200 /auth/me, got ${meRes.status}`);
      const me = await meRes.json();
      if (me.user?.canStripe !== 1) {
        throw new Error(`Expected canStripe 1 for new user, got ${me.user?.canStripe}`);
      }

      const statusRes = await apiFetch('/stripe/status', {}, jar);
      if (statusRes.status !== 200) throw new Error(`Expected 200 /stripe/status, got ${statusRes.status}`);
      const status = await statusRes.json();
      if (status.canStripe !== true || status.configured !== false) {
        throw new Error(`Expected { canStripe: true, configured: false }, got ${JSON.stringify(status)}`);
      }
    })
  );

  results.push(
    await runOne('New user inherits defaultCanStripe false', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCanStripe: false, registrationEnabled: true }),
      }, adminJar);

      const { email, password } = await createUser({ email: `stripe-no-${Date.now()}@e2e.test` });
      const jar = cookieJar();
      await login(email, password, jar);
      const meRes = await apiFetch('/auth/me', {}, jar);
      if (meRes.status !== 200) throw new Error(`Expected 200 /auth/me, got ${meRes.status}`);
      const me = await meRes.json();
      if (me.user?.canStripe !== 0) {
        throw new Error(`Expected canStripe 0 for new user, got ${me.user?.canStripe}`);
      }

      const statusRes = await apiFetch('/stripe/status', {}, jar);
      if (statusRes.status !== 403) {
        throw new Error(`Expected 403 /stripe/status when canStripe false, got ${statusRes.status}`);
      }

      // Restore default for later suites
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCanStripe: true }),
      }, adminJar);
    })
  );

  results.push(
    await runOne('PATCH /users/:id canStripe false gates /stripe/status', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCanStripe: true, registrationEnabled: true }),
      }, adminJar);

      const { email, password } = await createUser({ email: `stripe-gate-${Date.now()}@e2e.test` });
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found in list');

      const patchRes = await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canStripe: false }),
      }, adminJar);
      if (patchRes.status !== 200) throw new Error(`Expected 200 PATCH user, got ${patchRes.status}`);
      const updated = await patchRes.json();
      if (updated.canStripe !== 0) throw new Error(`Expected canStripe 0 after PATCH, got ${updated.canStripe}`);

      const jar = cookieJar();
      await login(email, password, jar);
      const statusRes = await apiFetch('/stripe/status', {}, jar);
      if (statusRes.status !== 403) {
        throw new Error(`Expected 403 after disabling canStripe, got ${statusRes.status}`);
      }
    })
  );

  results.push(
    await runOne('Admin create user inherits defaultCanStripe', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCanStripe: true }),
      }, adminJar);

      const email = `stripe-admin-create-${Date.now()}@e2e.test`;
      const createRes = await apiFetch('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'user-password-123', role: 'user' }),
      }, adminJar);
      if (createRes.status !== 201 && createRes.status !== 200) {
        throw new Error(`Expected 200/201 create user, got ${createRes.status}`);
      }
      const created = await createRes.json();
      if (created.canStripe !== 1) {
        throw new Error(`Expected canStripe 1 on admin-created user, got ${created.canStripe}`);
      }
    })
  );

  return results;
}
