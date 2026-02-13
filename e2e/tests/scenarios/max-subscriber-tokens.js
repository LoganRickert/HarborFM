import { apiFetch, loginAsAdmin, createUser, createShow, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const { email, password } = await createUser({ email: `max-tokens-${Date.now()}@e2e.test` });

  const listRes = await apiFetch('/users?limit=100', {}, adminJar);
  const list = await listRes.json();
  const u = list.users.find((x) => x.email === email);
  if (!u) throw new Error('User not found in list');
  await apiFetch(`/users/${u.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_subscriber_tokens: 1 }),
  }, adminJar);

  const jar = cookieJar();
  await login(email, password, jar);

  const podcast = await createShow(jar, { title: 'E2E Max Tokens Show', slug: `e2e-max-tokens-${Date.now()}` });
  await apiFetch(`/podcasts/${podcast.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_only_feed_enabled: 1 }),
  }, jar);

  results.push(
    await runOne('max_subscriber_tokens=1: first token succeeds', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E First Token' }),
      }, jar);
      if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    })
  );

  results.push(
    await runOne('max_subscriber_tokens=1: second token returns 400', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Second Token' }),
      }, jar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.includes('limit of 1 subscriber token')) throw new Error('Expected limit of 1 subscriber token error');
    })
  );

  return results;
}
