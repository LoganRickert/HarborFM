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
  const slug = `e2e-feed-${Date.now()}`;
  const podcast = await createShow(jar, { title: 'E2E Feed Show', slug, description: '' });

  results.push(
    await runOne('Unlisted podcast not in public list', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlisted: 1 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.podcasts?.some((p) => p.slug === slug);
      if (found) throw new Error('Unlisted podcast should not appear in public list');
    })
  );

  results.push(
    await runOne('Unlisted podcast visible by slug', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.slug !== slug) throw new Error('Expected slug to match');
    })
  );

  results.push(
    await runOne('Subscriber-only feed mode on podcast', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_only_feed_enabled: 1 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.subscriber_only_feed_enabled && data.subscriber_only_feed_enabled !== 1) {
        throw new Error('Expected subscriber_only_feed_enabled');
      }
    })
  );

  let episode;
  let episodeSlug;

  results.push(
    await runOne('Create and publish episode, visible on public feed', async () => {
      episode = await createEpisode(jar, podcast.id, { title: 'E2E Feed Episode', status: 'draft' });
      episodeSlug = episode.slug;
      await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published', publish_at: null }),
      }, jar);
      await uploadEpisodeAudio(jar, episode.id, podcast.id, testDataMp3());
      await processEpisodeAudio(jar, episode.id);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.episodes?.some((e) => e.id === episode.id || e.title === 'E2E Feed Episode');
      if (!found) throw new Error('Published episode should appear in public episodes list');
    })
  );

  results.push(
    await runOne('Public episode audio HEAD 200 when not subscriber_only', async () => {
      const url = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status !== 200) throw new Error(`Expected 200 for public episode audio HEAD, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Draft episode not on public feed', async () => {
      await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.episodes?.some((e) => e.id === episode.id);
      if (found) throw new Error('Draft episode should not appear in public feed');
    })
  );

  results.push(
    await runOne('Publish again, set episode subscriber_only', async () => {
      await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published', subscriber_only: 1 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const ep = data.episodes?.find((e) => e.id === episode.id);
      if (!ep) throw new Error('Episode should appear in list');
      if (ep.audio_url && ep.subscriber_only !== 1) {
        throw new Error('Subscriber-only episode should not have public audio_url or should have subscriber_only flag');
      }
    })
  );

  let tokenId;

  results.push(
    await runOne('Subscriber token: episode in private RSS', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Feed Sub Token' }),
      }, jar);
      if (createRes.status !== 201) throw new Error(`Expected 201, got ${createRes.status}`);
      const created = await createRes.json();
      tokenId = created.token;
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenId)}/rss`);
      if (res.status !== 200) throw new Error(`Expected 200 for private RSS, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('E2E Feed Episode') && !text.includes(episode.id)) {
        throw new Error('Private RSS should contain episode title or id');
      }
    })
  );

  results.push(
    await runOne('Public RSS 404 when podcast subscriber-only (public_feed_disabled)', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_feed_disabled: 1 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`);
      if (res.status !== 404) throw new Error(`Expected 404 for public RSS when feed disabled, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Private RSS 200 with token when podcast subscriber-only', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenId)}/rss`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<?xml') && !text.includes('<rss')) throw new Error('Expected RSS XML');
    })
  );

  results.push(
    await runOne('HEAD public episode MP3 (subscriber_only) fails', async () => {
      const url = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status !== 404) throw new Error(`Expected 404 for subscriber_only episode public URL, got ${res.status}`);
    })
  );

  results.push(
    await runOne('HEAD private episode MP3 with token succeeds', async () => {
      const url = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenId)}/episodes/${episode.id}`;
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status !== 200) throw new Error(`Expected 200 for private episode audio HEAD, got ${res.status}`);
    })
  );

  results.push(
    await runOne('GET private episode MP3 with token', async () => {
      const url = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenId)}/episodes/${episode.id}`;
      const res = await fetch(url);
      if (res.status !== 200) throw new Error(`Expected 200 for private episode audio GET, got ${res.status}`);
      const cl = res.headers.get('content-length');
      if (cl && parseInt(cl, 10) === 0) throw new Error('Expected non-zero audio body');
    })
  );

  results.push(
    await runOne('Invalid token: private RSS and episode audio return 404', async () => {
      for (const toUnban of [process.env.E2E_CLIENT_IP || '127.0.0.1', '127.0.0.1', '::1']) {
        await apiFetch(`/bans/${encodeURIComponent(toUnban)}`, { method: 'DELETE' }, jar);
      }
      const invalidToken = 'not-a-valid-token-' + Math.random().toString(36).slice(2);
      const rssRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(invalidToken)}/rss`);
      if (rssRes.status !== 404) throw new Error(`Expected 404 for private RSS with invalid token, got ${rssRes.status}`);
      const episodeRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(invalidToken)}/episodes/${episode.id}`, { method: 'HEAD' });
      if (episodeRes.status !== 404) throw new Error(`Expected 404 for private episode with invalid token, got ${episodeRes.status}`);
    })
  );

  results.push(
    await runOne('Future publish_at: episode not on public feed', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_at: future, subscriber_only: 0 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.episodes?.some((e) => e.id === episode.id);
      if (found) throw new Error('Episode with future publish_at should not appear in public feed');
    })
  );

  results.push(
    await runOne('Unlist then relist: podcast appears in public list', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlisted: 0 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.podcasts?.some((p) => p.slug === slug);
      if (!found) throw new Error('Relisted podcast should appear in public list');
    })
  );

  results.push(
    await runOne('Episode by slug returns 200', async () => {
      await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_at: null, status: 'published' }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episodeSlug)}`);
      if (res.status !== 200) throw new Error(`Expected 200 for episode by slug, got ${res.status}`);
      const data = await res.json();
      if (data.slug !== episodeSlug && data.id !== episode.id) throw new Error('Expected episode slug or id to match');
    })
  );

  return results;
}
