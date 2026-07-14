/**
 * E2E: Linked/managed custom domains must not serve the app-host robots/sitemap.
 *
 * On a custom domain Host:
 * - /robots.txt Sitemap points at that domain's /api/sitemap.xml
 * - /api/sitemap.xml is a single-podcast urlset with / and /{episodeSlug} URLs
 * - no /feed/ paths, no unrelated podcasts, no hardcoded app.harborfm.com
 */
import {
  apiFetch,
  baseURL,
  loginAsAdmin,
  createShow,
  createEpisode,
  deleteSitemapCache,
} from '../../lib/helpers.js';

function rootOrigin() {
  return baseURL.replace(/\/api\/?$/, '');
}

async function fetchWithHost(path, host, opts = {}) {
  const origin = rootOrigin();
  const url = path.startsWith('http') ? path : `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = { ...(opts.headers || {}) };
  if (host) {
    headers['X-Forwarded-Host'] = host;
    headers['X-Forwarded-Proto'] = 'https';
  }
  return fetch(url, { ...opts, headers });
}

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const ts = Date.now();
  const linkHost = `e2e-seo-link-${ts}.test`;
  const slug = `e2e-seo-slug-${ts}`;
  const otherSlug = `e2e-seo-other-${ts}`;
  const episodeTitle = `E2E SEO Episode ${ts}`;
  let podcastId;
  let episodeSlug;

  results.push(
    await runOne('Enable linking domain and create show with linkDomain + published episode', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsAllowLinkingDomain: true }),
      }, jar);

      await createShow(jar, { title: 'E2E SEO Other Show', slug: otherSlug });

      const created = await createShow(jar, { title: 'E2E SEO Link Domain Show', slug });
      podcastId = created.id;

      const patch = await apiFetch(`/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkDomain: linkHost }),
      }, jar);
      if (patch.status !== 200) {
        throw new Error(`Expected 200 setting linkDomain, got ${patch.status} ${await patch.text()}`);
      }

      const ep = await createEpisode(jar, podcastId, {
        title: episodeTitle,
        status: 'draft',
      });
      episodeSlug = ep.slug;
      if (!episodeSlug) throw new Error('Expected episode slug');

      const pub = await apiFetch(`/episodes/${ep.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published', publishAt: null }),
      }, jar);
      if (pub.status !== 200) {
        throw new Error(`Expected 200 publishing episode, got ${pub.status} ${await pub.text()}`);
      }
    })
  );

  results.push(
    await runOne('Custom-domain robots.txt Sitemap points at that host (not app hostname)', async () => {
      const res = await fetchWithHost('/robots.txt', linkHost);
      if (res.status !== 200) throw new Error(`Expected 200 for robots.txt, got ${res.status}`);
      const text = await res.text();
      const expectedSitemap = `Sitemap: https://${linkHost}/api/sitemap.xml`;
      if (!text.includes(expectedSitemap)) {
        throw new Error(`Expected robots.txt to include "${expectedSitemap}", got:\n${text}`);
      }
      if (text.includes('app.harborfm.com')) {
        throw new Error('Custom-domain robots.txt must not mention app.harborfm.com');
      }
      if (text.includes('localhost:3099/api/sitemap.xml') && !text.includes(linkHost)) {
        throw new Error('Custom-domain robots.txt must not fall back to app hostname sitemap');
      }
    })
  );

  results.push(
    await runOne('Custom-domain /api/sitemap.xml is podcast-only with root + episode slug URLs', async () => {
      deleteSitemapCache();
      const res = await fetchWithHost('/api/sitemap.xml', linkHost);
      if (res.status !== 200) throw new Error(`Expected 200 for sitemap.xml, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<urlset')) {
        throw new Error(`Expected urlset (single-podcast sitemap), got:\n${text.slice(0, 400)}`);
      }
      if (text.includes('<sitemapindex')) {
        throw new Error('Custom-domain sitemap must not be the global sitemap index');
      }
      if (!text.includes(`<loc>https://${linkHost}/</loc>`)) {
        throw new Error(`Expected <loc>https://${linkHost}/</loc>, got:\n${text}`);
      }
      if (!text.includes(`<loc>https://${linkHost}/${encodeURIComponent(episodeSlug)}</loc>`)) {
        throw new Error(`Expected episode loc https://${linkHost}/${episodeSlug}, got:\n${text}`);
      }
      if (text.includes('/feed/')) {
        throw new Error('Custom-domain sitemap must not include /feed/ URLs');
      }
      if (text.includes(otherSlug) || text.includes(`sitemap/podcast/${otherSlug}`)) {
        throw new Error('Custom-domain sitemap must not include unrelated podcasts');
      }
    })
  );

  results.push(
    await runOne('App-host /api/sitemap.xml remains global index with /feed podcast entry', async () => {
      deleteSitemapCache();
      const res = await fetch(`${rootOrigin()}/api/sitemap.xml`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<sitemapindex') && !text.includes('sitemap/podcast/')) {
        throw new Error(`Expected global sitemap index, got:\n${text.slice(0, 400)}`);
      }
      if (!text.includes(`sitemap/podcast/${slug}.xml`)) {
        throw new Error(`Expected app-host sitemap to list podcast ${slug}`);
      }
    })
  );

  results.push(
    await runOne('Restore linking domain setting for other tests', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsAllowLinkingDomain: true }),
      }, jar);
    })
  );

  return results;
}
