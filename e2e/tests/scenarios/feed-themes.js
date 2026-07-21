/**
 * Page themes: feed_theme defaults, Fluid/Folio render, zip import, editor APIs,
 * scope promote/demote, rate limit, harborfm mounts, canImportTheme gates, sitemap pages.
 */
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
  createUser,
  createEpisode,
  login,
  cookieJar,
  deleteSitemapCache,
} from '../../lib/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = join(__dirname, '../..');
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');
const require = createRequire(join(E2E_DIR, '../server/package.json'));
const AdmZip = require('adm-zip');

/** Match e2e start-server.sh THEME_IMPORT_RATE_LIMIT_WINDOW_MS (default 1000) with slack. */
const THEME_IMPORT_SLOT_MS = 1200;
const THEME_IMPORT_MAX = 2;
const themeImportTimestamps = [];

function buildThemeZip({
  id,
  name,
  version,
  podcastBody,
  episodeBody,
  css,
  injectScript,
  index,
  not_found,
  pages,
  extraTemplates,
}) {
  const zip = new AdmZip();
  const manifest = { id, name, version };
  if (index) manifest.index = index;
  if (not_found) manifest.not_found = not_found;
  if (pages) manifest.pages = pages;
  zip.addFile('theme.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
  let podcast = podcastBody ?? `<div class="t">{{ podcast.title }}{% render 'harborfm/episodes' %}</div>`;
  let episode = episodeBody ?? `<div class="t">{{ episode.title }}{% render 'harborfm/player' %}</div>`;
  if (injectScript) {
    podcast = `<script>alert(1)</script>${podcast}`;
  }
  zip.addFile('templates/podcast.liquid', Buffer.from(podcast, 'utf8'));
  zip.addFile('templates/episode.liquid', Buffer.from(episode, 'utf8'));
  for (const [basename, body] of Object.entries(extraTemplates || {})) {
    zip.addFile(
      `templates/${basename}.liquid`,
      Buffer.from(body, 'utf8'),
    );
  }
  zip.addFile('css/style.css', Buffer.from(css ?? 'body{margin:0}', 'utf8'));
  return zip.toBuffer();
}

async function waitForThemeImportSlot() {
  const now = Date.now();
  while (themeImportTimestamps.length > 0 && now - themeImportTimestamps[0] >= THEME_IMPORT_SLOT_MS) {
    themeImportTimestamps.shift();
  }
  if (themeImportTimestamps.length >= THEME_IMPORT_MAX) {
    const waitMs = THEME_IMPORT_SLOT_MS - (now - themeImportTimestamps[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 50)));
    const after = Date.now();
    while (themeImportTimestamps.length > 0 && after - themeImportTimestamps[0] >= THEME_IMPORT_SLOT_MS) {
      themeImportTimestamps.shift();
    }
  }
}

/**
 * @param {ReturnType<typeof cookieJar>} jar
 * @param {Buffer} zipBuffer
 * @param {string} [filename]
 * @param {{ burst?: boolean }} [opts] burst skips client-side pacing (for 429 tests)
 */
async function importThemeZip(jar, zipBuffer, filename = 'theme.zip', opts = {}) {
  if (!opts.burst) await waitForThemeImportSlot();
  const formData = new FormData();
  formData.append('file', new Blob([zipBuffer], { type: 'application/zip' }), filename);
  const headers = jar ? jar.apply({}) : {};
  delete headers['Content-Type'];
  const csrf = jar?.get()?.['harborfm_csrf'];
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(`${baseURL}/themes/import`, {
    method: 'POST',
    headers,
    body: formData,
  });
  themeImportTimestamps.push(Date.now());
  return res;
}

async function uploadThemeFile(jar, themeId, path, bytes, filename = 'asset.png') {
  const formData = new FormData();
  formData.append('path', path);
  formData.append('file', new Blob([bytes], { type: 'application/octet-stream' }), filename);
  const headers = jar.apply({});
  delete headers['Content-Type'];
  const csrf = jar.get()?.['harborfm_csrf'];
  if (csrf) headers['x-csrf-token'] = csrf;
  return fetch(
    `${baseURL}/themes/${encodeURIComponent(themeId)}/files?path=${encodeURIComponent(path)}`,
    { method: 'POST', headers, body: formData },
  );
}

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-theme-${Date.now()}`;
  const podcast = await createShow(jar, {
    title: 'E2E Feed Themes',
    slug,
    description: 'Theme test show',
  });
  const themesToDelete = [];

  results.push(
    await runOne('Public podcast defaults feed_theme to default', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const theme = data.feed_theme ?? data.feedTheme;
      if (theme !== 'default') {
        throw new Error(`Expected feed_theme default, got ${JSON.stringify(theme)}`);
      }
    }),
  );

  results.push(
    await runOne('PATCH feedTheme fluid; theme-render returns HTML', async () => {
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: 'fluid' }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}: ${await patchRes.text()}`);
      }
      const pub = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      const pdata = await pub.json();
      if ((pdata.feed_theme ?? pdata.feedTheme) !== 'fluid') {
        throw new Error(`Expected feed_theme fluid, got ${JSON.stringify(pdata.feed_theme)}`);
      }
      const render = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render`,
      );
      if (render.status !== 200) {
        throw new Error(`theme-render expected 200, got ${render.status}: ${await render.text()}`);
      }
      const body = await render.json();
      if (typeof body.html !== 'string' || !body.html.includes('data-harborfm-block')) {
        throw new Error('theme-render HTML missing harborfm mount points');
      }
      if (!Array.isArray(body.cssHrefs) || body.cssHrefs.length === 0) {
        throw new Error('Expected Fluid cssHrefs');
      }
    }),
  );

  results.push(
    await runOne('PATCH feedTheme folio; index + pages render', async () => {
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: 'folio' }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}: ${await patchRes.text()}`);
      }
      const home = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render`,
      );
      if (home.status !== 200) {
        throw new Error(`folio home expected 200, got ${home.status}`);
      }
      const homeBody = await home.json();
      if (homeBody.indexTemplate !== 'home') {
        throw new Error(`Expected folio indexTemplate home, got ${homeBody.indexTemplate}`);
      }
      if (!String(homeBody.html).includes('Explore') || !String(homeBody.html).includes('folio-theme')) {
        throw new Error('Folio home HTML missing expected content');
      }
      if (!Array.isArray(homeBody.cssHrefs) || !homeBody.cssHrefs.some((h) => String(h).includes('folio.css'))) {
        throw new Error('Expected Folio cssHrefs');
      }

      for (const pageFile of ['about.html', 'crew.html', 'support.html', 'connect.html', 'episodes.html']) {
        const pageRes = await fetch(
          `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render/pages/${pageFile}`,
        );
        if (pageRes.status !== 200) {
          throw new Error(`folio ${pageFile} expected 200, got ${pageRes.status}`);
        }
        const pageBody = await pageRes.json();
        if (typeof pageBody.html !== 'string' || pageBody.html.length < 20) {
          throw new Error(`folio ${pageFile} returned empty html`);
        }
      }
    }),
  );

  results.push(
    await runOne('Folio theme pages appear in podcast sitemap', async () => {
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: 'folio' }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}: ${await patchRes.text()}`);
      }
      deleteSitemapCache();
      const childRes = await fetch(`${baseURL}/sitemap/podcast/${encodeURIComponent(slug)}.xml`);
      if (childRes.status !== 200) {
        throw new Error(`Expected 200 for child podcast sitemap, got ${childRes.status}`);
      }
      const text = await childRes.text();
      for (const pageFile of ['about.html', 'crew.html', 'support.html', 'connect.html', 'episodes.html']) {
        const needle = `/feed/${slug}/${pageFile}`;
        if (!text.includes(needle)) {
          throw new Error(`Podcast sitemap missing theme page ${needle}`);
        }
      }
      deleteSitemapCache();
    }),
  );

  results.push(
    await runOne('PATCH invalid feedTheme is rejected', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: 'not-a-real-theme-id' }),
        },
        jar,
      );
      if (res.status < 400 || res.status >= 500) {
        throw new Error(`Expected 4xx for invalid feedTheme, got ${res.status}`);
      }
    }),
  );

  let importedThemeId = null;
  results.push(
    await runOne('Import theme zip creates theme; upsert updates version', async () => {
      const zip1 = buildThemeZip({
        id: 'e2e-cool',
        name: 'E2E Cool',
        version: '1.0.0',
      });
      const res1 = await importThemeZip(jar, zip1);
      if (res1.status !== 201 && res1.status !== 200) {
        throw new Error(`Import expected 201/200, got ${res1.status}: ${await res1.text()}`);
      }
      const created = await res1.json();
      importedThemeId = created.id;
      themesToDelete.push(created.id);
      if (created.packageId !== 'e2e-cool' || created.version !== '1.0.0') {
        throw new Error(`Unexpected create payload: ${JSON.stringify(created)}`);
      }

      const zip2 = buildThemeZip({
        id: 'e2e-cool',
        name: 'E2E Cool',
        version: '1.1.0',
      });
      const res2 = await importThemeZip(jar, zip2);
      if (res2.status !== 200) {
        throw new Error(`Upsert expected 200, got ${res2.status}: ${await res2.text()}`);
      }
      const updated = await res2.json();
      if (updated.id !== importedThemeId || updated.version !== '1.1.0') {
        throw new Error(`Expected same id and version 1.1.0, got ${JSON.stringify(updated)}`);
      }

      const list = await apiFetch('/themes', {}, jar);
      const listBody = await list.json();
      const match = (listBody.themes || []).find((t) => t.id === importedThemeId);
      if (!match || match.version !== '1.1.0') {
        throw new Error('Theme list missing upserted theme');
      }
    }),
  );

  results.push(
    await runOne('Select custom theme on owned podcast; theme-render works', async () => {
      if (!importedThemeId) throw new Error('No imported theme');
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: importedThemeId }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}: ${await patchRes.text()}`);
      }
      const render = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render`,
      );
      if (render.status !== 200) {
        throw new Error(`theme-render expected 200, got ${render.status}`);
      }
      const body = await render.json();
      if (!String(body.html).includes('E2E Feed Themes')) {
        throw new Error('Rendered HTML should include podcast title');
      }
    }),
  );

  let pagesThemeId = null;
  results.push(
    await runOne('Import theme with index + pages; home and page render', async () => {
      const zip = buildThemeZip({
        id: 'e2e-pages',
        name: 'E2E Pages',
        version: '1.0.0',
        index: 'home',
        not_found: 'not_found',
        pages: { about: 'about-us.html' },
        podcastBody: `<div class="podcast-tpl">podcast-index</div>`,
        extraTemplates: {
          home: `<div class="home-tpl">HOME-{{ podcast.title }} <a href="{{ urls.pages.about }}">About</a></div>`,
          about: `<div class="about-tpl">ABOUT-{{ podcast.title }} link={{ urls.pages.about }}</div>`,
          not_found: `<div class="nf-tpl">NOT-FOUND-{{ podcast.title }} <a href="{{ urls.home }}">Home</a></div>`,
        },
      });
      const res = await importThemeZip(jar, zip);
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`Import expected 201/200, got ${res.status}: ${await res.text()}`);
      }
      const created = await res.json();
      pagesThemeId = created.id;
      themesToDelete.push(created.id);

      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: pagesThemeId }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}: ${await patchRes.text()}`);
      }

      const homeRender = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render`,
      );
      if (homeRender.status !== 200) {
        throw new Error(`home theme-render expected 200, got ${homeRender.status}`);
      }
      const homeBody = await homeRender.json();
      if (!String(homeBody.html).includes('HOME-E2E Feed Themes')) {
        throw new Error('Home should render index template (home.liquid)');
      }
      if (String(homeBody.html).includes('podcast-index')) {
        throw new Error('Home should not use podcast.liquid when index is home');
      }
      if (homeBody.indexTemplate !== 'home') {
        throw new Error(`Expected indexTemplate home, got ${homeBody.indexTemplate}`);
      }
      if (!String(homeBody.html).includes('/feed/') || !String(homeBody.html).includes('about-us.html')) {
        throw new Error('Home should include urls.pages.about path');
      }

      const pageRender = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render/pages/about-us.html`,
      );
      if (pageRender.status !== 200) {
        throw new Error(`page theme-render expected 200, got ${pageRender.status}`);
      }
      const pageBody = await pageRender.json();
      if (!String(pageBody.html).includes('ABOUT-E2E Feed Themes')) {
        throw new Error('About page should render about.liquid');
      }
      if (pageBody.page !== 'about-us.html' || pageBody.template !== 'about') {
        throw new Error(`Unexpected page payload: ${JSON.stringify(pageBody)}`);
      }

      const missing = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render/pages/nope.html`,
      );
      if (missing.status !== 404) {
        throw new Error(`Expected 404 for unknown page, got ${missing.status}`);
      }
      const missingBody = await missing.json();
      if (!missingBody.notFound || !String(missingBody.html).includes('NOT-FOUND-E2E Feed Themes')) {
        throw new Error(`Expected themed not_found HTML on 404, got ${JSON.stringify(missingBody)}`);
      }
      if (missingBody.template !== 'not_found') {
        throw new Error(`Expected template not_found, got ${missingBody.template}`);
      }

      // not_found must not be published as a public .html page
      const nfAsPage = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render/pages/not_found.html`,
      );
      if (nfAsPage.status !== 404) {
        throw new Error(`not_found.html should not be a public page, got ${nfAsPage.status}`);
      }
      const nfAsPageBody = await nfAsPage.json();
      if (!nfAsPageBody.notFound) {
        throw new Error('Requesting not_found.html should still use the themed 404 handler');
      }
    }),
  );

  results.push(
    await runOne('Theme file CRUD: create, write, upload, delete optional file', async () => {
      const packageId = `e2e-crud-${Date.now()}`;
      const zip = buildThemeZip({
        id: packageId,
        name: 'E2E CRUD',
        version: '1.0.0',
      });
      const importRes = await importThemeZip(jar, zip);
      if (importRes.status !== 201 && importRes.status !== 200) {
        throw new Error(`Import expected 201/200, got ${importRes.status}: ${await importRes.text()}`);
      }
      const created = await importRes.json();
      const themeId = created.id;
      themesToDelete.push(themeId);

      const createRes = await apiFetch(
        `/themes/${themeId}/files/new`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'templates/extra.liquid' }),
        },
        jar,
      );
      if (createRes.status !== 200) {
        throw new Error(`Create file expected 200, got ${createRes.status}: ${await createRes.text()}`);
      }

      const putRes = await apiFetch(
        `/themes/${themeId}/files/templates/extra.liquid`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '<div class="extra">extra-{{ podcast.title }}</div>' }),
        },
        jar,
      );
      if (putRes.status !== 200) {
        throw new Error(`PUT file expected 200, got ${putRes.status}: ${await putRes.text()}`);
      }

      const getRes = await apiFetch(`/themes/${themeId}/files/templates/extra.liquid`, {}, jar);
      if (getRes.status !== 200) {
        throw new Error(`GET file expected 200, got ${getRes.status}`);
      }
      const text = await getRes.text();
      if (!text.includes('extra-{{ podcast.title }}')) {
        throw new Error(`Unexpected file content: ${text}`);
      }

      // Minimal valid 1x1 PNG
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const uploadRes = await uploadThemeFile(jar, themeId, 'images/dot.png', png, 'dot.png');
      if (uploadRes.status !== 200) {
        throw new Error(`Upload expected 200, got ${uploadRes.status}: ${await uploadRes.text()}`);
      }

      const delOpt = await apiFetch(
        `/themes/${themeId}/files/templates/extra.liquid`,
        { method: 'DELETE' },
        jar,
      );
      if (delOpt.status !== 200) {
        throw new Error(`DELETE optional expected 200, got ${delOpt.status}: ${await delOpt.text()}`);
      }

      const delRequired = await apiFetch(
        `/themes/${themeId}/files/theme.json`,
        { method: 'DELETE' },
        jar,
      );
      if (delRequired.status !== 400) {
        throw new Error(`DELETE required expected 400, got ${delRequired.status}: ${await delRequired.text()}`);
      }

      const delPodcastTpl = await apiFetch(
        `/themes/${themeId}/files/templates/podcast.liquid`,
        { method: 'DELETE' },
        jar,
      );
      if (delPodcastTpl.status !== 400) {
        throw new Error(
          `DELETE podcast.liquid expected 400, got ${delPodcastTpl.status}: ${await delPodcastTpl.text()}`,
        );
      }
    }),
  );

  results.push(
    await runOne('Admin promote user theme to server; demote back', async () => {
      const packageId = `e2e-promo-${Date.now()}`;
      const zip = buildThemeZip({
        id: packageId,
        name: 'E2E Promo',
        version: '1.0.0',
      });
      const importRes = await importThemeZip(jar, zip);
      if (importRes.status !== 201 && importRes.status !== 200) {
        throw new Error(`Import expected 201/200, got ${importRes.status}: ${await importRes.text()}`);
      }
      const created = await importRes.json();
      const userThemeId = created.id;

      const email = `e2e-scope-${Date.now()}@e2e.test`;
      const { password } = await createUser({ email });
      const userJar = cookieJar();
      await login(email, password, userJar);
      const nonAdmin = await apiFetch(
        `/themes/${userThemeId}/scope`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'server' }),
        },
        userJar,
      );
      if (nonAdmin.status !== 403) {
        throw new Error(`Non-admin scope expected 403, got ${nonAdmin.status}: ${await nonAdmin.text()}`);
      }

      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: userThemeId }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}`);
      }

      const promote = await apiFetch(
        `/themes/${userThemeId}/scope`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'server' }),
        },
        jar,
      );
      if (promote.status !== 200) {
        throw new Error(`Promote expected 200, got ${promote.status}: ${await promote.text()}`);
      }
      const promoted = await promote.json();
      if (promoted.id !== packageId || promoted.scope !== 'server') {
        throw new Error(`Unexpected promote payload: ${JSON.stringify(promoted)}`);
      }

      const serverThemePath = join(DATA_DIR, 'themes', 'server', packageId, 'theme.json');
      if (!existsSync(serverThemePath)) {
        throw new Error(`Expected promoted theme under data dir: ${serverThemePath}`);
      }
      const promotedManifest = JSON.parse(readFileSync(serverThemePath, 'utf8'));
      if (promotedManifest.allowOverride !== false) {
        throw new Error(
          `Promoted server theme.json should set allowOverride: false, got ${JSON.stringify(promotedManifest.allowOverride)}`,
        );
      }
      const shippedLeak = join(E2E_DIR, '../server/themes', packageId, 'theme.json');
      if (existsSync(shippedLeak)) {
        throw new Error(`Promoted theme must not write into image seed path: ${shippedLeak}`);
      }

      // Promote clears podcasts that used the old user theme id
      const afterPromote = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      const afterPromoteData = await afterPromote.json();
      if ((afterPromoteData.feed_theme ?? afterPromoteData.feedTheme) !== 'default') {
        throw new Error('Expected feed_theme default after promote cleared old id');
      }

      const selectServer = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: packageId }),
        },
        jar,
      );
      if (selectServer.status !== 200) {
        throw new Error(`Select server theme expected 200, got ${selectServer.status}`);
      }

      const demote = await apiFetch(
        `/themes/${packageId}/scope`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'user' }),
        },
        jar,
      );
      if (demote.status !== 200) {
        throw new Error(`Demote expected 200, got ${demote.status}: ${await demote.text()}`);
      }
      const demoted = await demote.json();
      if (demoted.scope !== 'user' || !demoted.id || demoted.id === packageId) {
        throw new Error(`Unexpected demote payload: ${JSON.stringify(demoted)}`);
      }
      themesToDelete.push(demoted.id);

      const afterDemote = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      const afterDemoteData = await afterDemote.json();
      if ((afterDemoteData.feed_theme ?? afterDemoteData.feedTheme) !== 'default') {
        throw new Error('Expected feed_theme default after demote cleared server theme');
      }
    }),
  );

  results.push(
    await runOne('Third theme import within a minute returns 429', async () => {
      // Drain the shared admin slot so this burst is isolated.
      await waitForThemeImportSlot();
      await new Promise((r) => setTimeout(r, THEME_IMPORT_SLOT_MS));
      themeImportTimestamps.length = 0;

      const stamp = Date.now();
      const first = await importThemeZip(
        jar,
        buildThemeZip({ id: `e2e-rl-a-${stamp}`, name: 'RL A', version: '1.0.0' }),
        'a.zip',
        { burst: true },
      );
      if (first.status !== 201 && first.status !== 200) {
        throw new Error(`First import expected 201/200, got ${first.status}: ${await first.text()}`);
      }
      const firstBody = await first.json();
      themesToDelete.push(firstBody.id);

      const second = await importThemeZip(
        jar,
        buildThemeZip({ id: `e2e-rl-b-${stamp}`, name: 'RL B', version: '1.0.0' }),
        'b.zip',
        { burst: true },
      );
      if (second.status !== 201 && second.status !== 200) {
        throw new Error(`Second import expected 201/200, got ${second.status}: ${await second.text()}`);
      }
      const secondBody = await second.json();
      themesToDelete.push(secondBody.id);

      const third = await importThemeZip(
        jar,
        buildThemeZip({ id: `e2e-rl-c-${stamp}`, name: 'RL C', version: '1.0.0' }),
        'c.zip',
        { burst: true },
      );
      if (third.status !== 429) {
        throw new Error(`Third import expected 429, got ${third.status}: ${await third.text()}`);
      }
    }),
  );

  results.push(
    await runOne('harborfm/ render mounts produce data-harborfm-block', async () => {
      const packageId = `e2e-hfm-${Date.now()}`;
      const zip = buildThemeZip({
        id: packageId,
        name: 'E2E HarborFM Mounts',
        version: '1.0.0',
        podcastBody: `<div class="hfm">{{ podcast.title }}{% render 'harborfm/episodes' %}{% render 'harborfm/player' %}{% render 'harborfm/cast' %}{% render 'harborfm/search' %}</div>`,
        episodeBody: `<div class="hfm-ep">{{ episode.title }}{% render 'harborfm/player' %}</div>`,
      });
      const res = await importThemeZip(jar, zip);
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`Import expected 201/200, got ${res.status}: ${await res.text()}`);
      }
      const created = await res.json();
      themesToDelete.push(created.id);

      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: created.id }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}`);
      }

      const render = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/theme-render`,
      );
      if (render.status !== 200) {
        throw new Error(`theme-render expected 200, got ${render.status}`);
      }
      const body = await render.json();
      const html = String(body.html);
      for (const block of ['episodes', 'player', 'cast', 'search']) {
        if (!html.includes(`data-harborfm-block="${block}"`)) {
          throw new Error(`Missing data-harborfm-block for ${block}`);
        }
      }
    }),
  );

  results.push(
    await runOne('canImportTheme false blocks theme file and download APIs', async () => {
      await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultCanImportTheme: true,
            registrationEnabled: true,
          }),
        },
        jar,
      );
      const email = `e2e-gate-theme-${Date.now()}@e2e.test`;
      const { password } = await createUser({ email });
      const userJar = cookieJar();
      await login(email, password, userJar);

      const zip = buildThemeZip({
        id: `e2e-gate-${Date.now()}`,
        name: 'Gate Theme',
        version: '1.0.0',
      });
      const importRes = await importThemeZip(userJar, zip);
      if (importRes.status !== 201 && importRes.status !== 200) {
        throw new Error(`Import expected 201/200, got ${importRes.status}: ${await importRes.text()}`);
      }
      const created = await importRes.json();
      const themeId = created.id;

      const listRes = await apiFetch('/users?limit=200', {}, jar);
      const list = await listRes.json();
      const u = (list.users || []).find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      const patchUser = await apiFetch(
        `/users/${u.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canImportTheme: false }),
        },
        jar,
      );
      if (patchUser.status !== 200) {
        throw new Error(`Expected 200 PATCH user, got ${patchUser.status}`);
      }

      const detail = await apiFetch(`/themes/${themeId}`, {}, userJar);
      if (detail.status !== 403) {
        throw new Error(`Detail expected 403, got ${detail.status}: ${await detail.text()}`);
      }

      const fileGet = await apiFetch(`/themes/${themeId}/files/theme.json`, {}, userJar);
      if (fileGet.status !== 403) {
        throw new Error(`GET file expected 403, got ${fileGet.status}`);
      }

      const filePut = await apiFetch(
        `/themes/${themeId}/files/css/style.css`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'body{color:red}' }),
        },
        userJar,
      );
      if (filePut.status !== 403) {
        throw new Error(`PUT file expected 403, got ${filePut.status}`);
      }

      const download = await apiFetch(`/themes/${themeId}/download`, {}, userJar);
      if (download.status !== 403) {
        throw new Error(`Theme download expected 403, got ${download.status}`);
      }

      const builtinDl = await apiFetch('/themes/builtins/fluid/download', {}, userJar);
      if (builtinDl.status !== 403) {
        throw new Error(`Builtin download expected 403, got ${builtinDl.status}`);
      }

      // Cleanup: admin cannot delete another user's theme via /themes/:id as owner path;
      // re-enable import and delete as the user.
      await apiFetch(
        `/users/${u.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canImportTheme: true }),
        },
        jar,
      );
      await apiFetch(`/themes/${themeId}`, { method: 'DELETE' }, userJar);
    }),
  );

  results.push(
    await runOne('Episode theme-render returns HTML for liquid theme', async () => {
      const episode = await createEpisode(jar, podcast.id, {
        title: 'E2E Theme Episode',
        status: 'draft',
      });
      const pubEp = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'published', publishAt: null }),
        },
        jar,
      );
      if (pubEp.status !== 200) {
        throw new Error(`Publish expected 200, got ${pubEp.status}: ${await pubEp.text()}`);
      }
      const epSlug = episode.slug;
      if (!epSlug) throw new Error('Episode missing slug');

      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedTheme: 'fluid' }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH expected 200, got ${patchRes.status}`);
      }

      const render = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(epSlug)}/theme-render`,
      );
      if (render.status !== 200) {
        throw new Error(`episode theme-render expected 200, got ${render.status}: ${await render.text()}`);
      }
      const body = await render.json();
      if (typeof body.html !== 'string' || body.html.length < 20) {
        throw new Error('episode theme-render returned empty html');
      }
      if (!String(body.html).includes('E2E Theme Episode') && !String(body.html).includes('data-harborfm-block')) {
        throw new Error('episode theme-render HTML missing expected content');
      }
    }),
  );

  results.push(
    await runOne('Reject theme zip with missing index target', async () => {
      const zip = buildThemeZip({
        id: 'e2e-bad-index',
        name: 'Bad Index',
        version: '1.0.0',
        index: 'missing-home',
      });
      const res = await importThemeZip(jar, zip);
      if (res.status < 400 || res.status >= 500) {
        throw new Error(`Expected 4xx for missing index, got ${res.status}`);
      }
    }),
  );

  results.push(
    await runOne('Reject theme zip with invalid pages override', async () => {
      const zip = buildThemeZip({
        id: 'e2e-bad-pages',
        name: 'Bad Pages',
        version: '1.0.0',
        pages: { about: 'About.HTML' },
        extraTemplates: {
          about: `<div>about</div>`,
        },
      });
      const res = await importThemeZip(jar, zip);
      if (res.status < 400 || res.status >= 500) {
        throw new Error(`Expected 4xx for invalid page path, got ${res.status}`);
      }
    }),
  );

  results.push(
    await runOne('Reject theme zip containing script tags', async () => {
      const zip = buildThemeZip({
        id: 'e2e-evil',
        name: 'Evil',
        version: '1.0.0',
        injectScript: true,
      });
      const res = await importThemeZip(jar, zip);
      if (res.status < 400 || res.status >= 500) {
        throw new Error(`Expected 4xx for scripted theme, got ${res.status}`);
      }
    }),
  );

  results.push(
    await runOne('User without canImportTheme gets 403 on import', async () => {
      await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultCanImportTheme: true,
            registrationEnabled: true,
          }),
        },
        jar,
      );
      const email = `e2e-no-theme-${Date.now()}@e2e.test`;
      const { password } = await createUser({ email });
      const userJar = cookieJar();
      await login(email, password, userJar);

      const listRes = await apiFetch('/users?limit=200', {}, jar);
      const list = await listRes.json();
      const u = (list.users || []).find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      const patchRes = await apiFetch(
        `/users/${u.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canImportTheme: false }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`Expected 200 PATCH user, got ${patchRes.status}`);
      }

      const zip = buildThemeZip({
        id: 'e2e-denied',
        name: 'Denied',
        version: '1.0.0',
      });
      const res = await importThemeZip(userJar, zip);
      if (res.status !== 403) {
        throw new Error(`Expected 403, got ${res.status}: ${await res.text()}`);
      }
    }),
  );

  results.push(
    await runOne('DELETE theme resets podcasts using it to default', async () => {
      if (pagesThemeId) {
        await apiFetch(
          `/podcasts/${podcast.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedTheme: pagesThemeId }),
          },
          jar,
        );
      }
      const uniqueIds = [...new Set(themesToDelete.filter(Boolean))];
      for (const id of uniqueIds) {
        const del = await apiFetch(`/themes/${id}`, { method: 'DELETE' }, jar);
        if (del.status !== 204 && del.status !== 200 && del.status !== 404) {
          throw new Error(`DELETE ${id} expected 204/200/404, got ${del.status}: ${await del.text()}`);
        }
      }
      const pub = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      const data = await pub.json();
      if ((data.feed_theme ?? data.feedTheme) !== 'default') {
        throw new Error(
          `Expected feed_theme default after theme delete, got ${JSON.stringify(data.feed_theme)}`,
        );
      }
    }),
  );

  return results;
}
