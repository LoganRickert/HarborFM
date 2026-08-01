/**
 * Episode archive: settings CRUD, archive/restore via WebDAV, cold-storage detection.
 *
 * Happy-path archive/restore expects the local WebDAV stack from the README
 * (http://127.0.0.1:9412, davuser/davpass). If WebDAV is unreachable, those
 * cases are skipped with a clear message.
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
  addRecordedSegment,
  e2eDataDir,
} from '../../lib/helpers.js';

const WEBDAV_URL = process.env.E2E_WEBDAV_URL || 'http://127.0.0.1:9412/webdav';
const WEBDAV_USER = process.env.E2E_WEBDAV_USER || 'davuser';
const WEBDAV_PASS = process.env.E2E_WEBDAV_PASS || 'davpass';

async function webdavReachable() {
  try {
    const auth = Buffer.from(`${WEBDAV_USER}:${WEBDAV_PASS}`).toString('base64');
    const res = await fetch(WEBDAV_URL, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
        Depth: '0',
      },
      signal: AbortSignal.timeout(3000),
    });
    return res.status === 207 || res.status === 200 || res.status === 404 || res.status === 405;
  } catch {
    return false;
  }
}

async function waitForRender(jar, episodeId, timeoutMs = 120_000) {
  let res = await apiFetch(`/episodes/${episodeId}/render`, { method: 'POST' }, jar);
  if (res.status !== 202) {
    throw new Error(`Expected render 202, got ${res.status}`);
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    res = await apiFetch(`/episodes/${episodeId}/render-status`, {}, jar);
    const data = await res.json();
    if (data.status === 'done') return;
    if (data.status === 'failed') {
      throw new Error(`Render failed: ${data.error || 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Render timeout');
}

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, {
    title: 'E2E Archive Show',
    slug: `e2e-archive-${Date.now()}`,
  });

  results.push(
    await runOne('GET archive-settings returns unconfigured', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/archive-settings`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.configured !== false) throw new Error('Expected configured=false');
    }),
  );

  results.push(
    await runOne('Archive without settings returns 400', async () => {
      const ep = await createEpisode(jar, podcast.id, {
        title: 'E2E Archive No Settings',
        status: 'draft',
      });
      await addRecordedSegment(jar, ep.id);
      await waitForRender(jar, ep.id);
      const res = await apiFetch(`/episodes/${ep.id}/archive`, { method: 'POST' }, jar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!/Archive Settings/i.test(data.error || '')) {
        throw new Error(`Expected archive settings error, got: ${data.error}`);
      }
    }),
  );

  results.push(
    await runOne('Backup without settings returns 400', async () => {
      const ep = await createEpisode(jar, podcast.id, {
        title: 'E2E Backup No Settings',
        status: 'draft',
      });
      await addRecordedSegment(jar, ep.id);
      await waitForRender(jar, ep.id);
      const res = await apiFetch(
        `/episodes/${ep.id}/backup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        jar,
      );
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!/Archive Settings/i.test(data.error || '')) {
        throw new Error(`Expected archive settings error, got: ${data.error}`);
      }
    }),
  );

  results.push(
    await runOne('PUT archive-settings WebDAV upserts', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}/archive-settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'WebDAV',
            name: 'E2E WebDAV Archive',
            url: WEBDAV_URL,
            username: WEBDAV_USER,
            password: WEBDAV_PASS,
            path: `harborfm-e2e-archive/${Date.now()}`,
          }),
        },
        jar,
      );
      if (res.status !== 201 && res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 201/200, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.configured || data.settings?.mode !== 'WebDAV') {
        throw new Error('Expected configured WebDAV settings');
      }
    }),
  );

  results.push(
    await runOne('S3 cold storage assertObjectDownloadable', async () => {
      const mod = await import(
        new URL('../../../server/dist/services/s3.js', import.meta.url).href
      );
      const { assertObjectDownloadable, ArchiveColdStorageError } = mod;
      assertObjectDownloadable('STANDARD', null);
      assertObjectDownloadable('STANDARD_IA', null);
      assertObjectDownloadable('GLACIER_IR', null);
      assertObjectDownloadable(
        'GLACIER',
        'ongoing-request="false", expiry-date="Wed, 01 Apr 2026 00:00:00 GMT"',
      );
      let threw = false;
      try {
        assertObjectDownloadable('GLACIER', null);
      } catch (e) {
        threw = e instanceof ArchiveColdStorageError || e?.code === 'ARCHIVE_COLD_STORAGE';
        if (!threw && e?.name === 'ArchiveColdStorageError') threw = true;
      }
      if (!threw) throw new Error('Expected ArchiveColdStorageError for unrestored GLACIER');
      threw = false;
      try {
        assertObjectDownloadable('DEEP_ARCHIVE', 'ongoing-request="true"');
      } catch (e) {
        threw = e instanceof ArchiveColdStorageError || e?.code === 'ARCHIVE_COLD_STORAGE' || e?.name === 'ArchiveColdStorageError';
      }
      if (!threw) {
        throw new Error('Expected ArchiveColdStorageError for Deep Archive while restore ongoing');
      }
    }),
  );

  const hasWebdav = await webdavReachable();
  if (!hasWebdav) {
    results.push(
      await runOne('WebDAV archive/restore skipped (WebDAV not reachable on :9412)', async () => {
        // Soft skip: pass so CI without docker compose delivery stack still succeeds.
      }),
    );
    return results;
  }

  results.push(
    await runOne('POST archive-settings/test succeeds against WebDAV', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}/archive-settings/test`,
        { method: 'POST' },
        jar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.ok) throw new Error(`Test failed: ${data.error}`);
    }),
  );

  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Archive Episode',
    status: 'draft',
    description: 'Original description before archive',
  });
  await addRecordedSegment(jar, episode.id);
  await waitForRender(jar, episode.id);

  const uploadsDir = join(e2eDataDir(), 'uploads', podcast.id, episode.id);
  const processedDir = join(e2eDataDir(), 'processed', podcast.id, episode.id);

  results.push(
    await runOne('POST backup uploads without clearing segments', async () => {
      const res = await apiFetch(
        `/episodes/${episode.id}/backup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        jar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.backupRemotePath) throw new Error('Expected backupRemotePath');
      if (!data.backupSha256) throw new Error('Expected backupSha256');
      if (!String(data.backupRemotePath).includes('harborfm-backups/')) {
        throw new Error(`Expected backups path, got ${data.backupRemotePath}`);
      }

      const epRes = await apiFetch(`/episodes/${episode.id}`, {}, jar);
      const ep = await epRes.json();
      if (ep.archivedAt) throw new Error('Backup must not set archivedAt');

      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const segData = await segRes.json();
      const segs = segData.segments || segData;
      if (!Array.isArray(segs) || segs.length === 0) {
        throw new Error('Expected segments to remain after backup');
      }

      if (!existsSync(uploadsDir)) {
        throw new Error('Expected uploads dir to remain after backup');
      }
    }),
  );

  let datedBackupFilename = '';
  results.push(
    await runOne('POST dated backup creates a timestamped zip', async () => {
      const res = await apiFetch(
        `/episodes/${episode.id}/backup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dated: true }),
        },
        jar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.backupFilename) throw new Error('Expected backupFilename');
      if (!/_\d{8}_\d{6}\.zip$/i.test(data.backupFilename)) {
        throw new Error(`Expected dated filename, got ${data.backupFilename}`);
      }
      datedBackupFilename = data.backupFilename;
    }),
  );

  results.push(
    await runOne('GET backups lists uploaded zips', async () => {
      const res = await apiFetch(`/episodes/${episode.id}/backups`, {}, jar);
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      const backups = data.backups || [];
      if (!Array.isArray(backups) || backups.length < 2) {
        throw new Error(`Expected at least 2 backups, got ${backups.length}`);
      }
      if (datedBackupFilename && !backups.some((b) => b.filename === datedBackupFilename)) {
        throw new Error('Dated backup missing from list');
      }
    }),
  );

  results.push(
    await runOne('POST backups/restore restores segments from dated backup', async () => {
      if (!datedBackupFilename) throw new Error('Missing dated backup filename');
      const res = await apiFetch(
        `/episodes/${episode.id}/backups/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: datedBackupFilename }),
        },
        jar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200, got ${res.status}: ${body}`);
      }
      const epRes = await apiFetch(`/episodes/${episode.id}`, {}, jar);
      const ep = await epRes.json();
      if (ep.archivedAt) throw new Error('Backup restore must not set archivedAt');

      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const segData = await segRes.json();
      const segs = segData.segments || segData;
      if (!Array.isArray(segs) || segs.length === 0) {
        throw new Error('Expected segments after backup restore');
      }
    }),
  );

  results.push(
    await runOne('POST archive uploads and clears segments', async () => {
      const res = await apiFetch(`/episodes/${episode.id}/archive`, { method: 'POST' }, jar);
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.archivedAt) throw new Error('Expected archivedAt');
      if (!data.archiveRemotePath) throw new Error('Expected archiveRemotePath');
      if (!data.archiveSha256) throw new Error('Expected archiveSha256');

      const epRes = await apiFetch(`/episodes/${episode.id}`, {}, jar);
      const ep = await epRes.json();
      if (!ep.archivedAt) throw new Error('Episode should report archivedAt');

      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const segData = await segRes.json();
      const segs = segData.segments || segData;
      if (Array.isArray(segs) && segs.length > 0) {
        throw new Error('Expected no segments after archive');
      }

      if (existsSync(uploadsDir)) {
        const entries = readdirSync(uploadsDir);
        if (entries.length > 0) {
          throw new Error(`Expected empty uploads dir after archive, found: ${entries.join(',')}`);
        }
      }

      if (!existsSync(processedDir) || !readdirSync(processedDir).some((n) => n.startsWith('final.'))) {
        throw new Error('Expected final audio to remain under processed/');
      }
      void statSync;
    }),
  );

  results.push(
    await runOne('Restore keeps updated description and returns segments', async () => {
      const newDesc = 'Updated after archive, must survive restore';
      let res = await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDesc }),
        },
        jar,
      );
      if (res.status !== 200) throw new Error(`PATCH failed: ${res.status}`);

      res = await apiFetch(`/episodes/${episode.id}/restore`, { method: 'POST' }, jar);
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected restore 200, got ${res.status}: ${body}`);
      }

      res = await apiFetch(`/episodes/${episode.id}`, {}, jar);
      const ep = await res.json();
      if (ep.archivedAt) throw new Error('archivedAt should be cleared');
      if (ep.description !== newDesc) {
        throw new Error(`Description overwritten: got "${ep.description}"`);
      }

      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const segData = await segRes.json();
      const segs = segData.segments || segData;
      if (!Array.isArray(segs) || segs.length < 1) {
        throw new Error('Expected segments after restore');
      }
    }),
  );

  results.push(
    await runOne('DELETE archive-settings', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}/archive-settings`,
        { method: 'DELETE' },
        jar,
      );
      if (res.status !== 204) throw new Error(`Expected 204, got ${res.status}`);
      const get = await apiFetch(`/podcasts/${podcast.id}/archive-settings`, {}, jar);
      const data = await get.json();
      if (data.configured !== false) throw new Error('Expected settings removed');
    }),
  );

  return results;
}
