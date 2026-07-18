/**
 * Episode expiration: expiresAt hides from public; subscribersKeepExpiredEpisodes for private.
 * - PATCH expiresAt <= publishAt returns 400.
 * - Past expiresAt: omitted from public list/RSS; episode page and public audio 404.
 * - Future expiresAt: still public.
 * - Clear expiresAt: restored.
 * - Private: excluded by default; included when subscribersKeepExpiredEpisodes is on.
 */
import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
  uploadEpisodeAudio,
  processEpisodeAudio,
  testDataMp3,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-expire-${Date.now()}`;
  const podcast = await createShow(jar, { title: 'E2E Episode Expiration', slug, description: '' });

  const episode = await createEpisode(jar, podcast.id, { title: 'E2E Expire Episode', status: 'draft' });
  const episodeSlug = episode.slug;
  await uploadEpisodeAudio(jar, episode.id, podcast.id, testDataMp3());
  await processEpisodeAudio(jar, episode.id);

  const publishAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const pastExpiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const futureExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  results.push(
    await runOne('PATCH expiresAt before publishAt returns 400', async () => {
      const res = await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'published',
          publishAt,
          expiresAt: new Date(new Date(publishAt).getTime() - 60 * 1000).toISOString(),
        }),
      }, jar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('Publish with future expiresAt: visible on public list and RSS', async () => {
      const patchRes = await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'published',
          publishAt,
          expiresAt: futureExpiresAt,
        }),
      }, jar);
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);

      const listRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (listRes.status !== 200) throw new Error(`Expected 200 list, got ${listRes.status}`);
      const listData = await listRes.json();
      if (!listData.episodes?.some((e) => e.id === episode.id)) {
        throw new Error('Episode with future expiresAt should appear in public list');
      }

      const rssRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`);
      if (rssRes.status !== 200) throw new Error(`Expected 200 RSS, got ${rssRes.status}`);
      const xml = await rssRes.text();
      if (!xml.includes(episode.id) && !xml.includes(episodeSlug)) {
        throw new Error('Episode with future expiresAt should appear in public RSS');
      }
    }),
  );

  results.push(
    await runOne('Past expiresAt: omitted from public list, episode 404, public audio 404', async () => {
      const patchRes = await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresAt: pastExpiresAt }),
      }, jar);
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);

      const listRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (listRes.status !== 200) throw new Error(`Expected 200 list, got ${listRes.status}`);
      const listData = await listRes.json();
      if (listData.episodes?.some((e) => e.id === episode.id)) {
        throw new Error('Expired episode should not appear in public list');
      }

      const epRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episodeSlug)}`,
      );
      if (epRes.status !== 404) throw new Error(`Expected 404 for expired episode page, got ${epRes.status}`);

      const audioRes = await fetch(`${baseURL}/${podcast.id}/episodes/${episode.id}`, { method: 'HEAD' });
      if (audioRes.status !== 404) {
        throw new Error(`Expected 404 for public audio when expired, got ${audioRes.status}`);
      }

      const rssRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`);
      if (rssRes.status !== 200) throw new Error(`Expected 200 RSS, got ${rssRes.status}`);
      const xml = await rssRes.text();
      if (xml.includes(`episodes/${episode.id}`) || xml.includes(`/${episodeSlug}<`)) {
        throw new Error('Expired episode should not appear in public RSS');
      }
    }),
  );

  let tokenValue;
  results.push(
    await runOne('Private: expired excluded by default (toggle off)', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriberOnlyFeedEnabled: 1,
          subscribersKeepExpiredEpisodes: 0,
        }),
      }, jar);
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Expire Token' }),
      }, jar);
      if (createRes.status !== 201) throw new Error(`Expected 201 creating token, got ${createRes.status}`);
      const created = await createRes.json();
      tokenValue = created.token;

      const privateUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenValue)}/episodes/${episode.id}`;
      const audioRes = await fetch(privateUrl, { method: 'HEAD' });
      if (audioRes.status !== 404) {
        throw new Error(`Expected 404 private audio when expired and keep-off, got ${audioRes.status}`);
      }

      const rssRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenValue)}/rss`,
      );
      if (rssRes.status !== 200) throw new Error(`Expected 200 private RSS, got ${rssRes.status}`);
      const xml = await rssRes.text();
      if (xml.includes(`episodes/${episode.id}`)) {
        throw new Error('Expired episode should not appear in private RSS when keep-off');
      }
    }),
  );

  results.push(
    await runOne('Private: expired included when subscribersKeepExpiredEpisodes on; public still hidden', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribersKeepExpiredEpisodes: 1 }),
      }, jar);

      const privateUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenValue)}/episodes/${episode.id}`;
      const audioRes = await fetch(privateUrl, { method: 'HEAD' });
      if (audioRes.status !== 200 && audioRes.status !== 206) {
        throw new Error(`Expected 200/206 private audio when keep-on, got ${audioRes.status}`);
      }

      const rssRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenValue)}/rss`,
      );
      if (rssRes.status !== 200) throw new Error(`Expected 200 private RSS, got ${rssRes.status}`);
      const xml = await rssRes.text();
      if (!xml.includes(`episodes/${episode.id}`)) {
        throw new Error('Expired episode should appear in private RSS when keep-on');
      }

      const listRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      const listData = await listRes.json();
      if (listData.episodes?.some((e) => e.id === episode.id)) {
        throw new Error('Public list must still hide expired episode when keep-on');
      }
    }),
  );

  results.push(
    await runOne('Clear expiresAt: episode restored on public list', async () => {
      const patchRes = await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresAt: null }),
      }, jar);
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);

      const listRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (listRes.status !== 200) throw new Error(`Expected 200 list, got ${listRes.status}`);
      const listData = await listRes.json();
      if (!listData.episodes?.some((e) => e.id === episode.id)) {
        throw new Error('Episode should appear again after clearing expiresAt');
      }
    }),
  );

  return results;
}
