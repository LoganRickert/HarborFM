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

/** Match server podcastStats / analytics: YYYY-MM-DD in the process local timezone. */
function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sumRows(rows, episodeId, today) {
  return (rows || [])
    .filter((r) => r.episode_id === episodeId && r.stat_date === today)
    .reduce((s, r) => s + (r.human_count ?? 0) + (r.bot_count ?? 0), 0);
}

/**
 * E2E: Podcast stats include IAB-style Downloads, Unique listeners, Website source,
 * and website retention reach. Requests public RSS / audio with different User-Agents,
 * waits for stats flush, then asserts GET /podcasts/:id/analytics.
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
    await runOne('GET /podcasts/:id/analytics returns 200 and IAB response shape', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.rss_daily)) throw new Error('Expected rss_daily array');
      if (!Array.isArray(data.episode_daily)) throw new Error('Expected episode_daily array');
      if (!Array.isArray(data.episode_listens_daily)) throw new Error('Expected episode_listens_daily array');
      if (!Array.isArray(data.episode_location_daily)) throw new Error('Expected episode_location_daily array');
      if (typeof data.unique_listeners !== 'number') throw new Error('Expected unique_listeners number');
      if (!Array.isArray(data.unique_listeners_by_episode)) {
        throw new Error('Expected unique_listeners_by_episode array');
      }
      if (!Array.isArray(data.retention_by_episode)) throw new Error('Expected retention_by_episode array');
      if (!data.methodology || typeof data.methodology.downloads !== 'string') {
        throw new Error('Expected methodology.downloads string');
      }
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
      if (typeof data.unique_listeners !== 'number') throw new Error('Expected unique_listeners');
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
      const today = todayLocal();
      const episodeRows = (data.episode_daily || []).filter((r) => r.episode_id === episode.id && r.stat_date === today);
      if (episodeRows.length === 0) throw new Error(`Expected episode_daily row for episode today, got ${JSON.stringify(data.episode_daily)}`);
      const row = episodeRows[0];
      if (row.source === undefined) throw new Error('episode_daily row missing source');
      const total = (row.human_count ?? 0) + (row.bot_count ?? 0);
      if (total < 1) throw new Error('Expected at least one raw fetch counted');
    })
  );

  results.push(
    await runOne('Full GET public episode audio counts as one Download after flush', async () => {
      const episodeUrl = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      await fetch(episodeUrl, { headers: { 'User-Agent': BROWSER_UA } });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const today = todayLocal();
      const downloadRows = (data.episode_listens_daily || []).filter((r) => r.episode_id === episode.id && r.stat_date === today);
      if (downloadRows.length === 0) throw new Error(`Expected episode_listens_daily (Downloads) row for episode today`);
      const totalDownloads = downloadRows.reduce((sum, r) => sum + (r.human_count ?? 0) + (r.bot_count ?? 0), 0);
      if (totalDownloads < 1) throw new Error('Expected at least one Download counted');
      if (typeof data.unique_listeners !== 'number' || data.unique_listeners < 1) {
        throw new Error(`Expected unique_listeners >= 1, got ${data.unique_listeners}`);
      }
      const byEp = (data.unique_listeners_by_episode || []).find((r) => r.episode_id === episode.id);
      if (!byEp || (byEp.unique_listeners ?? 0) < 1) {
        throw new Error('Expected unique_listeners_by_episode entry for episode');
      }
    })
  );

  results.push(
    await runOne('Same client GET episode twice in same day counts as one Download (dedup)', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayLocal();
      const beforeDownloads = sumRows(beforeData.episode_listens_daily, episode.id, today);
      const beforeUnique = beforeData.unique_listeners ?? 0;

      const episodeUrl = `${baseURL}/${podcast.id}/episodes/${episode.id}`;
      const headers = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' };
      await fetch(episodeUrl, { headers });
      await fetch(episodeUrl, { headers });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const afterDownloads = sumRows(data.episode_listens_daily, episode.id, today);
      const delta = afterDownloads - beforeDownloads;
      if (delta !== 1) throw new Error(`Expected dedup: 2 same-client GETs should add 1 Download, got delta ${delta}`);
      // Same client may or may not bump unique_listeners depending on prior GETs in this run.
      if ((data.unique_listeners ?? 0) < beforeUnique) {
        throw new Error('unique_listeners should not decrease');
      }
    })
  );

  results.push(
    await runOne('RSS with generic browser UA results in source Website', async () => {
      const rssUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`;
      await fetch(rssUrl, { headers: { 'User-Agent': BROWSER_UA } });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const sources = [...(data.rss_daily || []).map((r) => r.source)];
      if (!sources.includes('Website')) {
        throw new Error(`Expected Website in rss_daily sources, got ${sources.join(', ')}`);
      }
    })
  );

  results.push(
    await runOne('Audio GET with hf_src=web records Website source', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayLocal();
      const sumWebsite = (rows) =>
        (rows || [])
          .filter((r) => r.episode_id === episode.id && r.stat_date === today && r.source === 'Website')
          .reduce((s, r) => s + (r.human_count ?? 0) + (r.bot_count ?? 0), 0);
      const beforeWebsite = sumWebsite(beforeData.episode_listens_daily);

      const episodeUrl = `${baseURL}/${podcast.id}/episodes/${episode.id}.mp3?hf_src=web`;
      await fetch(episodeUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': `hf-src-web-${Date.now()}`,
        },
      });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const afterWebsite = sumWebsite(data.episode_listens_daily);
      if (afterWebsite < beforeWebsite + 1) {
        throw new Error(
          `Expected hf_src=web Download under Website (before ${beforeWebsite}, after ${afterWebsite})`
        );
      }
    })
  );

  results.push(
    await runOne('iTMS RSS maps source to Apple Podcasts and crawler bot_count', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayLocal();
      const sumAppleBot = (rows) =>
        (rows || [])
          .filter((r) => r.stat_date === today && r.source === 'Apple Podcasts')
          .reduce((s, r) => s + (r.bot_count ?? 0), 0);
      const beforeBot = sumAppleBot(beforeData.rss_daily);

      const rssUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`;
      await fetch(rssUrl, { headers: { 'User-Agent': 'iTMS' } });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const afterBot = sumAppleBot(data.rss_daily);
      if (afterBot < beforeBot + 1) {
        throw new Error(`Expected iTMS to increment Apple Podcasts bot_count (before ${beforeBot}, after ${afterBot})`);
      }
    })
  );

  results.push(
    await runOne('Tiny Range GET public episode audio does not count as raw fetch or Download', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayLocal();
      const beforeReq = sumRows(beforeData.episode_daily, episode.id, today);
      const beforeLis = sumRows(beforeData.episode_listens_daily, episode.id, today);

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
      const afterReq = sumRows(data.episode_daily, episode.id, today);
      const afterLis = sumRows(data.episode_listens_daily, episode.id, today);
      if (afterReq !== beforeReq) {
        throw new Error(`Expected tiny Range not to increment raw fetches (before ${beforeReq}, after ${afterReq})`);
      }
      if (afterLis !== beforeLis) {
        throw new Error(`Expected tiny Range not to increment Downloads (before ${beforeLis}, after ${afterLis})`);
      }
    })
  );

  results.push(
    await runOne('Spotify/1.0 RSS counts as crawler (bot_count); Overcast RSS as listener', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayLocal();
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

  results.push(
    await runOne('POST /public/analytics/retention records website retention reach', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const beforeEp = (beforeData.retention_by_episode || []).find((r) => r.episode_id === episode.id);
      const beforeClients0 = beforeEp?.buckets?.find((b) => b.bucket === 0)?.clients ?? 0;

      const res = await fetch(`${baseURL}/public/analytics/retention`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_UA,
          'Accept-Language': `retention-${Date.now()}`,
        },
        body: JSON.stringify({ episodeId: episode.id, percent: 40 }),
      });
      if (res.status !== 204) throw new Error(`Expected 204, got ${res.status}`);

      const afterRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (afterRes.status !== 200) throw new Error(`Expected 200, got ${afterRes.status}`);
      const data = await afterRes.json();
      const afterEp = (data.retention_by_episode || []).find((r) => r.episode_id === episode.id);
      if (!afterEp) throw new Error('Expected retention_by_episode entry for episode');
      const bucket0 = afterEp.buckets.find((b) => b.bucket === 0);
      const bucket40 = afterEp.buckets.find((b) => b.bucket === 40);
      if (!bucket0 || (bucket0.clients ?? 0) < beforeClients0 + 1) {
        throw new Error(`Expected retention bucket 0 clients to increase (before ${beforeClients0})`);
      }
      if (!bucket40 || (bucket40.clients ?? 0) < 1) {
        throw new Error('Expected retention bucket 40 to have at least one client');
      }
      if ((bucket40.pct ?? 0) <= 0) {
        throw new Error('Expected retention bucket 40 pct > 0');
      }
    })
  );

  results.push(
    await runOne('POST /public/analytics/retention rejects invalid body', async () => {
      const res = await fetch(`${baseURL}/public/analytics/retention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: '', percent: 200 }),
      });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    })
  );

  results.push(
    await runOne('ListenNotes RSS counts as crawler IVT', async () => {
      const beforeRes = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      const beforeData = await beforeRes.json();
      const today = todayLocal();
      const sumOtherBot = (rows) =>
        (rows || [])
          .filter((r) => r.stat_date === today && r.source === 'Other')
          .reduce((s, r) => s + (r.bot_count ?? 0), 0);
      const beforeBot = sumOtherBot(beforeData.rss_daily);

      const rssUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`;
      await fetch(rssUrl, {
        headers: { 'User-Agent': 'ListenNotes/3.0 (+https://www.listennotes.com/about/)' },
      });
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

      const res = await apiFetch(`/podcasts/${podcast.id}/analytics`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const afterBot = sumOtherBot(data.rss_daily);
      if (afterBot < beforeBot + 1) {
        throw new Error(`Expected ListenNotes to increment Other bot_count (before ${beforeBot}, after ${afterBot})`);
      }
    })
  );

  return results;
}
