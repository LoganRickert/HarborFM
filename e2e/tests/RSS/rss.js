import { apiFetch, loginAsAdmin, createShow } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, { title: 'E2E RSS Show', slug: `e2e-rss-${Date.now()}` });

  results.push(
    await runOne('GET /podcasts/:id/rss-preview returns XML', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/rss-preview`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<rss') && !text.includes('<?xml')) throw new Error('Expected RSS XML');
    })
  );

  return results;
}
