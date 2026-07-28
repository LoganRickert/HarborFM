/**
 * Episode unlisted:
 * - Published + unlisted: absent from feed list, public RSS, sitemap; present by direct slug + audio.
 * - Scheduled + unlisted with showScheduledEpisodes on: absent from list; direct slug 200.
 * - Clearing unlisted restores list/RSS/sitemap.
 * - PATCH to draft clears unlisted.
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
  deleteSitemapCache,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-ep-unlisted-${Date.now()}`;
  const podcast = await createShow(jar, {
    title: 'E2E Episode Unlisted',
    slug,
    description: '',
  });

  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Unlisted Episode',
    status: 'draft',
  });
  const episodeSlug = episode.slug;
  await uploadEpisodeAudio(jar, episode.id, podcast.id, testDataMp3());
  await processEpisodeAudio(jar, episode.id);

  const publishAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  results.push(
    await runOne('PATCH published + unlisted: 1', async () => {
      const res = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'published',
            publishAt,
            unlisted: 1,
          }),
        },
        jar,
      );
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!(data.unlisted === true || data.unlisted === 1)) {
        throw new Error(`Expected unlisted true/1, got ${JSON.stringify(data.unlisted)}`);
      }
    }),
  );

  results.push(
    await runOne('Unlisted published absent from public episode list', async () => {
      const res = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`,
      );
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.episodes?.some((e) => e.id === episode.id);
      if (found) throw new Error('Unlisted episode must not appear in public list');
    }),
  );

  results.push(
    await runOne('Unlisted published reachable by slug with audio', async () => {
      const res = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episodeSlug)}`,
      );
      if (res.status !== 200) throw new Error(`Expected 200 for episode by slug, got ${res.status}`);
      const data = await res.json();
      if (!data.audio_url) {
        throw new Error('Expected audio_url for released unlisted published episode');
      }
      const audioRes = await fetch(`${baseURL}/${podcast.id}/episodes/${episode.id}`, {
        method: 'HEAD',
      });
      if (audioRes.status !== 200) {
        throw new Error(`Expected 200 for public audio HEAD, got ${audioRes.status}`);
      }
    }),
  );

  results.push(
    await runOne('Unlisted published absent from public RSS', async () => {
      const res = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`,
      );
      if (res.status !== 200) throw new Error(`Expected 200 for RSS, got ${res.status}`);
      const text = await res.text();
      if (text.includes(episodeSlug) || text.includes('E2E Unlisted Episode')) {
        throw new Error('Unlisted episode must not appear in public RSS');
      }
    }),
  );

  results.push(
    await runOne('Unlisted published absent from podcast sitemap', async () => {
      deleteSitemapCache();
      const res = await fetch(`${baseURL}/sitemap/podcast/${encodeURIComponent(slug)}.xml`);
      if (res.status !== 200) {
        throw new Error(`Expected 200 for podcast sitemap, got ${res.status}`);
      }
      const text = await res.text();
      if (text.includes(`/${encodeURIComponent(episodeSlug)}`) || text.includes(episodeSlug)) {
        throw new Error('Unlisted episode slug must not appear in podcast sitemap');
      }
      deleteSitemapCache();
    }),
  );

  const futurePublishAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const scheduled = await createEpisode(jar, podcast.id, {
    title: 'E2E Unlisted Scheduled',
    status: 'draft',
  });
  const scheduledSlug = scheduled.slug;

  results.push(
    await runOne('Scheduled + unlisted with showScheduled on: absent from list, slug OK', async () => {
      await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showScheduledEpisodes: 1 }),
        },
        jar,
      );
      const patchRes = await apiFetch(
        `/episodes/${scheduled.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'scheduled',
            publishAt: futurePublishAt,
            unlisted: 1,
          }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`Expected 200 patching scheduled unlisted, got ${patchRes.status}`);
      }
      const listRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`,
      );
      if (listRes.status !== 200) throw new Error(`Expected 200, got ${listRes.status}`);
      const list = await listRes.json();
      if (list.episodes?.some((e) => e.id === scheduled.id)) {
        throw new Error('Unlisted scheduled episode must not appear in list even with showScheduledEpisodes');
      }
      const slugRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(scheduledSlug)}`,
      );
      if (slugRes.status !== 200) {
        throw new Error(`Expected 200 for unlisted scheduled by slug, got ${slugRes.status}`);
      }
    }),
  );

  results.push(
    await runOne('Clear unlisted: published episode returns to list/RSS/sitemap', async () => {
      const patchRes = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unlisted: 0 }),
        },
        jar,
      );
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);

      const listRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes`,
      );
      if (listRes.status !== 200) throw new Error(`Expected 200, got ${listRes.status}`);
      const list = await listRes.json();
      if (!list.episodes?.some((e) => e.id === episode.id)) {
        throw new Error('Listed episode should appear in public list after clearing unlisted');
      }

      const rssRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/rss`,
      );
      if (rssRes.status !== 200) throw new Error(`Expected 200 for RSS, got ${rssRes.status}`);
      const rssText = await rssRes.text();
      if (!rssText.includes('E2E Unlisted Episode') && !rssText.includes(episodeSlug)) {
        throw new Error('Listed episode should appear in public RSS after clearing unlisted');
      }

      deleteSitemapCache();
      const smRes = await fetch(`${baseURL}/sitemap/podcast/${encodeURIComponent(slug)}.xml`);
      if (smRes.status !== 200) {
        throw new Error(`Expected 200 for podcast sitemap, got ${smRes.status}`);
      }
      const smText = await smRes.text();
      if (!smText.includes(episodeSlug)) {
        throw new Error('Listed episode should appear in podcast sitemap after clearing unlisted');
      }
      deleteSitemapCache();
    }),
  );

  results.push(
    await runOne('PATCH status draft clears unlisted', async () => {
      await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'published', unlisted: 1 }),
        },
        jar,
      );
      const draftRes = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'draft' }),
        },
        jar,
      );
      if (draftRes.status !== 200) throw new Error(`Expected 200, got ${draftRes.status}`);
      const data = await draftRes.json();
      if (data.unlisted === true || data.unlisted === 1) {
        throw new Error('Draft episode must have unlisted cleared');
      }
      const getRes = await apiFetch(`/episodes/${episode.id}`, {}, jar);
      if (getRes.status !== 200) throw new Error(`Expected 200 GET, got ${getRes.status}`);
      const got = await getRes.json();
      if (got.unlisted === true || got.unlisted === 1) {
        throw new Error('GET episode after draft must show unlisted false');
      }
    }),
  );

  return results;
}
