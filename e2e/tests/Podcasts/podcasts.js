import { apiFetch, loginAsAdmin, createUser, createShow, createEpisode, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('GET /podcasts returns list', async () => {
      const res = await apiFetch('/podcasts', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.podcasts)) throw new Error('Expected podcasts array');
    })
  );

  results.push(
    await runOne('POST /podcasts creates show', async () => {
      const slug = `e2e-pod-${Date.now()}`;
      const podcast = await createShow(jar, { title: 'E2E Podcast', slug });
      if (!podcast.id || podcast.slug !== slug) throw new Error('Expected created podcast with id and slug');
    })
  );

  results.push(
    await runOne('GET /podcasts/:id returns show', async () => {
      const slug = `e2e-get-${Date.now()}`;
      const created = await createShow(jar, { title: 'E2E Get Show', slug });
      const res = await apiFetch(`/podcasts/${created.id}`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.id !== created.id) throw new Error('Expected same podcast id');
    })
  );

  results.push(
    await runOne('POST /podcasts/:id/delete returns 202 and podcast is removed', async () => {
      const slug = `e2e-del-${Date.now()}`;
      const podcast = await createShow(jar, { title: 'E2E Delete Show', slug });
      await createEpisode(jar, podcast.id, { title: 'E2E Delete Ep', status: 'draft' });

      const res = await apiFetch(`/podcasts/${podcast.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, jar);
      if (res.status !== 202) throw new Error(`Expected 202, got ${res.status} ${await res.text()}`);

      const timeoutMs = 60_000;
      const pollIntervalMs = 2000;
      const start = Date.now();
      let statusData;
      while (Date.now() - start < timeoutMs) {
        const statusRes = await apiFetch(`/podcasts/${podcast.id}/delete-status`, {}, jar);
        statusData = await statusRes.json();
        if (statusData.status === 'done') break;
        if (statusData.status === 'failed') {
          throw new Error(`Delete failed: ${statusData.error || 'unknown'}`);
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      if (statusData?.status !== 'done') throw new Error('Delete timeout');

      const getRes = await apiFetch(`/podcasts/${podcast.id}`, {}, jar);
      if (getRes.status !== 404) throw new Error(`Expected 404 after delete, got ${getRes.status}`);
    })
  );

  results.push(
    await runOne('POST /podcasts/:id/delete returns 403 for non-owner', async () => {
      const slug = `e2e-del-403-${Date.now()}`;
      const podcast = await createShow(jar, { title: 'E2E Delete 403 Show', slug });
      const { email, password } = await createUser({ email: `editor-del-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, jar);
      const editorJar = cookieJar();
      await login(email, password, editorJar);

      const res = await apiFetch(`/podcasts/${podcast.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, editorJar);
      if (res.status !== 403) throw new Error(`Expected 403 for non-owner, got ${res.status} ${await res.text()}`);
    })
  );

  return results;
}
