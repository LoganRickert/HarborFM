import { apiFetch, loginAsAdmin, createShow, createEpisode } from '../../lib/helpers.js';

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

  results.push(
    await runOne('RSS preview emits podcast:soundbite for published episode', async () => {
      const episode = await createEpisode(jar, podcast.id, { title: 'E2E Soundbite RSS Ep', status: 'draft' });
      const longTitle = `SB-${'x'.repeat(140)}`;
      const patchRes = await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'published',
          publishAt: null,
          finalSoundbites: [
            { time: 12.5, duration: 30, title: longTitle },
            { time: 100, duration: 45, title: '' },
          ],
        }),
      }, jar);
      if (patchRes.status !== 200) {
        throw new Error(`PATCH episode failed: ${patchRes.status} ${await patchRes.text()}`);
      }

      const res = await apiFetch(`/podcasts/${podcast.id}/rss-preview`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();

      if (!text.includes('<podcast:soundbite')) {
        throw new Error('Expected podcast:soundbite tags in RSS preview');
      }
      if (!text.includes('startTime="12.5"') || !text.includes('duration="30"')) {
        throw new Error(`Expected soundbite attrs startTime=12.5 duration=30, got snippet missing from:\n${text.slice(0, 2000)}`);
      }
      if (!text.includes('duration="45"')) {
        throw new Error('Expected second soundbite with duration 45');
      }

      const titledMatch = text.match(
        /<podcast:soundbite startTime="12\.5" duration="30">([^<]*)<\/podcast:soundbite>/,
      );
      if (!titledMatch) {
        throw new Error('Expected titled podcast:soundbite element');
      }
      const emittedTitle = titledMatch[1];
      if (emittedTitle.length > 127) {
        throw new Error(`Soundbite title longer than 127 chars: ${emittedTitle.length}`);
      }
      if (!emittedTitle.startsWith('SB-') || emittedTitle.length !== 127) {
        throw new Error(`Expected truncated 127-char title starting with SB-, got length ${emittedTitle.length}`);
      }

      if (!text.includes('<podcast:soundbite startTime="100" duration="45"/>')) {
        throw new Error('Expected self-closing soundbite for empty title');
      }
    })
  );

  return results;
}
