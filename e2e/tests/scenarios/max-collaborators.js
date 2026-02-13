import { apiFetch, loginAsAdmin, createUser, createShow, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const { email, password } = await createUser({ email: `max-collab-${Date.now()}@e2e.test` });

  const listRes = await apiFetch('/users?limit=100', {}, adminJar);
  const list = await listRes.json();
  const u = list.users.find((x) => x.email === email);
  if (!u) throw new Error('User not found in list');
  await apiFetch(`/users/${u.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_collaborators: 1 }),
  }, adminJar);

  const jar = cookieJar();
  await login(email, password, jar);

  const podcast = await createShow(jar, { title: 'E2E Max Collab Show', slug: `e2e-max-collab-${Date.now()}` });

  const { email: emailA } = await createUser({ email: `max-collab-a-${Date.now()}@e2e.test` });
  const { email: emailB } = await createUser({ email: `max-collab-b-${Date.now()}@e2e.test` });

  results.push(
    await runOne('max_collaborators=1: first collaborator succeeds', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailA, role: 'editor' }),
      }, jar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
    })
  );

  results.push(
    await runOne('max_collaborators=1: second collaborator returns 403', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailB, role: 'editor' }),
      }, jar);
      if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('collaborator limit')) throw new Error('Expected collaborator limit error');
    })
  );

  return results;
}
