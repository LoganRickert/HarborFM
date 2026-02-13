import { apiFetch, loginAsAdmin, createUser } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('GET /users returns paginated list (admin)', async () => {
      const res = await apiFetch('/users', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.users)) throw new Error('Expected users array');
      if (!data.pagination) throw new Error('Expected pagination');
    })
  );

  results.push(
    await runOne('GET /users/:userId returns user (admin)', async () => {
      const listRes = await apiFetch('/users?limit=1', {}, jar);
      const list = await listRes.json();
      const userId = list.users?.[0]?.id;
      if (!userId) throw new Error('No users');
      const res = await apiFetch(`/users/${userId}`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const user = await res.json();
      if (user.id !== userId) throw new Error('Expected same user id');
    })
  );

  results.push(
    await runOne('PATCH /users/:userId can set read_only (admin)', async () => {
      const { email } = await createUser({ email: `readonly-${Date.now()}@e2e.test` });
      const listRes = await apiFetch(`/users?limit=100`, {}, jar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found in list');
      const res = await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read_only: true }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const updated = await res.json();
      if (updated.read_only !== 1) throw new Error('Expected read_only 1');
    })
  );

  results.push(
    await runOne('PATCH /users/:userId can set disabled (admin)', async () => {
      const { email } = await createUser({ email: `disabled-${Date.now()}@e2e.test` });
      const listRes = await apiFetch(`/users?limit=100`, {}, jar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found in list');
      const res = await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const updated = await res.json();
      if (updated.disabled !== 1) throw new Error('Expected disabled 1');
    })
  );

  return results;
}
