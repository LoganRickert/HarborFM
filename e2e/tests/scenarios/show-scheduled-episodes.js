/**
 * Show Scheduled Episodes: podcast setting and public feed behavior.
 * - PATCH showScheduledEpisodes persists and GET public podcast returns it.
 * - Default off: future-dated episode not in public list.
 * - Toggle on: future-dated episode appears with scheduled_not_released and no audio.
 * - GET episode by slug, waveform/transcript/chapters 404, private audio 404.
 * - Toggle off again: future-dated episode no longer in list.
 */
import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-scheduled-${Date.now()}`;
  const podcast = await createShow(jar, { title: 'E2E Show Scheduled Episodes', slug, description: '' });
  const futurePublishAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const episode = await createEpisode(jar, podcast.id, { title: 'E2E Future Episode', status: 'draft' });
  const episodeSlug = episode.slug;

  results.push(
    await runOne('PATCH showScheduledEpisodes: 1 persists, GET public podcast returns show_scheduled_episodes', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showScheduledEpisodes: 1 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const val = data.show_scheduled_episodes;
      if (val !== 1 && val !== true) {
        throw new Error(`Expected show_scheduled_episodes 1 or true, got ${JSON.stringify(val)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH showScheduledEpisodes: 0 persists, GET public podcast returns 0', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showScheduledEpisodes: 0 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const val = data.show_scheduled_episodes;
      if (val !== 0 && val !== false) {
        throw new Error(`Expected show_scheduled_episodes 0 or false, got ${JSON.stringify(val)}`);
      }
    })
  );

  results.push(
    await runOne('Default off: future-dated episode not in public list', async () => {
      await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published', publishAt: futurePublishAt }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.episodes?.some((e) => e.id === episode.id);
      if (found) throw new Error('Episode with future publish_at should not appear when showScheduledEpisodes is off');
    })
  );

  results.push(
    await runOne('Toggle on: future-dated episode appears in list with scheduled_not_released and no audio', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showScheduledEpisodes: 1 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const ep = data.episodes?.find((e) => e.id === episode.id);
      if (!ep) throw new Error('Episode should appear in list when showScheduledEpisodes is on');
      const scheduledFlag = ep.scheduled_not_released === 1 || ep.scheduled_not_released === true;
      if (!scheduledFlag) throw new Error(`Expected scheduled_not_released 1 or true, got ${JSON.stringify(ep.scheduled_not_released)}`);
      if (ep.audio_url != null && ep.audio_url !== '') {
        throw new Error(`Expected audio_url null or empty for scheduled-not-released, got ${ep.audio_url}`);
      }
    })
  );

  results.push(
    await runOne('Toggle on: GET episode by slug returns 200 with scheduled_not_released and no audio_url', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episodeSlug)}`);
      if (res.status !== 200) throw new Error(`Expected 200 for episode by slug, got ${res.status}`);
      const data = await res.json();
      if (data.slug !== episodeSlug && data.id !== episode.id) throw new Error('Expected episode slug or id to match');
      const scheduledFlag = data.scheduled_not_released === 1 || data.scheduled_not_released === true;
      if (!scheduledFlag) throw new Error(`Expected scheduled_not_released 1 or true, got ${JSON.stringify(data.scheduled_not_released)}`);
      if (data.audio_url != null && data.audio_url !== '') {
        throw new Error(`Expected audio_url null or empty, got ${data.audio_url}`);
      }
      if (!Array.isArray(data.markers) || data.markers.length !== 0) {
        throw new Error(`Expected markers [], got ${JSON.stringify(data.markers)}`);
      }
    })
  );

  results.push(
    await runOne('Scheduled-not-released: public waveform returns 404', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episodeSlug)}/waveform`);
      if (res.status !== 404) throw new Error(`Expected 404 for waveform, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Scheduled-not-released: public transcript returns 404', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episodeSlug)}/transcript.srt`);
      if (res.status !== 404) throw new Error(`Expected 404 for transcript, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Scheduled-not-released: public chapters.json returns 404', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episodeSlug)}/chapters.json`);
      if (res.status !== 404) throw new Error(`Expected 404 for chapters, got ${res.status}`);
    })
  );

  let tokenValue;
  results.push(
    await runOne('Scheduled-not-released: private episode audio 404 even with valid token', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriberOnlyFeedEnabled: 1 }),
      }, jar);
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Scheduled Token' }),
      }, jar);
      if (createRes.status !== 201) throw new Error(`Expected 201 creating token, got ${createRes.status}`);
      const created = await createRes.json();
      tokenValue = created.token;

      const authRes = await fetch(`${baseURL}/public/subscriber-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenValue, podcastSlug: slug }),
      });
      if (authRes.status !== 200) throw new Error(`Expected 200 from subscriber-auth, got ${authRes.status}`);

      const url = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenValue)}/episodes/${episode.id}`;
      const audioRes = await fetch(url, { method: 'HEAD' });
      if (audioRes.status !== 404) {
        throw new Error(`Expected 404 for private episode audio when scheduled-not-released, got ${audioRes.status}`);
      }
    })
  );

  results.push(
    await runOne('Toggle off again: future-dated episode no longer in list', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showScheduledEpisodes: 0 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.episodes?.some((e) => e.id === episode.id);
      if (found) throw new Error('Episode should not appear in list after showScheduledEpisodes turned off');
    })
  );

  return results;
}
