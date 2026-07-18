/**
 * Subscriber-only start/end window:
 * - PATCH start >= end returns 400.
 * - Flag on + future start: public list/RSS/audio allow access.
 * - Flag on + past start / no end: public audio 404; private still works.
 * - Flag on + past end: public again.
 * - Flag on + both: gated only inside window.
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
  const slug = `e2e-so-win-${Date.now()}`;
  const podcast = await createShow(jar, {
    title: 'E2E Subscriber Only Window',
    slug,
    description: '',
  });

  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E SO Window Episode',
    status: 'draft',
  });
  const episodeSlug = episode.slug;
  await uploadEpisodeAudio(jar, episode.id, podcast.id, testDataMp3());
  await processEpisodeAudio(jar, episode.id);

  const publishAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  results.push(
    await runOne('PATCH subscriberOnlyStartsAt >= endsAt returns 400', async () => {
      const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const end = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const res = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'published',
            publishAt,
            subscriberOnly: 1,
            subscriberOnlyStartsAt: start,
            subscriberOnlyEndsAt: end,
          }),
        },
        jar,
      );
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('Flag on + future start: public list/RSS/audio allow access', async () => {
      const patchRes = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'published',
            publishAt,
            subscriberOnly: 1,
            subscriberOnlyStartsAt: futureStart,
            subscriberOnlyEndsAt: null,
          }),
        },
        jar,
      );
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);

      const listRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`,
      );
      if (listRes.status !== 200) throw new Error(`Expected 200 list, got ${listRes.status}`);
      const listData = await listRes.json();
      if (!listData.episodes?.some((e) => e.id === episode.id)) {
        throw new Error('Episode with future SO start should appear in public list');
      }

      const rssRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`,
      );
      if (rssRes.status !== 200) throw new Error(`Expected 200 RSS, got ${rssRes.status}`);
      const xml = await rssRes.text();
      if (!xml.includes(episode.id) && !xml.includes(episodeSlug)) {
        throw new Error('Episode with future SO start should appear in public RSS');
      }

      const audioRes = await fetch(`${baseURL}/${podcast.id}/episodes/${episode.id}`, {
        method: 'HEAD',
      });
      if (audioRes.status !== 200 && audioRes.status !== 206) {
        throw new Error(
          `Expected 200/206 public audio before SO start, got ${audioRes.status}`,
        );
      }
    }),
  );

  let tokenValue;
  results.push(
    await runOne(
      'Flag on + past start / no end: public audio 404; private still works',
      async () => {
        const patchRes = await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriberOnly: 1,
              subscriberOnlyStartsAt: pastStart,
              subscriberOnlyEndsAt: null,
            }),
          },
          jar,
        );
        if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);

        const listRes = await fetch(
          `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`,
        );
        const listData = await listRes.json();
        if (listData.episodes?.some((e) => e.id === episode.id)) {
          throw new Error('Currently gated SO episode should not appear in public list');
        }

        const audioRes = await fetch(`${baseURL}/${podcast.id}/episodes/${episode.id}`, {
          method: 'HEAD',
        });
        if (audioRes.status !== 404) {
          throw new Error(`Expected 404 public audio when gated, got ${audioRes.status}`);
        }

        const rssRes = await fetch(
          `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`,
        );
        const xml = await rssRes.text();
        if (xml.includes(`episodes/${episode.id}`) || xml.includes(`/${episodeSlug}<`)) {
          throw new Error('Currently gated SO episode should not appear in public RSS');
        }

        await apiFetch(
          `/podcasts/${podcast.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriberOnlyFeedEnabled: 1 }),
          },
          jar,
        );
        const createRes = await apiFetch(
          `/podcasts/${podcast.id}/subscriber-tokens`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'E2E SO Window Token' }),
          },
          jar,
        );
        if (createRes.status !== 201) {
          throw new Error(`Expected 201 creating token, got ${createRes.status}`);
        }
        const created = await createRes.json();
        tokenValue = created.token;

        const privateUrl = `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenValue)}/episodes/${episode.id}`;
        const privateAudio = await fetch(privateUrl, { method: 'HEAD' });
        if (privateAudio.status !== 200 && privateAudio.status !== 206) {
          throw new Error(
            `Expected 200/206 private audio when SO gated, got ${privateAudio.status}`,
          );
        }

        const privateRss = await fetch(
          `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(tokenValue)}/rss`,
        );
        if (privateRss.status !== 200) {
          throw new Error(`Expected 200 private RSS, got ${privateRss.status}`);
        }
        const privateXml = await privateRss.text();
        if (!privateXml.includes(`episodes/${episode.id}`)) {
          throw new Error('SO episode should appear in private RSS');
        }
      },
    ),
  );

  results.push(
    await runOne('Flag on + past end: public again', async () => {
      const patchRes = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriberOnly: 1,
            subscriberOnlyStartsAt: null,
            subscriberOnlyEndsAt: pastEnd,
          }),
        },
        jar,
      );
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);

      const listRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`,
      );
      const listData = await listRes.json();
      // With subscriber feed enabled, SO episodes can appear in the list; check effective flag + audio.
      const ep = listData.episodes?.find((e) => e.id === episode.id);
      if (ep && (ep.subscriber_only === 1 || ep.subscriber_only === true)) {
        throw new Error('After SO end, public DTO should not mark episode as subscriber_only');
      }

      const audioRes = await fetch(`${baseURL}/${podcast.id}/episodes/${episode.id}`, {
        method: 'HEAD',
      });
      if (audioRes.status !== 200 && audioRes.status !== 206) {
        throw new Error(`Expected 200/206 public audio after SO end, got ${audioRes.status}`);
      }

      const rssRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`,
      );
      const xml = await rssRes.text();
      if (!xml.includes(episode.id) && !xml.includes(episodeSlug)) {
        throw new Error('Episode after SO end should appear in public RSS');
      }
    }),
  );

  results.push(
    await runOne('Flag on + both: gated only inside window', async () => {
      const patchInside = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriberOnly: 1,
            subscriberOnlyStartsAt: pastStart,
            subscriberOnlyEndsAt: futureEnd,
          }),
        },
        jar,
      );
      if (patchInside.status !== 200) {
        throw new Error(`Expected 200 inside window, got ${patchInside.status}`);
      }

      const audioInside = await fetch(`${baseURL}/${podcast.id}/episodes/${episode.id}`, {
        method: 'HEAD',
      });
      if (audioInside.status !== 404) {
        throw new Error(
          `Expected 404 public audio inside SO window, got ${audioInside.status}`,
        );
      }

      const outsideEnd = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const patchBefore = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriberOnly: 1,
            subscriberOnlyStartsAt: futureStart,
            subscriberOnlyEndsAt: outsideEnd,
          }),
        },
        jar,
      );
      if (patchBefore.status !== 200) {
        throw new Error(`Expected 200 before window, got ${patchBefore.status}`);
      }

      const audioBefore = await fetch(`${baseURL}/${podcast.id}/episodes/${episode.id}`, {
        method: 'HEAD',
      });
      if (audioBefore.status !== 200 && audioBefore.status !== 206) {
        throw new Error(
          `Expected 200/206 public audio before SO window, got ${audioBefore.status}`,
        );
      }
    }),
  );

  return results;
}
