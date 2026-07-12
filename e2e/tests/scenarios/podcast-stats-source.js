import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
  uploadEpisodeAudio,
  processEpisodeAudio,
  testDataMp3,
  createUser,
  login,
  cookieJar,
} from '../../lib/helpers.js';

const FLUSH_WAIT_MS = 4500;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * E2E: Podcast stats include source (Apple Podcasts, Spotify, Other).
 * Requests public RSS with different User-Agents, waits for stats flush, then asserts
 * GET /podcasts/:id/analytics returns rows with source.
 */
export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-stats-${Date.now()}`;
  const podcast = await createShow(jar, { title: 'E2E Stats Show', slug });
  const episode = await createEpisode(jar, podcast.id, { title: 'E2E Stats Episode', status: 'draft' });
  await apiFetch(`/episodes/${episode.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'published', publishAt: null }),
  }, jar);
  await uploadEpisodeAudio(jar, episode.id, podcast.id, testDataMp3());
  await processEpisodeAudio(jar, episode.id);

  results.push(
    await runOne('GET /podcasts/:id/analytics returns 200 and response shape', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.rss_daily)) throw new Error('Expected rss_daily array');
      if (!Array.isArray(data.episode_daily)) throw new Error('Expected episode_daily array');
      if (!Array.isArray(data.episode_listens_daily)) throw new Error('Expected episode_listens_daily array');
      if (!Array.isArray(data.episode_location_daily)) throw new Error('Expected episode_location_daily array');
      for (const row of data.rss_daily) {
        if (row.source === undefined) throw new Error('rss_daily row missing source');
      }
      for (const row of data.episode_daily) {
        if (row.source === undefined) throw new Error('episode_daily row missing source');
      }
      for (const row of data.episode_listens_daily) {
        if (row.source === undefined) throw new Error('episode_listens_daily row missing source');
      }
      for (const row of data.episode_location_daily) {
        if (row.source === undefined) throw new Error('episode_location_daily row missing source');
      }
    })
  );

  results.push(
    await runOne('Public RSS with Apple Podcasts UA then analytics includes source', async () => {
      const rssUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`;
      await fetch(rssUrl, {
        headers: { 'User-Agent': 'Podcasts/1611.2.1 CFNetwork/1325.0.1 Darwin/21.1.0' },
      });
      await fetch(rssUrl, {
        headers: { 'User-Agent': 'Spotify/9.0.40 iOS/18.4.1 (iPhone15,3)' },
      });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const sources = [...(data.rss_daily || []).map((r) => r.source)];
      if (!sources.includes('Apple Podcasts')) throw new Error(`Expected Apple Podcasts in rss_daily sources, got ${sources.join(', ')}`);
      if (!sources.includes('Spotify')) throw new Error(`Expected Spotify in rss_daily sources, got ${sources.join(', ')}`);
    })
  );

  results.push(
    await runOne('Unauthenticated GET /podcasts/:id/analytics returns 401', async () => {
      const res = await fetch(`${baseURL}/podcasts/${encodeURIComponent(podcast.id)}/analytics`);
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    })
  );

  results.push(
    await runOne('GET /podcasts/:id/analytics for podcast user cannot access returns 404', async () => {
      const { email, password } = await createUser({ email: `noaccess-${Date.now()}@e2e.test` });
      const otherJar = cookieJar();
      await login(email, password, otherJar);
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, otherJar);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Collaborator can GET analytics', async () => {
      const { email, password } = await createUser({ email: `collab-analytics-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, jar);
      const collabJar = cookieJar();
      await login(email, password, collabJar);
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, collabJar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.rss_daily) || !Array.isArray(data.episode_daily)) throw new Error('Expected analytics shape');
    })
  );

  results.push(
    await runOne('startDate > endDate returns 400', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics?startDate=2025-01-10&endDate=2025-01-01`, {}, jar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Invalid limit returns 400', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics?limit=0`, {}, jar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Invalid offset returns 400', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics?offset=-1`, {}, jar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Analytics response includes episodes list', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.episodes)) throw new Error('Expected episodes array');
      const found = data.episodes.some((e) => e.id === episode.id);
      if (!found) throw new Error('Expected created episode in episodes list');
    })
  );

  results.push(
    await runOne('GET public episode audio increments episode_daily after flush', async () => {
      const episodeUrl = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      await fetch(episodeUrl, { headers: { 'User-Agent': BROWSER_UA } });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const today = todayUTC();
      const episodeRows = (data.episode_daily || []).filter((r) => r.episode_id === episode.id && r.stat_date === today);
      if (episodeRows.length === 0) throw new Error(`Expected episode_daily row for episode today, got ${JSON.stringify(data.episode_daily)}`);
      const row = episodeRows[0];
      if (row.source === undefined) throw new Error('episode_daily row missing source');
      const total = (row.human_count ?? 0) + (row.bot_count ?? 0);
      if (total < 1) throw new Error('Expected at least one request counted');
    })
  );

  results.push(
    await runOne('Full GET public episode audio counts as one listen after flush', async () => {
      const episodeUrl = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      await fetch(episodeUrl, { headers: { 'User-Agent': BROWSER_UA } });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const today = todayUTC();
      const listenRows = (data.episode_listens_daily || []).filter((r) => r.episode_id === episode.id && r.stat_date === today);
      if (listenRows.length === 0) throw new Error(`Expected episode_listens_daily row for episode today`);
      const totalListens = listenRows.reduce((sum, r) => sum + (r.human_count ?? 0) + (r.bot_count ?? 0), 0);
      if (totalListens < 1) throw new Error('Expected at least one listen counted');
    })
  );

  results.push(
    await runOne('Same client GET episode twice in same day counts as one listen (dedup)', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayUTC();
      const sumListens = (rows) => (rows || []).filter((r) => r.episode_id === episode.id && r.stat_date === today).reduce((s, r) => s + (r.human_count ?? 0) + (r.bot_count ?? 0), 0);
      const beforeListens = sumListens(beforeData.episode_listens_daily);

      const episodeUrl = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      const headers = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' };
      await fetch(episodeUrl, { headers });
      await fetch(episodeUrl, { headers });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const afterListens = sumListens(data.episode_listens_daily);
      const delta = afterListens - beforeListens;
      if (delta !== 1) throw new Error(`Expected dedup: 2 same-client GETs should add 1 listen, got delta ${delta}`);
    })
  );

  results.push(
    await runOne('RSS with generic browser UA results in source Other', async () => {
      const rssUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`;
      await fetch(rssUrl, { headers: { 'User-Agent': BROWSER_UA } });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const sources = [...(data.rss_daily || []).map((r) => r.source)];
      if (!sources.includes('Other')) throw new Error(`Expected Other in rss_daily sources, got ${sources.join(', ')}`);
    })
  );

  results.push(
    await runOne('Tiny Range GET public episode audio does not count as request or listen', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayUTC();
      const sumRows = (rows, eid) =>
        (rows || [])
          .filter((r) => r.episode_id === eid && r.stat_date === today)
          .reduce((s, r) => s + (r.human_count ?? 0) + (r.bot_count ?? 0), 0);
      const beforeReq = sumRows(beforeData.episode_daily, episode.id);
      const beforeLis = sumRows(beforeData.episode_listens_daily, episode.id);

      const episodeUrl = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      await fetch(episodeUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          Range: 'bytes=0-1',
        },
      });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const afterReq = sumRows(data.episode_daily, episode.id);
      const afterLis = sumRows(data.episode_listens_daily, episode.id);
      if (afterReq !== beforeReq) {
        throw new Error(`Expected tiny Range not to increment requests (before ${beforeReq}, after ${afterReq})`);
      }
      if (afterLis !== beforeLis) {
        throw new Error(`Expected tiny Range not to increment listens (before ${beforeLis}, after ${afterLis})`);
      }
    })
  );

  results.push(
    await runOne('Spotify/1.0 RSS counts as crawler (bot_count); Overcast RSS as listener', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayUTC();
      const sumSource = (rows, source, field) =>
        (rows || [])
          .filter((r) => r.stat_date === today && r.source === source)
          .reduce((s, r) => s + (r[field] ?? 0), 0);
      const beforeSpotifyBot = sumSource(beforeData.rss_daily, 'Spotify', 'bot_count');
      const beforeOvercastHuman = sumSource(beforeData.rss_daily, 'Overcast', 'human_count');

      const rssUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`;
      await fetch(rssUrl, { headers: { 'User-Agent': 'Spotify/1.0' } });
      await fetch(rssUrl, {
        headers: { 'User-Agent': 'Overcast/3.0 (+http://overcast.fm/; iOS podcast app)' },
      });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const afterSpotifyBot = sumSource(data.rss_daily, 'Spotify', 'bot_count');
      const afterOvercastHuman = sumSource(data.rss_daily, 'Overcast', 'human_count');
      if (afterSpotifyBot < beforeSpotifyBot + 1) {
        throw new Error(`Expected Spotify/1.0 to increment Spotify bot_count (before ${beforeSpotifyBot}, after ${afterSpotifyBot})`);
      }
      if (afterOvercastHuman < beforeOvercastHuman + 1) {
        throw new Error(`Expected Overcast to increment Overcast human_count (before ${beforeOvercastHuman}, after ${afterOvercastHuman})`);
      }
    })
  );

  return results;
}
