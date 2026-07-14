/**
 * Page Customizations: feed accent + public feed visibility flags.
 * - Defaults on public GET: green accent, all visibility flags on.
 * - PATCH persists accent + toggles; public GET returns snake_case fields.
 * - Authenticated GET returns camelCase fields.
 * - Invalid feedAccent is rejected.
 */
import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
} from '../../lib/helpers.js';

function asBool(v) {
  return v === true || v === 1;
}

function assertPublicFlag(data, snakeKey, expected, camelKey) {
  const val = data[snakeKey] ?? data[camelKey];
  if (asBool(val) !== expected) {
    throw new Error(
      `Expected ${snakeKey} ${expected}, got ${JSON.stringify(val)} (keys present: ${Object.keys(data).filter((k) => k.includes('feed_') || k.includes('feed')).join(', ') || 'none'})`,
    );
  }
}

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-page-custom-${Date.now()}`;
  const podcast = await createShow(jar, {
    title: 'E2E Page Customizations',
    slug,
    description: 'Public description for customization tests',
  });

  results.push(
    await runOne('Public podcast defaults: green accent and visibility flags on', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const accent = data.feed_accent ?? data.feedAccent;
      if (accent !== 'green') {
        throw new Error(`Expected feed_accent green, got ${JSON.stringify(accent)}`);
      }
      assertPublicFlag(data, 'feed_show_podcast_description', true, 'feedShowPodcastDescription');
      assertPublicFlag(data, 'feed_show_episode_description', true, 'feedShowEpisodeDescription');
      assertPublicFlag(data, 'feed_show_funding', true, 'feedShowFunding');
      assertPublicFlag(data, 'feed_show_reviews_podcast', true, 'feedShowReviewsPodcast');
      assertPublicFlag(data, 'feed_show_reviews_episode', true, 'feedShowReviewsEpisode');
      assertPublicFlag(data, 'feed_show_author', true, 'feedShowAuthor');
      assertPublicFlag(data, 'feed_show_podroll', true, 'feedShowPodroll');
      assertPublicFlag(data, 'feed_show_cast', true, 'feedShowCast');
    }),
  );

  results.push(
    await runOne('PATCH feedAccent pink + all visibility off; public GET reflects values', async () => {
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedAccent: 'pink',
            feedShowPodcastDescription: 0,
            feedShowEpisodeDescription: 0,
            feedShowFunding: 0,
            feedShowReviewsPodcast: 0,
            feedShowReviewsEpisode: 0,
            feedShowAuthor: 0,
            feedShowPodroll: 0,
            feedShowCast: 0,
          }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}: ${await patchRes.text()}`);
      }

      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const accent = data.feed_accent ?? data.feedAccent;
      if (accent !== 'pink') {
        throw new Error(`Expected feed_accent pink, got ${JSON.stringify(accent)}`);
      }
      assertPublicFlag(data, 'feed_show_podcast_description', false, 'feedShowPodcastDescription');
      assertPublicFlag(data, 'feed_show_episode_description', false, 'feedShowEpisodeDescription');
      assertPublicFlag(data, 'feed_show_funding', false, 'feedShowFunding');
      assertPublicFlag(data, 'feed_show_reviews_podcast', false, 'feedShowReviewsPodcast');
      assertPublicFlag(data, 'feed_show_reviews_episode', false, 'feedShowReviewsEpisode');
      assertPublicFlag(data, 'feed_show_author', false, 'feedShowAuthor');
      assertPublicFlag(data, 'feed_show_podroll', false, 'feedShowPodroll');
      assertPublicFlag(data, 'feed_show_cast', false, 'feedShowCast');
    }),
  );

  results.push(
    await runOne('Authenticated GET podcast returns camelCase customization fields', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.feedAccent !== 'pink') {
        throw new Error(`Expected feedAccent pink, got ${JSON.stringify(data.feedAccent)}`);
      }
      if (asBool(data.feedShowAuthor)) {
        throw new Error(`Expected feedShowAuthor false, got ${JSON.stringify(data.feedShowAuthor)}`);
      }
      if (asBool(data.feedShowPodroll)) {
        throw new Error(`Expected feedShowPodroll false, got ${JSON.stringify(data.feedShowPodroll)}`);
      }
      if (asBool(data.feedShowCast)) {
        throw new Error(`Expected feedShowCast false, got ${JSON.stringify(data.feedShowCast)}`);
      }
      if (asBool(data.feedShowFunding)) {
        throw new Error(`Expected feedShowFunding false, got ${JSON.stringify(data.feedShowFunding)}`);
      }
    }),
  );

  results.push(
    await runOne('PATCH invalid feedAccent is rejected', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedAccent: 'not-a-color' }),
        },
        jar,
      );
      if (res.status < 400 || res.status >= 500) {
        throw new Error(`Expected 4xx for invalid feedAccent, got ${res.status}`);
      }
      const pub = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      const data = await pub.json();
      const accent = data.feed_accent ?? data.feedAccent;
      if (accent !== 'pink') {
        throw new Error(`Accent should remain pink after rejected PATCH, got ${JSON.stringify(accent)}`);
      }
    }),
  );

  results.push(
    await runOne('PATCH restores accent green and visibility flags on', async () => {
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedAccent: 'cyan',
            feedShowPodcastDescription: true,
            feedShowEpisodeDescription: true,
            feedShowFunding: true,
            feedShowReviewsPodcast: true,
            feedShowReviewsEpisode: true,
            feedShowAuthor: true,
            feedShowPodroll: true,
            feedShowCast: true,
          }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}: ${await patchRes.text()}`);
      }

      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const accent = data.feed_accent ?? data.feedAccent;
      if (accent !== 'cyan') {
        throw new Error(`Expected feed_accent cyan, got ${JSON.stringify(accent)}`);
      }
      assertPublicFlag(data, 'feed_show_author', true, 'feedShowAuthor');
      assertPublicFlag(data, 'feed_show_podroll', true, 'feedShowPodroll');
      assertPublicFlag(data, 'feed_show_cast', true, 'feedShowCast');
      assertPublicFlag(data, 'feed_show_funding', true, 'feedShowFunding');
    }),
  );

  return results;
}
