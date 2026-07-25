import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  apiFetch,
  completeSetup,
  loginAsAdmin,
  createUser,
  createShow,
  createEpisode,
  addRecordedSegment,
  cookieJar,
  login,
  uploadEpisodeAudio,
  testDataMp3,
  bootstrapSegmentTracksFromMix,
  getSegmentTracks,
  findSegmentMultitrackDir,
  e2eDataDir,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  try {
    await completeSetup({ registrationEnabled: true, publicFeedsEnabled: true });
  } catch {
    // Setup already completed in a full suite run.
  }

  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, {
    title: 'E2E Tracks Bootstrap Show',
    slug: `e2e-tracks-boot-${Date.now()}`,
  });
  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Tracks Bootstrap Ep',
    status: 'draft',
  });
  const seg = await addRecordedSegment(jar, episode.id);

  results.push(
    await runOne('list segments marks mix-only as canBootstrapAdvancedEditor', async () => {
      const res = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (!res.ok) throw new Error(`List segments failed: ${res.status}`);
      const data = await res.json();
      const row = (data.segments || []).find((s) => s.id === seg.id);
      if (!row) throw new Error('Segment missing from list');
      if (row.hasRecordings) throw new Error('Expected hasRecordings false before bootstrap');
      if (!row.canBootstrapAdvancedEditor) {
        throw new Error('Expected canBootstrapAdvancedEditor true for mix-only segment');
      }
    }),
  );

  let diskBefore = 0;
  results.push(
    await runOne('bootstrap-from-mix creates single-track recordings and charges storage', async () => {
      const meBefore = await (await apiFetch('/auth/me', {}, jar)).json();
      diskBefore = meBefore.user?.diskBytesUsed ?? 0;

      const boot = await bootstrapSegmentTracksFromMix(jar, episode.id, seg.id);
      if (!boot.hasRecordings) throw new Error('Expected hasRecordings true');
      if (boot.alreadyExisted) throw new Error('Expected first bootstrap alreadyExisted false');
      if (!(boot.bytesAdded > 0)) {
        throw new Error(`Expected bytesAdded > 0, got ${boot.bytesAdded}`);
      }
      if (!boot.takeFile || !String(boot.takeFile).startsWith('mix.')) {
        throw new Error(`Expected takeFile mix.*, got ${boot.takeFile}`);
      }

      const mtDir = findSegmentMultitrackDir(podcast.id, episode.id, seg.id);
      if (!mtDir || !existsSync(join(mtDir, 'tracks_manifest.json'))) {
        throw new Error('Expected recordings dir with tracks_manifest.json');
      }
      if (!existsSync(join(mtDir, boot.takeFile))) {
        throw new Error(`Missing take file ${boot.takeFile}`);
      }

      const tracks = await getSegmentTracks(jar, episode.id, seg.id);
      if (!Array.isArray(tracks.clips) || tracks.clips.length !== 1) {
        throw new Error(`Expected 1 clip, got ${tracks.clips?.length}`);
      }
      if (!Array.isArray(tracks.takes) || tracks.takes.length !== 1) {
        throw new Error(`Expected 1 take, got ${tracks.takes?.length}`);
      }

      const meAfter = await (await apiFetch('/auth/me', {}, jar)).json();
      const diskAfter = meAfter.user?.diskBytesUsed ?? 0;
      if (diskAfter < diskBefore + boot.bytesAdded) {
        throw new Error(
          `Expected diskBytesUsed to increase by ${boot.bytesAdded}, before=${diskBefore} after=${diskAfter}`,
        );
      }

      const listRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const list = await listRes.json();
      const row = (list.segments || []).find((s) => s.id === seg.id);
      if (!row?.hasRecordings) throw new Error('Expected hasRecordings true after bootstrap');
      if (row.canBootstrapAdvancedEditor) {
        throw new Error('Expected canBootstrapAdvancedEditor false after bootstrap');
      }
    }),
  );

  results.push(
    await runOne('second bootstrap-from-mix is idempotent and does not re-charge', async () => {
      const meBefore = await (await apiFetch('/auth/me', {}, jar)).json();
      const before = meBefore.user?.diskBytesUsed ?? 0;
      const boot = await bootstrapSegmentTracksFromMix(jar, episode.id, seg.id);
      if (!boot.alreadyExisted) throw new Error('Expected alreadyExisted true on second bootstrap');
      if (boot.bytesAdded !== 0) {
        throw new Error(`Expected bytesAdded 0 on idempotent bootstrap, got ${boot.bytesAdded}`);
      }
      const meAfter = await (await apiFetch('/auth/me', {}, jar)).json();
      const after = meAfter.user?.diskBytesUsed ?? 0;
      if (after !== before) {
        throw new Error(`Disk bytes changed on idempotent bootstrap: ${before} -> ${after}`);
      }
    }),
  );

  // Storage-limit failure: dedicated user near quota.
  const { jar: adminJar } = await loginAsAdmin();
  const { email, password } = await createUser({
    email: `boot-storage-${Date.now()}@e2e.test`,
  });
  const listRes = await apiFetch('/users?limit=100', {}, adminJar);
  const list = await listRes.json();
  const u = list.users.find((x) => x.email === email);
  if (!u) throw new Error('Storage test user not found');

  const limitedJar = cookieJar();
  await login(email, password, limitedJar);
  const limitedPodcast = await createShow(limitedJar, {
    title: 'E2E Bootstrap Quota Show',
    slug: `e2e-boot-quota-${Date.now()}`,
  });
  const limitedEp = await createEpisode(limitedJar, limitedPodcast.id, {
    title: 'E2E Bootstrap Quota Ep',
  });
  const limitedSeg = await addRecordedSegment(limitedJar, limitedEp.id);

  // Fill toward 1 MB so a second mix-sized copy exceeds the limit.
  for (let i = 0; i < 6; i++) {
    const ep = await createEpisode(limitedJar, limitedPodcast.id, {
      title: `E2E Fill Ep ${i}`,
    });
    await uploadEpisodeAudio(limitedJar, ep.id, limitedPodcast.id, testDataMp3());
  }

  const patchRes = await apiFetch(
    `/users/${u.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxStorageMb: 1 }),
    },
    adminJar,
  );
  if (patchRes.status !== 200) {
    throw new Error(`PATCH user limit failed: ${patchRes.status}`);
  }

  results.push(
    await runOne('bootstrap-from-mix over storage limit returns 403 and leaves no recordings dir', async () => {
      let status = 0;
      try {
        await bootstrapSegmentTracksFromMix(limitedJar, limitedEp.id, limitedSeg.id);
      } catch (err) {
        status = err.status || 0;
        const msg = String(err.message || '').toLowerCase();
        if (status !== 403) {
          throw new Error(`Expected 403, got ${status}: ${err.message}`);
        }
        if (!msg.includes('storage limit')) {
          throw new Error(`Expected storage limit error, got: ${err.message}`);
        }
      }
      if (status !== 403) {
        throw new Error('Expected bootstrap to fail with 403 over quota');
      }
      const mtDir = findSegmentMultitrackDir(
        limitedPodcast.id,
        limitedEp.id,
        limitedSeg.id,
      );
      if (mtDir && existsSync(mtDir)) {
        const names = readdirSync(mtDir);
        throw new Error(
          `Expected no orphan recordings dir after quota failure, found ${mtDir} with ${names.join(',')}`,
        );
      }
      // Also ensure uploads/.../recordings parent has no leftover for this segment.
      const recordingsBase = join(
        e2eDataDir(),
        'uploads',
        limitedPodcast.id,
        limitedEp.id,
        'recordings',
      );
      if (existsSync(recordingsBase)) {
        const leftover = readdirSync(recordingsBase).filter(
          (n) => n === limitedSeg.id || n.endsWith(`_${limitedSeg.id}`),
        );
        if (leftover.length) {
          throw new Error(`Orphan recordings folders: ${leftover.join(',')}`);
        }
      }
    }),
  );

  return results;
}
