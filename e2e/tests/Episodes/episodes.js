import { apiFetch, loginAsAdmin, createShow, createEpisode } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, { title: 'E2E Ep Show', slug: `e2e-ep-${Date.now()}` });

  results.push(
    await runOne('GET /podcasts/:podcastId/episodes returns list', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/episodes`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.episodes)) throw new Error('Expected episodes array');
    })
  );

  results.push(
    await runOne('POST /podcasts/:podcastId/episodes creates episode', async () => {
      const ep = await createEpisode(jar, podcast.id, { title: 'E2E Episode 1', status: 'draft' });
      if (!ep.id || ep.title !== 'E2E Episode 1') throw new Error('Expected created episode');
    })
  );

  results.push(
    await runOne('GET /episodes/:id returns episode', async () => {
      const ep = await createEpisode(jar, podcast.id, { title: 'E2E Episode Get', status: 'draft' });
      const res = await apiFetch(`/episodes/${ep.id}`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.id !== ep.id) throw new Error('Expected same episode id');
    })
  );

  return results;
}
