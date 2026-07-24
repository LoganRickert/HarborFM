import { createRequire } from 'module';
import { createHash } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, readdirSync, statSync, unlinkSync } from 'fs';
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
  importSegmentProjectExpectFail,
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

function writeToneMp3(outPath, durationSec, freqHz = 440) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${freqHz}:sample_rate=48000:duration=${durationSec}`,
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '9',
      outPath,
    ],
    { stdio: 'ignore' },
  );
}

/** POST host-ducking (202) and poll until done. */
async function setHostDucking(jar, episodeId, segmentId, enabled) {
  const start = await apiFetch(
    `/episodes/${episodeId}/segments/${segmentId}/host-ducking`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
    jar,
  );
  if (start.status !== 202 && start.status !== 409) {
    throw new Error(
      `Host ducking start expected 202, got ${start.status} ${await start.text()}`,
    );
  }
  const deadline = Date.now() + 120000;
  for (;;) {
    const res = await apiFetch(
      `/episodes/${episodeId}/segments/${segmentId}/host-ducking/status`,
      {},
      jar,
    );
    if (!res.ok) {
      throw new Error(`Host ducking status failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    if (data.status === 'done' || data.status === 'idle') return data;
    if (data.status === 'failed') {
      throw new Error(data.error || 'Host ducking remake failed');
    }
    if (data.status !== 'remaking') {
      throw new Error(`Unexpected host ducking status: ${data.status}`);
    }
    if (Date.now() > deadline) {
      throw new Error('Timeout polling host ducking status');
    }
    await new Promise((r) => setTimeout(r, 400));
  }
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

  /** Restore host+guest full takes after tests that delete tracks or apply OTIO/RPP cuts. */
  function replantFullMultitrack() {
    const activeMt = findMtDir(recordingsBase, seg.id) || mtDir;
    mkdirSync(activeMt, { recursive: true });
    writeFileSync(join(activeMt, 'host.mp3'), readFileSync(testDataMp3()));
    writeFileSync(join(activeMt, 'guest.mp3'), readFileSync(testDataMp3()));
    writeFileSync(
      join(activeMt, 'tracks_manifest.json'),
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
    // Drop stale DAW backup so the next OTIO/Reaper apply can snapshot this layout.
    const originalPath = join(activeMt, 'tracks_manifest.json.original');
    if (existsSync(originalPath)) {
      unlinkSync(originalPath);
    }
  }

  replantFullMultitrack();

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
    await runOne('Import Segment applies changed timeline sidecar and remakes mix', async () => {
      if (!zipBuffer) throw new Error('No zip from export');
      // Fresh export so segment.rpp + hashes match planted multitrack again.
      const exportRes = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/project-export`,
        {},
        jar,
      );
      if (exportRes.status !== 200) {
        throw new Error(`Re-export failed: ${exportRes.status} ${await exportRes.text()}`);
      }
      const freshZip = new AdmZip(Buffer.from(await exportRes.arrayBuffer()));
      const names = freshZip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      const rppPath = names.find((n) => n === 'segment/segment.rpp');
      if (!rppPath) throw new Error('Export missing segment/segment.rpp');
      const segJson = JSON.parse(freshZip.readAsText('segment/segment.json'));
      if (!segJson.segmentRppSha256) {
        throw new Error('segment.json missing segmentRppSha256');
      }
      const segBeforeRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const segsBefore = ((await segBeforeRes.json()).segments || []).find((s) => s.id === seg.id);
      const durationBefore = segsBefore?.durationSec ?? 0;

      let rppText = freshZip.readAsText(rppPath);
      // Shift first POSITION so layout changes without touching track bytes.
      if (!/POSITION\s+[\d.]+/.test(rppText)) {
        throw new Error('segment.rpp missing POSITION');
      }
      rppText = rppText.replace(/POSITION\s+[\d.]+/, 'POSITION 5');
      // Lower the first track fader (linear amp) so import writes manifest volume.
      if (!/VOLPAN\s+[\d.eE+-]+/.test(rppText)) {
        throw new Error('segment.rpp missing VOLPAN');
      }
      rppText = rppText.replace(/VOLPAN\s+[\d.eE+-]+/, 'VOLPAN 0.25');
      // Duplicate host item later on the timeline (same FILE, different POSITION).
      const hostItemMatch = rppText.match(
        /<ITEM[\s\S]*?FILE "recordings\/host\.mp3"[\s\S]*?>\s*>/,
      );
      if (hostItemMatch) {
        const dup = hostItemMatch[0]
          .replace(/POSITION\s+[\d.]+/, 'POSITION 8')
          .replace(/LENGTH\s+[\d.]+/, 'LENGTH 1');
        rppText = rppText.replace(hostItemMatch[0], `${hostItemMatch[0]}\n${dup}`);
      }
      freshZip.updateFile(rppPath, Buffer.from(rppText, 'utf8'));
      const newHash = createHash('sha256').update(rppText, 'utf8').digest('hex');
      if (newHash === segJson.segmentRppSha256) {
        throw new Error('Mutated segment.rpp hash did not change');
      }

      const mutatedZip = freshZip.toBuffer();
      await importSegmentProject(jar, episode.id, seg.id, mutatedZip, 'segment-timeline.zip');
      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (segRes.status !== 200) {
        throw new Error(`GET segments after timeline import failed: ${segRes.status}`);
      }
      const data = ((await segRes.json()).segments || []).find((s) => s.id === seg.id);
      if (!data) throw new Error('Segment missing after timeline import');
      if (!String(data.audioPath || '').endsWith('.wav')) {
        throw new Error(`Expected remade mix .wav after timeline apply, got ${data.audioPath}`);
      }
      if (!(data.durationSec > durationBefore + 2)) {
        throw new Error(
          `Expected longer mix after POSITION shift (before ${durationBefore}, after ${data.durationSec})`,
        );
      }
      const importedMt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!importedMt) throw new Error('Missing multitrack dir after timeline import');
      const afterManifest = JSON.parse(
        readFileSync(join(importedMt, 'tracks_manifest.json'), 'utf8'),
      );
      const afterSegs = afterManifest.segments || [];
      if (afterSegs.length < 2) {
        throw new Error(`Expected rebuilt manifest with clips, got ${afterSegs.length}`);
      }
      const starts = afterSegs.map((s) => s.startMs || 0);
      if (!starts.some((ms) => ms >= 4000)) {
        throw new Error(`Expected a clip startMs >= 4000 from POSITION 5, got ${starts.join(',')}`);
      }
      const volumes = afterSegs.map((s) => s.volume).filter((v) => v != null);
      if (!volumes.some((v) => Math.abs(v - 0.25) < 0.001)) {
        throw new Error(
          `Expected a clip volume ≈ 0.25 from track VOLPAN, got ${JSON.stringify(volumes)}`,
        );
      }
    }),
  );

  results.push(
    await runOne('Import Segment rejects timeline media path escape', async () => {
      if (!zipBuffer) throw new Error('No zip from export');
      const exportRes = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/project-export`,
        {},
        jar,
      );
      if (exportRes.status !== 200) {
        throw new Error(`Re-export failed: ${exportRes.status}`);
      }
      const zip = new AdmZip(Buffer.from(await exportRes.arrayBuffer()));
      const rppPath = 'segment/segment.rpp';
      if (!zip.getEntry(rppPath)) throw new Error('Missing segment.rpp');
      const badRpp = `<REAPER_PROJECT 0.1 "HarborFM" 0
  <TRACK
    NAME "Evil_0"
    NCHAN 1
    <ITEM
      POSITION 0
      LENGTH 1
      SOFFS 0
      <SOURCE MP3
        FILE "../escape.mp3"
      >
    >
  >
>
`;
      zip.updateFile(rppPath, Buffer.from(badRpp, 'utf8'));
      const message = await importSegmentProjectExpectFail(
        jar,
        episode.id,
        seg.id,
        zip.toBuffer(),
        'segment-escape.zip',
      );
      const lower = String(message || '').toLowerCase();
      if (!lower.includes('leaves the segment folder') && !lower.includes('escape')) {
        throw new Error(`Expected path escape rejection, got ${message}`);
      }
    }),
  );

  results.push(
    await runOne('Import Segment ignores unreadable segment.rpp and remakes from manifest', async () => {
      if (!zipBuffer) throw new Error('No zip from export');
      const exportRes = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/project-export`,
        {},
        jar,
      );
      if (exportRes.status !== 200) {
        throw new Error(`Re-export failed: ${exportRes.status}`);
      }
      const zip = new AdmZip(Buffer.from(await exportRes.arrayBuffer()));
      const rppPath = 'segment/segment.rpp';
      if (!zip.getEntry(rppPath)) throw new Error('Missing segment.rpp');
      // Unreadable Reaper project: import should ignore it and use tracks_manifest.
      zip.updateFile(rppPath, Buffer.from('NOT_A_REAPER_PROJECT {{{ invalid', 'utf8'));
      const importResult = await importSegmentProject(
        jar,
        episode.id,
        seg.id,
        zip.toBuffer(),
        'segment-bad-rpp.zip',
      );
      if (!String(importResult?.warning || '').toLowerCase().includes('reaper')) {
        throw new Error(
          `Expected Reaper ignored warning after bad segment.rpp, got ${JSON.stringify(importResult)}`,
        );
      }
      const importedMt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!importedMt) throw new Error('Missing multitrack dir after bad-rpp import');
      const afterManifest = JSON.parse(
        readFileSync(join(importedMt, 'tracks_manifest.json'), 'utf8'),
      );
      const afterSegs = afterManifest.segments || [];
      if (afterSegs.length < 1) {
        throw new Error('Expected tracks_manifest segments after ignoring bad segment.rpp');
      }
      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const data = ((await segRes.json()).segments || []).find((s) => s.id === seg.id);
      if (!data) throw new Error('Segment missing after bad-rpp import');
      if (!String(data.audioPath || '').endsWith('.wav')) {
        throw new Error(`Expected remade mix .wav from manifest fallback, got ${data.audioPath}`);
      }
    }),
  );

  results.push(
    await runOne('Import Segment accepts Windows backslash media paths in segment.rpp', async () => {
      if (!zipBuffer) throw new Error('No zip from export');
      const exportRes = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/project-export`,
        {},
        jar,
      );
      if (exportRes.status !== 200) {
        throw new Error(`Re-export failed: ${exportRes.status}`);
      }
      const zip = new AdmZip(Buffer.from(await exportRes.arrayBuffer()));
      const rppPath = 'segment/segment.rpp';
      if (!zip.getEntry(rppPath)) throw new Error('Missing segment.rpp');
      let rppText = zip.readAsText(rppPath);
      if (!rppText.includes('FILE "recordings/')) {
        throw new Error('segment.rpp missing recordings FILE path');
      }
      // Reaper on Windows writes FILE "recordings\host.mp3"
      rppText = rppText.replace(/FILE "recordings\//g, 'FILE "recordings\\');
      if (!rppText.includes('recordings\\')) {
        throw new Error('Failed to inject Windows backslash paths');
      }
      zip.updateFile(rppPath, Buffer.from(rppText, 'utf8'));
      await importSegmentProject(jar, episode.id, seg.id, zip.toBuffer(), 'segment-win-paths.zip');
      const importedMt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!importedMt) throw new Error('Missing multitrack dir after Windows-path import');
      const afterManifest = JSON.parse(
        readFileSync(join(importedMt, 'tracks_manifest.json'), 'utf8'),
      );
      if (!(afterManifest.segments || []).length) {
        throw new Error('Expected rebuilt manifest after Windows-path segment.rpp');
      }
    }),
  );

  results.push(
    await runOne('Import Segment applies Resolve-style timeline.otio and remakes mix', async () => {
      // Prior tests may have deleted guest.mp3; OTIO fixture needs both takes.
      replantFullMultitrack();

      const exportRes = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/project-export`,
        {},
        jar,
      );
      if (exportRes.status !== 200) {
        throw new Error(`Re-export failed: ${exportRes.status} ${await exportRes.text()}`);
      }
      const zip = new AdmZip(Buffer.from(await exportRes.arrayBuffer()));
      const otioPath = 'segment/timeline.otio';
      if (!zip.getEntry(otioPath)) throw new Error('Export missing segment/timeline.otio');
      const segJson = JSON.parse(zip.readAsText('segment/segment.json'));
      if (!segJson.timelineOtioSha256) {
        throw new Error('segment.json missing timelineOtioSha256');
      }
      if (!zip.getEntry('segment/recordings/host.mp3')) {
        throw new Error('Export missing recordings/host.mp3');
      }
      if (!zip.getEntry('segment/recordings/guest.mp3')) {
        throw new Error('Export missing recordings/guest.mp3');
      }

      // Resolve-shaped OTIO: 24 fps, Video track skipped, Windows absolute media path,
      // gap + trimmed clips from the same source.
      const rate = 24;
      const rt = (value) => ({
        OTIO_SCHEMA: 'RationalTime.1',
        rate,
        value,
      });
      const tr = (startFrames, durFrames) => ({
        OTIO_SCHEMA: 'TimeRange.1',
        start_time: rt(startFrames),
        duration: rt(durFrames),
      });
      const winHost =
        'C:\\Users\\editor\\Documents\\resolve\\recordings\\host.mp3';
      const resolveOtio = {
        OTIO_SCHEMA: 'Timeline.1',
        name: 'Resolve edit',
        global_start_time: null,
        metadata: {},
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Video 1',
              kind: 'Video',
              children: [],
              effects: [],
              markers: [],
              metadata: {},
              source_range: null,
              enabled: true,
            },
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Host_0',
              kind: 'Audio',
              children: [
                {
                  OTIO_SCHEMA: 'Gap.1',
                  name: '',
                  source_range: tr(0, 24), // 1.0s
                  effects: [],
                  markers: [],
                  metadata: {},
                  enabled: true,
                },
                {
                  OTIO_SCHEMA: 'Clip.2',
                  name: 'host.mp3',
                  source_range: tr(24, 48), // in at 1s, play 2s
                  effects: [],
                  markers: [],
                  metadata: {},
                  media_references: {
                    DEFAULT_MEDIA: {
                      OTIO_SCHEMA: 'ExternalReference.1',
                      name: 'host.mp3',
                      target_url: winHost,
                      available_range: tr(0, 480),
                      metadata: {},
                    },
                  },
                  active_media_reference_key: 'DEFAULT_MEDIA',
                  enabled: true,
                },
                {
                  OTIO_SCHEMA: 'Clip.2',
                  name: 'host.mp3',
                  source_range: tr(96, 24), // in at 4s, play 1s
                  effects: [],
                  markers: [],
                  metadata: {},
                  media_references: {
                    DEFAULT_MEDIA: {
                      OTIO_SCHEMA: 'ExternalReference.1',
                      name: 'host.mp3',
                      target_url: winHost,
                      available_range: tr(0, 480),
                      metadata: {},
                    },
                  },
                  active_media_reference_key: 'DEFAULT_MEDIA',
                  enabled: true,
                },
              ],
              effects: [],
              markers: [],
              metadata: {},
              source_range: null,
              enabled: true,
            },
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Guest_0',
              kind: 'Audio',
              children: [
                {
                  OTIO_SCHEMA: 'Clip.2',
                  name: 'guest.mp3',
                  source_range: tr(0, 36), // 1.5s from start
                  effects: [],
                  markers: [],
                  metadata: {},
                  media_references: {
                    DEFAULT_MEDIA: {
                      OTIO_SCHEMA: 'ExternalReference.1',
                      name: 'guest.mp3',
                      target_url:
                        'D:\\Projects\\show\\recordings\\guest.mp3',
                      available_range: tr(0, 480),
                      metadata: {},
                    },
                  },
                  active_media_reference_key: 'DEFAULT_MEDIA',
                  enabled: true,
                },
              ],
              effects: [],
              markers: [],
              metadata: {},
              source_range: null,
              enabled: true,
            },
          ],
          effects: [],
          markers: [],
          metadata: {},
          source_range: null,
          enabled: true,
        },
      };
      // Host lane: 1s gap + 2s + 1s = 4s timeline end.
      const expectedTimelineSec = 4;

      const otioText = `${JSON.stringify(resolveOtio, null, 2)}\n`;
      const newHash = createHash('sha256').update(otioText, 'utf8').digest('hex');
      if (newHash === segJson.timelineOtioSha256) {
        throw new Error('Mutated timeline.otio hash did not change');
      }
      zip.updateFile(otioPath, Buffer.from(otioText, 'utf8'));

      await importSegmentProject(jar, episode.id, seg.id, zip.toBuffer(), 'segment-otio.zip');
      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (segRes.status !== 200) {
        throw new Error(`GET segments after OTIO import failed: ${segRes.status}`);
      }
      const data = ((await segRes.json()).segments || []).find((s) => s.id === seg.id);
      if (!data) throw new Error('Segment missing after OTIO import');
      if (!String(data.audioPath || '').endsWith('.wav')) {
        throw new Error(`Expected remade mix .wav after OTIO apply, got ${data.audioPath}`);
      }
      if (!(data.durationSec > expectedTimelineSec - 0.75 && data.durationSec < expectedTimelineSec + 1.5)) {
        throw new Error(
          `Expected remade mix ~${expectedTimelineSec}s from OTIO timeline, got ${data.durationSec}`,
        );
      }

      const importedMt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!importedMt) throw new Error('Missing multitrack dir after OTIO import');
      const afterManifest = JSON.parse(
        readFileSync(join(importedMt, 'tracks_manifest.json'), 'utf8'),
      );
      const afterSegs = afterManifest.segments || [];
      if (afterSegs.length < 3) {
        throw new Error(`Expected >=3 clips from Resolve OTIO, got ${afterSegs.length}`);
      }
      const hostClips = afterSegs.filter(
        (s) => String(s.filePath || '').includes('host') || s.participantName === 'Host_0',
      );
      if (hostClips.length < 2) {
        throw new Error(`Expected multiple host clips from OTIO slices, got ${hostClips.length}`);
      }
      const starts = hostClips.map((s) => s.startMs || 0).sort((a, b) => a - b);
      if (starts[0] < 900 || starts[0] > 1100) {
        throw new Error(`Expected first host clip after 1s gap (~1000ms), got ${starts[0]}`);
      }
      const withOffset = hostClips.find((s) => (s.sourceOffsetMs || 0) >= 900);
      if (!withOffset) {
        throw new Error(
          `Expected a host clip with sourceOffsetMs from 24fps source_range, got ${JSON.stringify(
            hostClips.map((s) => s.sourceOffsetMs),
          )}`,
        );
      }
      const lengths = hostClips.map((s) => s.lengthMs).filter((v) => v != null);
      if (!lengths.some((ms) => ms >= 1900 && ms <= 2100)) {
        throw new Error(`Expected a ~2000ms host clip length, got ${JSON.stringify(lengths)}`);
      }
    }),
  );

  results.push(
    await runOne('Host ducking enable remakes mix and writes host_ducking.json', async () => {
      // OTIO/RPP tests leave sliced manifests; ducking expects full takes again.
      replantFullMultitrack();

      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (segRes.status !== 200) throw new Error(`GET segments failed: ${segRes.status}`);
      const before = ((await segRes.json()).segments || []).find((s) => s.id === seg.id);
      if (!before?.hasRecordings) {
        throw new Error('Expected hasRecordings true for planted multitrack segment');
      }
      if (before.hostDuckingEnabled) {
        await setHostDucking(jar, episode.id, seg.id, false);
      }

      await setHostDucking(jar, episode.id, seg.id, false);
      const uploadsDir = join(DATA_DIR, 'uploads', podcast.id, episode.id);
      const mixWav = join(uploadsDir, `${seg.id}.wav`);
      const unduckedSha = existsSync(mixWav)
        ? createHash('sha256').update(readFileSync(mixWav)).digest('hex')
        : null;

      await setHostDucking(jar, episode.id, seg.id, true);
      const afterRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (afterRes.status !== 200) throw new Error(`GET segments after ducking failed: ${afterRes.status}`);
      const updated = ((await afterRes.json()).segments || []).find((s) => s.id === seg.id);
      if (!updated?.hostDuckingEnabled) {
        throw new Error('Expected hostDuckingEnabled true after enable');
      }
      if (!String(updated.audioPath || '').endsWith('.wav')) {
        throw new Error(`Expected remade .wav after enabling ducking, got ${updated.audioPath}`);
      }
      const mt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!mt) throw new Error('Missing multitrack dir after ducking enable');
      if (!existsSync(join(mt, 'host_ducking.json'))) {
        throw new Error('Expected host_ducking.json after enabling ducking');
      }
      const ducking = JSON.parse(readFileSync(join(mt, 'host_ducking.json'), 'utf8'));
      if (ducking.version !== 1 || !Array.isArray(ducking.tracks)) {
        throw new Error('Invalid host_ducking.json shape');
      }
      const duckedSha = existsSync(mixWav)
        ? createHash('sha256').update(readFileSync(mixWav)).digest('hex')
        : null;
      const hasMutes = (ducking.tracks || []).some(
        (t) => Array.isArray(t.mute) && t.mute.length > 0,
      );
      if (unduckedSha && duckedSha && unduckedSha === duckedSha && hasMutes) {
        throw new Error('Expected ducked mix to differ from unducked when mutes exist');
      }
    }),
  );

  results.push(
    await runOne('Download Segment includes host_ducking.json and gated RPP ITEMs', async () => {
      const mt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!mt) throw new Error('Missing multitrack dir before ducked export');
      // Ensure a mid-take mute so gated export emits multiple ITEMs for host.
      writeFileSync(
        join(mt, 'host_ducking.json'),
        JSON.stringify(
          {
            version: 1,
            silenceThreshold: 12,
            minSilenceSec: 2,
            tracks: [
              {
                segmentId: 'host-clip',
                filePath: 'host.mp3',
                participantName: 'Host',
                mute: [[1.0, Math.min(3, Math.max(1.5, durationSec - 1))]],
              },
              {
                segmentId: 'guest-clip',
                filePath: 'guest.mp3',
                participantName: 'Guest',
                mute: [],
              },
            ],
          },
          null,
          2,
        ),
      );

      const exportRes = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/project-export`,
        {},
        jar,
      );
      if (exportRes.status !== 200) {
        throw new Error(`Export failed: ${exportRes.status} ${await exportRes.text()}`);
      }
      const zip = new AdmZip(Buffer.from(await exportRes.arrayBuffer()));
      const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      if (!names.includes('segment/host_ducking.json')) {
        throw new Error('Export missing segment/host_ducking.json');
      }
      const segJson = JSON.parse(zip.readAsText('segment/segment.json'));
      if (!segJson.hostDuckingEnabled) {
        throw new Error('segment.json expected hostDuckingEnabled true');
      }
      const rpp = zip.readAsText('segment/segment.rpp');
      const hostItems = (rpp.match(/FILE\s+"[^"]*host\.mp3"/g) || []).length;
      if (hostItems < 2) {
        throw new Error(
          `Expected multiple RPP ITEMs for ducked host.mp3, found ${hostItems}`,
        );
      }
    }),
  );

  results.push(
    await runOne('Host ducking disable remakes without exclusive gates flag', async () => {
      await setHostDucking(jar, episode.id, seg.id, false);
      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (segRes.status !== 200) throw new Error(`GET segments after disable failed: ${segRes.status}`);
      const updated = ((await segRes.json()).segments || []).find((s) => s.id === seg.id);
      if (updated?.hostDuckingEnabled) {
        throw new Error('Expected hostDuckingEnabled false after disable');
      }
    }),
  );

  results.push(
    await runOne('Host ducking does not silence mix after short join with inflated endMs', async () => {
      const mt = findMtDir(
        join(DATA_DIR, 'uploads', podcast.id, episode.id, 'recordings'),
        seg.id,
      );
      if (!mt) throw new Error('Missing multitrack dir for short-join ducking test');

      const longDur = 8;
      const shortDur = 2;
      const inflatedEndMs = longDur * 1000;
      writeToneMp3(join(mt, 'long-host.mp3'), longDur, 440);
      writeToneMp3(join(mt, 'short-join.mp3'), shortDur, 880);
      // Drop prior fixture tracks so remake uses only these.
      writeFileSync(
        join(mt, 'tracks_manifest.json'),
        JSON.stringify({
          recordingEpochMs: epoch,
          sessionStartedAtEpochMs: epoch,
          episodeId: episode.id,
          podcastId: podcast.id,
          segments: [
            {
              segmentId: 'long-host',
              producerId: 'host',
              participantName: 'Host',
              startMs: 0,
              endMs: inflatedEndMs,
              filePath: 'long-host.mp3',
              codec: 'libmp3lame',
            },
            {
              segmentId: 'short-join',
              producerId: 'guest',
              participantName: 'BriefGuest',
              startMs: 0,
              // Inflated like a leave that never updated endMs.
              endMs: inflatedEndMs,
              filePath: 'short-join.mp3',
              codec: 'libmp3lame',
            },
          ],
        }),
      );

      await setHostDucking(jar, episode.id, seg.id, true);

      const ducking = JSON.parse(readFileSync(join(mt, 'host_ducking.json'), 'utf8'));
      const shortTrack = (ducking.tracks || []).find((t) => t.filePath === 'short-join.mp3');
      if (!shortTrack) throw new Error('Expected short-join in host_ducking.json');
      // Short join must not hold exclusive floor past its real media end (~2s).
      const mutePastShort = (ducking.tracks || [])
        .filter((t) => t.filePath === 'long-host.mp3')
        .flatMap((t) => t.mute || [])
        .some(([s, e]) => s < shortDur + 0.5 && e > shortDur + 1.5);
      if (mutePastShort) {
        throw new Error(
          `Long host muted well after short join ended: ${JSON.stringify(ducking.tracks)}`,
        );
      }

      const segRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      const updated = ((await segRes.json()).segments || []).find((s) => s.id === seg.id);
      if (!updated?.hostDuckingEnabled) {
        throw new Error('Expected hostDuckingEnabled after short-join remake');
      }
      if (!(updated.durationSec > shortDur + 2)) {
        throw new Error(
          `Expected mix duration near ${longDur}s after ducking, got ${updated.durationSec}`,
        );
      }

      const segmentsDir = join(DATA_DIR, 'uploads', podcast.id, episode.id, 'segments');
      const wavNames = existsSync(segmentsDir)
        ? readdirSync(segmentsDir).filter((n) => n.endsWith('.wav'))
        : [];
      const mixWav = wavNames
        .map((n) => join(segmentsDir, n))
        .sort((a, b) => {
          try {
            return statSync(b).mtimeMs - statSync(a).mtimeMs;
          } catch {
            return 0;
          }
        })[0];
      if (!mixWav || !existsSync(mixWav)) {
        throw new Error(`Missing remade mix wav under ${segmentsDir}`);
      }

      // After short join ends, mix should still have audible energy (long host unmuted).
      const midWav = join(mt, '_e2e_mid_slice.wav');
      execFileSync(
        'ffmpeg',
        ['-y', '-ss', '3', '-t', '2', '-i', mixWav, '-c:a', 'pcm_s16le', midWav],
        { stdio: 'ignore' },
      );
      // argv form (no shell): volumedetect prints mean_volume on stderr.
      const volRun = spawnSync(
        'ffmpeg',
        ['-i', midWav, '-af', 'volumedetect', '-f', 'null', '-'],
        { encoding: 'utf8' },
      );
      const volOut = `${volRun.stdout || ''}${volRun.stderr || ''}${volRun.error?.message || ''}`;
      const meanMatch = /mean_volume:\s*([-\d.]+)\s*dB/.exec(volOut);
      if (!meanMatch) {
        throw new Error(`volumedetect missing mean_volume in: ${volOut.slice(0, 400)}`);
      }
      const meanDb = Number(meanMatch[1]);
      if (!(meanDb > -50)) {
        throw new Error(
          `Expected audible audio after short join (mean_volume > -50 dB), got ${meanDb}`,
        );
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
