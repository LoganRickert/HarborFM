import { apiFetch, loginAsAdmin, createShow } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, { title: 'E2E Export Show', slug: `e2e-export-${Date.now()}` });

  results.push(
    await runOne('GET /podcasts/:id/exports returns list', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/exports`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.exports)) throw new Error('Expected exports array');
    })
  );

  return results;
}
