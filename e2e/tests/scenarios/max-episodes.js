import { apiFetch, loginAsAdmin, createUser, createShow, createEpisode, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const { email, password } = await createUser({ email: `max-episodes-${Date.now()}@e2e.test` });

  const listRes = await apiFetch('/users?limit=100', {}, adminJar);
  const list = await listRes.json();
  const u = list.users.find((x) => x.email === email);
  if (!u) throw new Error('User not found in list');
  await apiFetch(`/users/${u.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_episodes: 1 }),
  }, adminJar);

  const jar = cookieJar();
  await login(email, password, jar);

  const podcast = await createShow(jar, { title: 'E2E Max Episodes Show', slug: `e2e-max-ep-${Date.now()}` });

  results.push(
    await runOne('max_episodes=1: first episode succeeds', async () => {
      const episode = await createEpisode(jar, podcast.id, { title: 'E2E First Episode' });
      if (!episode?.id) throw new Error('Expected episode to be created');
    })
  );

  results.push(
    await runOne('max_episodes=1: second episode returns 403', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'E2E Second Episode', description: '', status: 'draft' }),
      }, jar);
      if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.includes('limit of 1 episode')) throw new Error('Expected limit of 1 episode error');
    })
  );

  return results;
}
