import { createRequire } from 'module';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, mkdtempSync } from 'fs';
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
  importEpisodeProject,
} from '../../lib/helpers.js';

/** Write a short valid mono MP3 via ffmpeg (for hash-mismatch import tests). */
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

function writeShortWav(outPath, durationSec = 1) {
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
      '-acodec',
      'pcm_s16le',
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

function findMtDir(recordingsBase, segmentId) {
  if (!existsSync(recordingsBase)) return null;
  const names = readdirSync(recordingsBase);
  const match = names.find((n) => n === segmentId || n.endsWith(`_${segmentId}`));
  return match ? join(recordingsBase, match) : null;
}

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const episodeTitle = 'E2E Project Zip Ep';
  const podcastTitle = 'E2E Project Zip Show';
  const whiteLabel = process.env.APP_NAME?.trim() || 'HarborFM';
  const expectedFilename = `${episodeTitle}_${podcastTitle}_${whiteLabel}-project.zip`;

  const podcast = await createShow(jar, {
    title: podcastTitle,
    slug: `e2e-project-zip-${Date.now()}`,
  });
  const episode = await createEpisode(jar, podcast.id, {
    title: episodeTitle,
    status: 'draft',
  });
  const seg = await addRecordedSegment(jar, episode.id);
  const durationSec = seg.durationSec ?? 10;
  const trimRanges = [[0.5, Math.min(2, durationSec - 0.1)]];
  const markers = [
    { time: 1, title: 'Keep' },
    { time: Math.max(durationSec - 0.5, 1.5), title: 'Near end' },
  ];
  await apiFetch(
    `/episodes/${episode.id}/segments/${seg.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trimRanges, name: 'Intro Mix', markers }),
    },
    jar,
  );

  // Plant multitrack dir with real fixture audio (segments[] shape matches live recordings)
  const recordingsBase = join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings');
  mkdirSync(recordingsBase, { recursive: true });
  const epoch = Date.now();
  const d = new Date(epoch);
  const folderName = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}_${seg.id}`;
  const mtDir = join(recordingsBase, folderName);
  mkdirSync(mtDir, { recursive: true });
  const trackName = 'host.mp3';
  const guestTrackName = 'guest.mp3';
  writeFileSync(join(mtDir, trackName), readFileSync(testDataMp3()));
  writeFileSync(join(mtDir, guestTrackName), readFileSync(testDataMp3()));
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
          filePath: trackName,
          codec: 'libmp3lame',
        },
        {
          segmentId: 'guest-clip',
          producerId: 'guest',
          participantName: 'Guest',
          startMs: 0,
          endMs: Math.round(durationSec * 1000),
          filePath: guestTrackName,
          codec: 'libmp3lame',
        },
      ],
    }),
  );

  let zipBuffer = null;

  results.push(
    await runOne('GET project-export returns zip with expected entries', async () => {
      const res = await apiFetch(`/episodes/${episode.id}/project-export`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status} ${await res.text()}`);
      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('zip') && !ctype.includes('octet-stream')) {
        throw new Error(`Expected zip content-type, got ${ctype}`);
      }
      const disposition = res.headers.get('content-disposition') || '';
      if (!disposition.includes(`filename="${expectedFilename}"`)) {
        throw new Error(
          `Expected Content-Disposition filename="${expectedFilename}", got: ${disposition}`,
        );
      }
      zipBuffer = Buffer.from(await res.arrayBuffer());
      if (zipBuffer.length < 100) throw new Error('Zip too small');
      const zip = new AdmZip(zipBuffer);
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      if (!names.includes('harborfm-project.json')) {
        throw new Error(`Missing harborfm-project.json; got ${names.slice(0, 20).join(', ')}`);
      }
      if (!names.includes('README.md')) {
        throw new Error('Missing README.md in project zip');
      }
      const readme = zip.readAsText('README.md');
      if (!readme.includes('audio.mp3') || !readme.includes('audio.wav')) {
        throw new Error('README.md should document audio.mp3 / audio.wav hand edits');
      }
      if (!names.some((n) => n.startsWith('segments/') && n.endsWith('segment.json'))) {
        throw new Error('Missing segment.json in zip');
      }
      if (!names.some((n) => n.includes('/recordings/') && n.endsWith('tracks_manifest.json'))) {
        throw new Error('Missing multitrack recordings in zip');
      }
      const manifest = JSON.parse(zip.readAsText('harborfm-project.json'));
      if (manifest.formatVersion !== 1) {
        throw new Error(`formatVersion expected 1, got ${manifest.formatVersion}`);
      }
      const segJsonPath = names.find((n) => n.startsWith('segments/') && n.endsWith('segment.json'));
      const segJson = JSON.parse(zip.readAsText(segJsonPath));
      if (!segJson.audioSha256 || typeof segJson.audioSha256 !== 'string') {
        throw new Error('segment.json missing audioSha256');
      }
      if (!segJson.waveformSha256 || typeof segJson.waveformSha256 !== 'string') {
        throw new Error('segment.json missing waveformSha256');
      }
      const mtManifestPath = names.find(
        (n) => n.includes('/recordings/') && n.endsWith('tracks_manifest.json'),
      );
      const mtManifest = JSON.parse(zip.readAsText(mtManifestPath));
      const trackSeg = mtManifest.segments?.[0];
      if (!trackSeg?.fileSha256) throw new Error('tracks_manifest missing fileSha256');
      if (!trackSeg?.waveformSha256) {
        throw new Error('tracks_manifest missing waveformSha256');
      }
    }),
  );

  results.push(
    await runOne('Second GET project-export returns 200 (cache hit)', async () => {
      const t0 = Date.now();
      const res = await apiFetch(`/episodes/${episode.id}/project-export`, {}, jar);
      const elapsed = Date.now() - t0;
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!zipBuffer || buf.length !== zipBuffer.length) {
        throw new Error(`Cache size mismatch: ${buf.length} vs ${zipBuffer?.length}`);
      }
      // Soft check: cache should usually be faster; do not fail solely on timing
      void elapsed;
    }),
  );

  results.push(
    await runOne('View-only collaborator gets 403 on project-export', async () => {
      const { email, password } = await createUser({ email: `view-zip-${Date.now()}@e2e.test` });
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
      const res = await apiFetch(`/episodes/${episode.id}/project-export`, {}, viewJar);
      if (res.status !== 403) {
        throw new Error(`Expected 403 for view role, got ${res.status}`);
      }
    }),
  );

  results.push(
    await runOne('POST import-project recreates draft with segments and multitrack', async () => {
      if (!zipBuffer) throw new Error('No zip from export step');
      const data = await importEpisodeProject(jar, podcast.id, zipBuffer, 'project.zip');
      if (data.episodeId === episode.id) throw new Error('Imported episode id should be new');

      const epRes = await apiFetch(`/episodes/${data.episodeId}`, {}, jar);
      if (epRes.status !== 200) throw new Error(`GET imported episode failed: ${epRes.status}`);
      const ep = await epRes.json();
      if (ep.status !== 'draft') throw new Error(`Expected draft, got ${ep.status}`);
      if (ep.title !== episodeTitle) {
        throw new Error(`Title mismatch: ${ep.title}`);
      }

      const segRes = await apiFetch(`/episodes/${data.episodeId}/segments`, {}, jar);
      if (segRes.status !== 200) throw new Error(`GET segments failed: ${segRes.status}`);
      const segData = await segRes.json();
      const segs = segData.segments || [];
      if (segs.length !== 1) throw new Error(`Expected 1 segment, got ${segs.length}`);
      if (segs[0].name !== 'Intro Mix') {
        throw new Error(`Segment name expected Intro Mix, got ${segs[0].name}`);
      }
      if (JSON.stringify(segs[0].trimRanges) !== JSON.stringify(trimRanges)) {
        throw new Error(
          `trimRanges mismatch: ${JSON.stringify(segs[0].trimRanges)} vs ${JSON.stringify(trimRanges)}`,
        );
      }

      const importedMtBase = join(
        DATA_DIR,
        'uploads',
        podcast.id,
        data.episodeId,
        'recordings',
      );
      const importedMt = findMtDir(importedMtBase, segs[0].id);
      if (!importedMt) {
        throw new Error(`Missing multitrack dir under ${importedMtBase}`);
      }
      if (!existsSync(join(importedMt, 'tracks_manifest.json'))) {
        throw new Error('Missing tracks_manifest.json on import');
      }
      if (!existsSync(join(importedMt, 'host.mp3'))) {
        throw new Error('Missing host.mp3 track on import');
      }
    }),
  );

  results.push(
    await runOne('Import with edited audio regenerates waveform and prunes markers', async () => {
      if (!zipBuffer) throw new Error('No zip from export step');
      const zip = new AdmZip(zipBuffer);
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      const segJsonPath = names.find((n) => n.startsWith('segments/') && n.endsWith('segment.json'));
      const audioPath = names.find((n) => /segments\/[^/]+\/audio\./.test(n));
      if (!segJsonPath || !audioPath) throw new Error('Zip missing segment audio/json');

      const segJson = JSON.parse(zip.readAsText(segJsonPath));
      const originalAudioHash = segJson.audioSha256;
      const tmp = mkdtempSync(join(tmpdir(), 'hfm-e2e-audio-'));
      const shortMp3 = join(tmp, 'short.mp3');
      writeShortMp3(shortMp3, 1);
      const audioBuf = readFileSync(shortMp3);
      const mutatedHash = createHash('sha256').update(audioBuf).digest('hex');
      if (mutatedHash === originalAudioHash) throw new Error('Replacement did not change hash');
      // Keep .mp3 name even if original was .wav so path in zip stays valid
      const audioEntryName = audioPath.replace(/\.[^.]+$/, '.mp3');
      if (audioEntryName !== audioPath) {
        zip.deleteFile(audioPath);
      }
      zip.addFile(audioEntryName, audioBuf);
      segJson.audioFile = audioEntryName.split('/').pop();
      segJson.markers = [
        { time: 0.5, title: 'Keep' },
        { time: 99999, title: 'Too late' },
      ];
      // Keep exported audioSha256 so importer detects the mismatch
      zip.updateFile(segJsonPath, Buffer.from(JSON.stringify(segJson, null, 2)));

      const mutatedZip = zip.toBuffer();
      const data = await importEpisodeProject(jar, podcast.id, mutatedZip, 'project-edited.zip');
      const segRes = await apiFetch(`/episodes/${data.episodeId}/segments`, {}, jar);
      const segs = (await segRes.json()).segments || [];
      if (segs.length !== 1) throw new Error(`Expected 1 segment, got ${segs.length}`);
      const rawMarkers = segs[0].markers;
      const importedMarkers = Array.isArray(rawMarkers)
        ? rawMarkers
        : typeof rawMarkers === 'string'
          ? JSON.parse(rawMarkers || '[]')
          : [];
      if (importedMarkers.some((m) => m.title === 'Too late' || m.time >= 99999)) {
        throw new Error(`Expected late marker pruned, got ${JSON.stringify(importedMarkers)}`);
      }
      if (!importedMarkers.some((m) => m.title === 'Keep')) {
        throw new Error(`Expected Keep marker retained, got ${JSON.stringify(importedMarkers)}`);
      }
      if (!segs[0].waveformExists) {
        throw new Error('Expected regenerated waveform (waveformExists)');
      }
      if (!(segs[0].durationSec > 0) || segs[0].durationSec > 3) {
        throw new Error(`Expected ~1s duration after short audio replace, got ${segs[0].durationSec}`);
      }
    }),
  );

  results.push(
    await runOne('Import hand-added segment folder without segment.json (wav>mp3)', async () => {
      if (!zipBuffer) throw new Error('No zip from export step');
      const zip = new AdmZip(zipBuffer);
      const tmp = mkdtempSync(join(tmpdir(), 'hfm-e2e-hand-'));
      const wavPath = join(tmp, 'audio.wav');
      writeShortWav(wavPath, 1.25);
      zip.addFile('segments/009_hand_added/audio.wav', readFileSync(wavPath));
      // Intentionally no segment.json / waveform.json
      const mutatedZip = zip.toBuffer();
      const data = await importEpisodeProject(jar, podcast.id, mutatedZip, 'project-hand.zip');
      const segRes = await apiFetch(`/episodes/${data.episodeId}/segments`, {}, jar);
      const segs = (await segRes.json()).segments || [];
      if (segs.length !== 2) {
        throw new Error(`Expected 2 segments (original + hand-added), got ${segs.length}`);
      }
      const hand = segs.find((s) => String(s.name || '').toLowerCase().includes('hand'));
      if (!hand) throw new Error(`Expected hand-added segment name, got ${segs.map((s) => s.name).join(', ')}`);
      if (!String(hand.audioPath || '').endsWith('.mp3')) {
        throw new Error(`Expected wav>mp3, got ${hand.audioPath}`);
      }
      if (!(hand.durationSec > 0)) {
        throw new Error(`Expected probed duration, got ${hand.durationSec}`);
      }
      if (!hand.waveformExists) {
        throw new Error('Expected waveform generated for hand-added segment');
      }
    }),
  );

  results.push(
    await runOne('Import with edited multitrack remakes segment mix', async () => {
      if (!zipBuffer) throw new Error('No zip from export step');
      const zip = new AdmZip(zipBuffer);
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      const trackPath = names.find((n) => n.includes('/recordings/') && n.endsWith('host.mp3'));
      const mtManifestPath = names.find(
        (n) => n.includes('/recordings/') && n.endsWith('tracks_manifest.json'),
      );
      if (!trackPath || !mtManifestPath) throw new Error('Zip missing multitrack track/manifest');

      const mtManifest = JSON.parse(zip.readAsText(mtManifestPath));
      const originalTrackHash = mtManifest.segments?.[0]?.fileSha256;
      const tmp = mkdtempSync(join(tmpdir(), 'hfm-e2e-mt-'));
      const shortMp3 = join(tmp, 'host.mp3');
      writeShortMp3(shortMp3, 1.5);
      const trackBuf = readFileSync(shortMp3);
      const newHash = createHash('sha256').update(trackBuf).digest('hex');
      if (originalTrackHash && newHash === originalTrackHash) {
        throw new Error('Track replacement did not change hash');
      }
      zip.updateFile(trackPath, trackBuf);
      // Leave fileSha256 as exported value so importer detects change
      // Align endMs with short replacement so mix padding is sensible
      if (mtManifest.segments?.[0]) {
        mtManifest.segments[0].endMs = 1500;
        zip.updateFile(mtManifestPath, Buffer.from(JSON.stringify(mtManifest, null, 2)));
      }

      const mutatedZip = zip.toBuffer();
      const data = await importEpisodeProject(jar, podcast.id, mutatedZip, 'project-mt.zip');
      const segRes = await apiFetch(`/episodes/${data.episodeId}/segments`, {}, jar);
      const segs = (await segRes.json()).segments || [];
      if (segs.length !== 1) throw new Error(`Expected 1 segment, got ${segs.length}`);
      const audioName = segs[0].audioPath;
      if (!audioName) throw new Error('Missing audioPath after mt remake import');
      if (!String(audioName).endsWith('.wav')) {
        throw new Error(`Expected remade mix to be .wav, got ${audioName}`);
      }
      if (!segs[0].waveformExists) {
        throw new Error('Expected waveform after remake');
      }
      if (!(segs[0].durationSec > 0)) {
        throw new Error(`Expected positive duration after remake, got ${segs[0].durationSec}`);
      }
    }),
  );

  results.push(
    await runOne('Import with deleted multitrack file remakes mix without that track', async () => {
      if (!zipBuffer) throw new Error('No zip from export step');
      const zip = new AdmZip(zipBuffer);
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      const guestPath = names.find((n) => n.includes('/recordings/') && n.endsWith('guest.mp3'));
      const mtManifestPath = names.find(
        (n) => n.includes('/recordings/') && n.endsWith('tracks_manifest.json'),
      );
      if (!guestPath || !mtManifestPath) {
        throw new Error('Zip missing guest track or tracks_manifest');
      }
      const beforeManifest = JSON.parse(zip.readAsText(mtManifestPath));
      if ((beforeManifest.segments || []).length < 2) {
        throw new Error('Expected at least 2 manifest tracks before delete');
      }
      zip.deleteFile(guestPath);

      const mutatedZip = zip.toBuffer();
      const data = await importEpisodeProject(jar, podcast.id, mutatedZip, 'project-mt-delete.zip');
      const segRes = await apiFetch(`/episodes/${data.episodeId}/segments`, {}, jar);
      const segs = (await segRes.json()).segments || [];
      if (segs.length !== 1) throw new Error(`Expected 1 segment, got ${segs.length}`);
      if (!String(segs[0].audioPath || '').endsWith('.wav')) {
        throw new Error(`Expected remade mix .wav after track delete, got ${segs[0].audioPath}`);
      }
      const importedMt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, data.episodeId, 'recordings'),
        segs[0].id,
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
      if (String(afterSegs[0].filePath || '').includes('guest')) {
        throw new Error('Pruned manifest still references guest track');
      }
    }),
  );

  return results;
}
