import { baseURL, loginAsAdmin, createShow, deleteSitemapCache } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const apiBase = baseURL.replace(/\/$/, '');

  results.push(
    await runOne('Listed podcast appears in sitemap.xml', async () => {
      deleteSitemapCache();
      const { jar } = await loginAsAdmin();
      const listedSlug = `e2e-listed-sitemap-${Date.now()}`;
      await createShow(jar, { title: 'E2E Listed Sitemap Show', slug: listedSlug });
      const res = await fetch(`${apiBase}/sitemap.xml`);
      if (res.status !== 200) throw new Error(`Expected 200 for sitemap.xml, got ${res.status}`);
      const text = await res.text();
      const podcastSitemapEntry = `sitemap/podcast/${listedSlug}.xml`;
      if (!text.includes(podcastSitemapEntry)) {
        throw new Error(`Listed podcast slug "${listedSlug}" must appear in sitemap.xml (expected: ${podcastSitemapEntry})`);
      }
      deleteSitemapCache();
    })
  );

  results.push(
    await runOne('GET /sitemap.xml returns 200', async () => {
      const res = await fetch(`${apiBase}/sitemap.xml`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<?xml') && !text.includes('<sitemapindex')) throw new Error('Expected sitemap XML');
      deleteSitemapCache();
    })
  );

  return results;
}
