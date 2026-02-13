import { apiFetch, loginAsAdmin, createShow } from '../../lib/helpers.js';

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

  return results;
}
