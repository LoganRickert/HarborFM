import { baseURL, apiFetch, loginAsAdmin, createShow } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const apiBase = baseURL.replace(/\/$/, '');
  const { jar } = await loginAsAdmin();
  const slug = `e2e-sitemap-cache-${Date.now()}`;
  await createShow(jar, { title: 'E2E Sitemap Cache Show', slug });

  results.push(
    await runOne('GET sitemap.xml populates cache', async () => {
      const res = await fetch(`${apiBase}/sitemap.xml`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<?xml') && !text.includes('<sitemapindex')) throw new Error('Expected sitemap XML');
      if (!text.includes(`sitemap/podcast/${slug}.xml`)) throw new Error('Expected podcast in sitemap');
    })
  );

  results.push(
    await runOne('DELETE /sitemap/cache (admin) returns 200 and ok: true', async () => {
      const res = await apiFetch('/sitemap/cache', {
        method: 'DELETE',
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.ok !== true) throw new Error(`Expected { ok: true }, got ${JSON.stringify(data)}`);
    })
  );

  results.push(
    await runOne('GET sitemap.xml after clear returns fresh sitemap', async () => {
      const res = await fetch(`${apiBase}/sitemap.xml`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<?xml') && !text.includes('<sitemapindex')) throw new Error('Expected sitemap XML');
      if (!text.includes(`sitemap/podcast/${slug}.xml`)) throw new Error('Expected podcast in regenerated sitemap');
    })
  );

  return results;
}
