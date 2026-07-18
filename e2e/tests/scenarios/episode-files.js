/**
 * Episode Files: permission, magic-byte upload, storage, reorder, public list.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
  createUser,
  cookieJar,
  login,
} from '../../lib/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '../../.tmp-episode-files');

/** Minimal valid 1x1 PNG */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function multipartUpload(episodeId, filePath, filename, jar, fields = {}) {
  const buf = readFileSync(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([buf], { type: 'application/octet-stream' }), filename);
  if (fields.title) formData.append('title', fields.title);
  if (fields.description) formData.append('description', fields.description);
  const headers = jar ? jar.apply({}) : {};
  delete headers['Content-Type'];
  const csrf = jar?.get()?.['harborfm_csrf'];
  if (csrf) headers['x-csrf-token'] = csrf;
  return fetch(`${baseURL}/episodes/${encodeURIComponent(episodeId)}/files/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });
}

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const ts = Date.now();
  mkdirSync(TMP, { recursive: true });
  const pngPath = join(TMP, 'ok.png');
  const fakePngPath = join(TMP, 'fake.png');
  writeFileSync(pngPath, PNG_BYTES);
  writeFileSync(fakePngPath, Buffer.from('not-a-png-file-contents'));

  const podcast = await createShow(adminJar, {
    title: 'E2E Episode Files',
    slug: `e2e-ef-${ts}`,
    description: '',
  });
  const episode = await createEpisode(adminJar, podcast.id, {
    title: 'E2E Episode Files Ep',
    status: 'published',
  });

  results.push(
    await runOne('GET /settings includes defaultCanUploadEpisodeFiles (default true)', async () => {
      const res = await apiFetch('/settings', {}, adminJar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.defaultCanUploadEpisodeFiles !== true) {
        throw new Error(
          `Expected defaultCanUploadEpisodeFiles true, got ${data.defaultCanUploadEpisodeFiles}`,
        );
      }
    }),
  );

  results.push(
    await runOne('User without canUploadEpisodeFiles gets 403 on upload', async () => {
      await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultCanUploadEpisodeFiles: true,
            registrationEnabled: true,
          }),
        },
        adminJar,
      );
      const { email, password } = await createUser({
        email: `ef-gate-${ts}@e2e.test`,
      });
      const userJar = cookieJar();
      await login(email, password, userJar);
      const userShow = await createShow(userJar, {
        title: 'E2E EF Gate',
        slug: `e2e-ef-gate-${ts}`,
      });
      const userEp = await createEpisode(userJar, userShow.id, {
        title: 'Gate Ep',
        status: 'draft',
      });

      const listRes = await apiFetch('/users?limit=200', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      const patchRes = await apiFetch(
        `/users/${u.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canUploadEpisodeFiles: false }),
        },
        adminJar,
      );
      if (patchRes.status !== 200) throw new Error(`Expected 200 PATCH, got ${patchRes.status}`);

      const denied = await multipartUpload(userEp.id, pngPath, 'ok.png', userJar, {
        title: 'Nope',
      });
      if (denied.status !== 403) {
        throw new Error(`Expected 403 upload without permission, got ${denied.status}`);
      }
    }),
  );

  let fileId;
  let linkId;
  let diskBefore;

  results.push(
    await runOne('Upload PNG (magic ok) and reject fake PNG magic', async () => {
      const meRes = await apiFetch('/auth/me', {}, adminJar);
      const me = await meRes.json();
      diskBefore = me.user?.diskBytesUsed ?? 0;

      const bad = await multipartUpload(episode.id, fakePngPath, 'fake.png', adminJar, {
        title: 'Fake',
      });
      if (bad.status !== 400) {
        throw new Error(`Expected 400 for bad magic, got ${bad.status}`);
      }

      const ok = await multipartUpload(episode.id, pngPath, 'ok.png', adminJar, {
        title: 'Tiny PNG',
        description: 'A pixel',
      });
      if (ok.status !== 201) {
        const t = await ok.text();
        throw new Error(`Expected 201 upload, got ${ok.status}: ${t}`);
      }
      const item = await ok.json();
      fileId = item.id;
      if (item.kind !== 'file' || item.title !== 'Tiny PNG') {
        throw new Error('Unexpected upload response');
      }
      if (!(item.byteSize > 0)) throw new Error('Expected byteSize > 0');
    }),
  );

  results.push(
    await runOne('Storage, link, reorder, delete frees storage', async () => {
      const meRes = await apiFetch('/auth/me', {}, adminJar);
      const me = await meRes.json();
      const afterUpload = me.user?.diskBytesUsed ?? 0;
      if (afterUpload < diskBefore + PNG_BYTES.length) {
        throw new Error(
          `Expected diskBytesUsed to increase by at least ${PNG_BYTES.length}, before=${diskBefore} after=${afterUpload}`,
        );
      }

      const linkRes = await apiFetch(
        `/episodes/${episode.id}/files/link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://example.com/notes',
            title: 'Example link',
            description: 'Docs',
          }),
        },
        adminJar,
      );
      if (linkRes.status !== 201) throw new Error(`Expected 201 link, got ${linkRes.status}`);
      const link = await linkRes.json();
      linkId = link.id;

      const reorderRes = await apiFetch(
        `/episodes/${episode.id}/files/reorder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: [linkId, fileId] }),
        },
        adminJar,
      );
      if (reorderRes.status !== 200) {
        throw new Error(`Expected 200 reorder, got ${reorderRes.status}`);
      }
      const reordered = await reorderRes.json();
      if (reordered.items[0]?.id !== linkId || reordered.items[1]?.id !== fileId) {
        throw new Error('Reorder did not persist order');
      }

      const delRes = await apiFetch(
        `/episodes/${episode.id}/files/${fileId}`,
        { method: 'DELETE' },
        adminJar,
      );
      if (delRes.status !== 204) throw new Error(`Expected 204 delete, got ${delRes.status}`);

      const meAfter = await apiFetch('/auth/me', {}, adminJar);
      const me2 = await meAfter.json();
      const afterDelete = me2.user?.diskBytesUsed ?? 0;
      if (afterDelete >= afterUpload) {
        throw new Error(
          `Expected diskBytesUsed to drop after delete, afterUpload=${afterUpload} afterDelete=${afterDelete}`,
        );
      }
    }),
  );

  results.push(
    await runOne('Public list returns ordered episode files and download works', async () => {
      const ok = await multipartUpload(episode.id, pngPath, 'ok.png', adminJar, {
        title: 'Public PNG',
      });
      if (ok.status !== 201) throw new Error(`Expected 201, got ${ok.status}`);
      const uploaded = await ok.json();

      const reorderRes = await apiFetch(
        `/episodes/${episode.id}/files/reorder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: [linkId, uploaded.id] }),
        },
        adminJar,
      );
      if (reorderRes.status !== 200) throw new Error(`Expected 200, got ${reorderRes.status}`);

      const pub = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(podcast.slug)}/episodes/${encodeURIComponent(episode.slug)}/files`,
      );
      if (pub.status !== 200) throw new Error(`Expected 200 public, got ${pub.status}`);
      const data = await pub.json();
      if (!Array.isArray(data.items) || data.items.length < 2) {
        throw new Error('Expected at least 2 public items');
      }
      if (data.items[0].id !== linkId) {
        throw new Error('Public order should start with link');
      }
      const fileItem = data.items.find((i) => i.id === uploaded.id);
      if (!fileItem?.downloadUrl) throw new Error('Public file should have downloadUrl');

      // downloadUrl is /api/public/...; baseURL already ends with /api
      const path = fileItem.downloadUrl.replace(/^\/api/, '');
      const dlRes = await fetch(`${baseURL}${path}`);
      if (dlRes.status !== 200) {
        throw new Error(`Expected 200 public file download, got ${dlRes.status}`);
      }
    }),
  );

  return results;
}
