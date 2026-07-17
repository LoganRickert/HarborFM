import { createRequire } from 'module';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import {
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
  addRecordedSegment,
  createUser,
  cookieJar,
  login,
  testDataMp3,
  importSegmentProject,
  importEpisodeProjectExpectFail,
} from '../../lib/helpers.js';

function findMtDir(recordingsBase, segmentId) {
  if (!existsSync(recordingsBase)) return null;
  const names = readdirSync(recordingsBase);
  const match = names.find((n) => n === segmentId || n.endsWith(`_${segmentId}`));
  return match ? join(recordingsBase, match) : null;
}

function writeShortMp3(outPath, durationSec = 1) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=mono',
      '-t',
      String(durationSec),
      '-c:a',
      'libmp3lame',
      '-q:a',
      '9',
      outPath,
    ],
    { stdio: 'ignore' },
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = join(__dirname, '../..');
const DATA_DIR = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');
const require = createRequire(join(E2E_DIR, '../server/package.json'));
const AdmZip = require('adm-zip');

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const episodeTitle = 'E2E Segment Manage Ep';
  const podcastTitle = 'E2E Segment Manage Show';
  const segmentName = 'Intro Mix';
  const whiteLabel = process.env.APP_NAME?.trim() || 'HarborFM';
  const expectedFilename = `${segmentName}_${episodeTitle}_${podcastTitle}_${whiteLabel}-segment.zip`;

  const podcast = await createShow(jar, {
    title: podcastTitle,
    slug: `e2e-seg-manage-${Date.now()}`,
  });
  const episode = await createEpisode(jar, podcast.id, {
    title: episodeTitle,
    status: 'draft',
  });
  const seg = await addRecordedSegment(jar, episode.id);
  const durationSec = seg.durationSec ?? 10;
  const trimRanges = [[0.5, Math.min(2, durationSec - 0.1)]];
  await apiFetch(
    `/episodes/${episode.id}/segments/${seg.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trimRanges, name: segmentName }),
    },
    jar,
  );

  // Plant multitrack for project export
  const recordingsBase = join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings');
  mkdirSync(recordingsBase, { recursive: true });
  const epoch = Date.now();
  const d = new Date(epoch);
  const folderName = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}_${seg.id}`;
  const mtDir = join(recordingsBase, folderName);
  mkdirSync(mtDir, { recursive: true });
  writeFileSync(join(mtDir, 'host.mp3'), readFileSync(testDataMp3()));
  writeFileSync(join(mtDir, 'guest.mp3'), readFileSync(testDataMp3()));
  writeFileSync(
    join(mtDir, 'tracks_manifest.json'),
    JSON.stringify({
      recordingEpochMs: epoch,
      sessionStartedAtEpochMs: epoch,
      episodeId: episode.id,
      podcastId: podcast.id,
      segments: [
        {
          segmentId: 'host-clip',
          producerId: 'host',
          participantName: 'Host',
          startMs: 0,
          endMs: Math.round(durationSec * 1000),
          filePath: 'host.mp3',
          codec: 'libmp3lame',
        },
        {
          segmentId: 'guest-clip',
          producerId: 'guest',
          participantName: 'Guest',
          startMs: 0,
          endMs: Math.round(durationSec * 1000),
          filePath: 'guest.mp3',
          codec: 'libmp3lame',
        },
      ],
    }),
  );

  let zipBuffer = null;

  results.push(
    await runOne('GET download-mp3 returns audio/mpeg for editor', async () => {
      const res = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/download-mp3`,
        {},
        jar,
      );
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status} ${await res.text()}`);
      }
      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('audio/mpeg') && !ctype.includes('mpeg')) {
        throw new Error(`Expected audio/mpeg, got ${ctype}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error('MP3 too small');
      const expectedMp3 = `${segmentName}_${episodeTitle}_${podcastTitle}.mp3`;
      const disposition = res.headers.get('content-disposition') || '';
      if (!disposition.includes(`filename="${expectedMp3}"`)) {
        throw new Error(
          `Expected Content-Disposition filename="${expectedMp3}", got: ${disposition}`,
        );
      }
    }),
  );

  results.push(
    await runOne('View-only collaborator gets 403 on download-mp3', async () => {
      const { email, password } = await createUser({
        email: `view-seg-mp3-${Date.now()}@e2e.test`,
      });
      await apiFetch(
        `/podcasts/${podcast.id}/collaborators`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role: 'view' }),
        },
        jar,
      );
      const viewJar = cookieJar();
      await login(email, password, viewJar);
      const res = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/download-mp3`,
        {},
        viewJar,
      );
      if (res.status !== 403) {
        throw new Error(`Expected 403 for view role, got ${res.status}`);
      }
    }),
  );

  results.push(
    await runOne('GET project-export returns kind:segment zip with hashes', async () => {
      const res = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/project-export`,
        {},
        jar,
      );
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status} ${await res.text()}`);
      }
      const disposition = res.headers.get('content-disposition') || '';
      if (!disposition.includes(`filename="${expectedFilename}"`)) {
        throw new Error(
          `Expected Content-Disposition filename="${expectedFilename}", got: ${disposition}`,
        );
      }
      zipBuffer = Buffer.from(await res.arrayBuffer());
      const zip = new AdmZip(zipBuffer);
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      if (!names.includes('harborfm-project.json')) {
        throw new Error('Missing harborfm-project.json');
      }
      if (!names.includes('README.md')) {
        throw new Error('Missing README.md');
      }
      if (!names.some((n) => n.startsWith('segment/') && n.endsWith('segment.json'))) {
        throw new Error('Missing segment/segment.json');
      }
      const manifest = JSON.parse(zip.readAsText('harborfm-project.json'));
      if (manifest.kind !== 'segment') {
        throw new Error(`kind expected segment, got ${manifest.kind}`);
      }
      if (manifest.formatVersion !== 1) {
        throw new Error(`formatVersion expected 1, got ${manifest.formatVersion}`);
      }
      const segJson = JSON.parse(zip.readAsText('segment/segment.json'));
      if (!segJson.audioSha256) throw new Error('segment.json missing audioSha256');
      if (!segJson.waveformSha256) throw new Error('segment.json missing waveformSha256');
    }),
  );

  results.push(
    await runOne('POST import-project overwrites segment keeping id', async () => {
      if (!zipBuffer) throw new Error('No zip from export');
      const zip = new AdmZip(zipBuffer);
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      const audioPath = names.find((n) => /^segment\/audio\./.test(n));
      if (!audioPath) throw new Error('Missing segment audio');
      const segJson = JSON.parse(zip.readAsText('segment/segment.json'));
      const originalHash = segJson.audioSha256;
      const tmp = mkdtempSync(join(tmpdir(), 'hfm-e2e-seg-'));
      const shortMp3 = join(tmp, 'short.mp3');
      writeShortMp3(shortMp3, 1);
      const audioBuf = readFileSync(shortMp3);
      const mutatedHash = createHash('sha256').update(audioBuf).digest('hex');
      if (mutatedHash === originalHash) throw new Error('Replacement did not change hash');
      const audioEntryName = audioPath.replace(/\.[^.]+$/, '.mp3');
      if (audioEntryName !== audioPath) zip.deleteFile(audioPath);
      zip.addFile(audioEntryName, audioBuf);
      segJson.audioFile = audioEntryName.split('/').pop();
      zip.updateFile(
        'segment/segment.json',
        Buffer.from(JSON.stringify(segJson, null, 2)),
      );

      const mutatedZip = zip.toBuffer();
      await importSegmentProject(jar, episode.id, seg.id, mutatedZip, 'segment.zip');
      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (segRes.status !== 200) {
        throw new Error(`GET segments after import failed: ${segRes.status}`);
      }
      const segs = (await segRes.json()).segments || [];
      const data = segs.find((s) => s.id === seg.id);
      if (!data) throw new Error('Segment missing after import');
      if (data.id !== seg.id) {
        throw new Error(`Segment id should be unchanged: ${data.id} vs ${seg.id}`);
      }
      if (!(data.durationSec > 0) || data.durationSec > 3) {
        throw new Error(`Expected ~1s duration, got ${data.durationSec}`);
      }
      if (!data.waveformExists) {
        throw new Error('Expected waveformExists after import');
      }
    }),
  );

  results.push(
    await runOne('Import Segment with deleted track remakes mix without that track', async () => {
      if (!zipBuffer) throw new Error('No zip from export');
      const zip = new AdmZip(zipBuffer);
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      const guestPath = names.find((n) => n.includes('recordings/') && n.endsWith('guest.mp3'));
      const mtManifestPath = names.find(
        (n) => n.includes('recordings/') && n.endsWith('tracks_manifest.json'),
      );
      if (!guestPath || !mtManifestPath) {
        throw new Error('Zip missing guest track or tracks_manifest');
      }
      zip.deleteFile(guestPath);

      const mutatedZip = zip.toBuffer();
      await importSegmentProject(jar, episode.id, seg.id, mutatedZip, 'segment-mt-delete.zip');
      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (segRes.status !== 200) {
        throw new Error(`GET segments after delete-track import failed: ${segRes.status}`);
      }
      const segs = (await segRes.json()).segments || [];
      const data = segs.find((s) => s.id === seg.id);
      if (!data) throw new Error('Segment missing after delete-track import');
      if (data.id !== seg.id) {
        throw new Error(`Segment id should be unchanged: ${data.id} vs ${seg.id}`);
      }
      if (!String(data.audioPath || '').endsWith('.wav')) {
        throw new Error(`Expected remade mix .wav after track delete, got ${data.audioPath}`);
      }
      const importedMt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!importedMt) throw new Error('Missing multitrack dir after delete-track import');
      if (existsSync(join(importedMt, 'guest.mp3'))) {
        throw new Error('Deleted guest.mp3 should not exist on disk after import');
      }
      if (!existsSync(join(importedMt, 'host.mp3'))) {
        throw new Error('host.mp3 should remain after guest delete');
      }
      const afterManifest = JSON.parse(
        readFileSync(join(importedMt, 'tracks_manifest.json'), 'utf8'),
      );
      const afterSegs = afterManifest.segments || [];
      if (afterSegs.length !== 1) {
        throw new Error(`Expected pruned manifest with 1 track, got ${afterSegs.length}`);
      }
    }),
  );

  results.push(
    await runOne('Episode import-project rejects kind:segment zip', async () => {
      if (!zipBuffer) throw new Error('No zip from export');
      const message = await importEpisodeProjectExpectFail(
        jar,
        podcast.id,
        zipBuffer,
        'segment-as-episode.zip',
      );
      if (!String(message || '').toLowerCase().includes('segment')) {
        throw new Error(`Expected segment rejection message, got ${message}`);
      }
    }),
  );

  return results;
}
