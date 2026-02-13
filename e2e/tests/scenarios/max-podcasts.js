import { apiFetch, loginAsAdmin, createUser, createShow, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const { email, password } = await createUser({ email: `max-podcasts-${Date.now()}@e2e.test` });

  const listRes = await apiFetch('/users?limit=100', {}, adminJar);
  const list = await listRes.json();
  const u = list.users.find((x) => x.email === email);
  if (!u) throw new Error('User not found in list');
  await apiFetch(`/users/${u.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_podcasts: 1 }),
  }, adminJar);

  const jar = cookieJar();
  await login(email, password, jar);

  results.push(
    await runOne('max_podcasts=1: first show succeeds', async () => {
      const show = await createShow(jar, { title: 'E2E Max Podcasts Show', slug: `e2e-max-pod-${Date.now()}` });
      if (!show?.id) throw new Error('Expected show to be created');
    })
  );

  results.push(
    await runOne('max_podcasts=1: second show returns 403', async () => {
      const res = await apiFetch('/podcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'E2E Second Show', slug: `e2e-max-pod-2-${Date.now()}`, description: '' }),
      }, jar);
      if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('limit')) throw new Error('Expected limit error message');
    })
  );

  return results;
}
