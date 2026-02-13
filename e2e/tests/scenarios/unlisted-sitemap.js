import { baseURL, apiFetch, loginAsAdmin, createShow, deleteSitemapCache } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const unlistedSlug = `e2e-unlisted-${Date.now()}`;
  const unlistedPodcast = await createShow(jar, { title: 'E2E Unlisted Sitemap Show', slug: unlistedSlug });

  results.push(
    await runOne('PATCH podcast unlisted: 1', async () => {
      const res = await apiFetch(`/podcasts/${unlistedPodcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlisted: 1 }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Unlisted podcast does not appear in sitemap.xml', async () => {
      deleteSitemapCache();
      const apiBase = baseURL.replace(/\/$/, '');
      const res = await fetch(`${apiBase}/sitemap.xml`);
      if (res.status !== 200) throw new Error(`Expected 200 for sitemap.xml, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<?xml') && !text.includes('<sitemapindex')) throw new Error('Expected sitemap index XML');
      const podcastSitemapEntry = `sitemap/podcast/${unlistedSlug}.xml`;
      if (text.includes(podcastSitemapEntry)) {
        throw new Error(`Unlisted podcast slug "${unlistedSlug}" must not appear in sitemap.xml (found: ${podcastSitemapEntry})`);
      }
      deleteSitemapCache();
    })
  );

  return results;
}
