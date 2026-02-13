import { readFileSync } from 'fs';
import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createUser,
  createShow,
  createEpisode,
  cookieJar,
  login,
  uploadEpisodeAudio,
  testDataMp3,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const { email, password } = await createUser({ email: `max-storage-${Date.now()}@e2e.test` });

  const listRes = await apiFetch('/users?limit=100', {}, adminJar);
  const list = await listRes.json();
  const u = list.users.find((x) => x.email === email);
  if (!u) throw new Error('User not found in list');

  const jar = cookieJar();
  await login(email, password, jar);

  const podcast = await createShow(jar, { title: 'E2E Max Storage Show', slug: `e2e-max-storage-${Date.now()}` });
  const episode1 = await createEpisode(jar, podcast.id, { title: 'E2E First Episode' });

  results.push(
    await runOne('max_storage: first upload succeeds', async () => {
      await uploadEpisodeAudio(jar, episode1.id, podcast.id, testDataMp3());
    })
  );

  // Build usage so that 1 MB limit is exceeded on next upload (test file ~159 KB; 7× > 1 MB).
  const episodes2to6 = [];
  for (let i = 2; i <= 6; i++) {
    const ep = await createEpisode(jar, podcast.id, { title: `E2E Episode ${i}` });
    episodes2to6.push(ep);
  }
  for (const ep of episodes2to6) {
    await uploadEpisodeAudio(jar, ep.id, podcast.id, testDataMp3());
  }

  const patchRes = await apiFetch(`/users/${u.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_storage_mb: 1 }),
  }, adminJar);
  if (patchRes.status !== 200) throw new Error(`PATCH user limit failed: ${patchRes.status}`);

  results.push(
    await runOne('max_storage_mb=1: upload over limit returns 403', async () => {
      const episode7 = await createEpisode(jar, podcast.id, { title: 'E2E Episode 7' });
      const buf = readFileSync(testDataMp3());
      const formData = new FormData();
      formData.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3');
      const headers = jar.apply({});
      delete headers['Content-Type'];
      const csrf = jar.get()['harborfm_csrf'];
      if (csrf) headers['x-csrf-token'] = csrf;
      const res = await fetch(`${baseURL}/episodes/${episode7.id}/audio`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
      const data = await res.json().catch(() => ({}));
      if (!data.error || !data.error.toLowerCase().includes('storage limit')) throw new Error('Expected storage limit error');
    })
  );

  return results;
}
