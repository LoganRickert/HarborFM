import { apiFetch, loginAsAdmin, createShow, createEpisode } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, { title: 'E2E Audio Show', slug: `e2e-audio-${Date.now()}` });
  const episode = await createEpisode(jar, podcast.id, { title: 'E2E Audio Ep', status: 'draft' });

  results.push(
    await runOne('GET /episodes/:id/final-waveform returns 404 when no audio', async () => {
      const res = await apiFetch(`/episodes/${episode.id}/final-waveform`, {}, jar);
      if (res.status !== 404) throw new Error(`Expected 404 when no final audio, got ${res.status}`);
    })
  );

  results.push(
    await runOne('GET /asr/available returns available flag', async () => {
      const res = await apiFetch('/asr/available', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (typeof data.available !== 'boolean') throw new Error('Expected available boolean');
    })
  );

  return results;
}
