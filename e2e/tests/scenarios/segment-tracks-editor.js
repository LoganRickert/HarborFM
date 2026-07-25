import { existsSync, statSync } from 'fs';
import { join } from 'path';
import {
  apiFetch,
  completeSetup,
  loginAsAdmin,
  createShow,
  createEpisode,
  addRecordedSegment,
  plantSegmentMultitrack,
  findSegmentMultitrackDir,
  getSegmentTracks,
  saveSegmentTracks,
  remakeSegmentTracks,
  uploadSegmentTrackMedia,
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
    title: 'E2E Tracks Editor Show',
    slug: `e2e-tracks-ed-${Date.now()}`,
  });
  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Tracks Editor Ep',
    status: 'draft',
  });
  const seg = await addRecordedSegment(jar, episode.id);
  const durationSec = seg.durationSec ?? 10;
  const planted = plantSegmentMultitrack({
    podcastId: podcast.id,
    episodeId: episode.id,
    segmentId: seg.id,
    durationSec,
  });

  results.push(
    await runOne('GET .../tracks returns clips and takes', async () => {
      const data = await getSegmentTracks(jar, episode.id, seg.id);
      if (!Array.isArray(data.clips) || data.clips.length < 2) {
        throw new Error(`Expected >=2 clips, got ${data.clips?.length}`);
      }
      if (!Array.isArray(data.takes) || data.takes.length < 2) {
        throw new Error(`Expected >=2 takes, got ${data.takes?.length}`);
      }
      if (!(data.timelineDurationMs > 0)) {
        throw new Error(`Expected timelineDurationMs > 0, got ${data.timelineDurationMs}`);
      }
      const files = new Set(data.takes.map((t) => t.filePath));
      if (!files.has('host.mp3') || !files.has('guest.mp3')) {
        throw new Error(`Expected host.mp3 and guest.mp3 takes, got ${[...files].join(',')}`);
      }
    }),
  );

  results.push(
    await runOne('PUT .../tracks blade-style split persists and backs up original', async () => {
      const before = await getSegmentTracks(jar, episode.id, seg.id);
      const host = before.clips.find((c) => (c.filePath || '').endsWith('host.mp3'));
      if (!host) throw new Error('host clip missing');
      const startMs = typeof host.startMs === 'number' ? host.startMs : 0;
      const endMs =
        typeof host.endMs === 'number' && host.endMs > startMs
          ? host.endMs
          : startMs + (host.lengthMs || planted.endMs);
      const mid = startMs + Math.floor((endMs - startMs) / 2);
      if (mid <= startMs + 1 || mid >= endMs - 1) {
        throw new Error('Clip too short to split for test');
      }
      const left = {
        ...host,
        segmentId: host.segmentId || 'host-clip-left',
        startMs,
        endMs: mid,
        lengthMs: mid - startMs,
        sourceOffsetMs: host.sourceOffsetMs || 0,
      };
      const right = {
        ...host,
        segmentId: 'host-clip-right',
        startMs: mid,
        endMs,
        lengthMs: endMs - mid,
        sourceOffsetMs: (host.sourceOffsetMs || 0) + (mid - startMs),
      };
      const rebuilt = [];
      let splitDone = false;
      for (const c of before.clips) {
        const isHost =
          !splitDone &&
          (c.filePath || '').endsWith('host.mp3') &&
          c.segmentId === host.segmentId;
        if (isHost) {
          rebuilt.push(left, right);
          splitDone = true;
        } else {
          rebuilt.push(c);
        }
      }
      if (!splitDone) throw new Error('Failed to locate host clip for split');
      const saved = await saveSegmentTracks(jar, episode.id, seg.id, rebuilt);
      if (!saved.originalBackedUp) {
        throw new Error('Expected originalBackedUp true on first save');
      }
      if (!Array.isArray(saved.clips) || saved.clips.length !== before.clips.length + 1) {
        throw new Error(
          `Expected ${before.clips.length + 1} clips after split, got ${saved.clips?.length}`,
        );
      }
      const mtDir =
        findSegmentMultitrackDir(podcast.id, episode.id, seg.id) || planted.mtDir;
      const originalPath = join(mtDir, 'tracks_manifest.json.original');
      if (!existsSync(originalPath)) {
        throw new Error('Expected tracks_manifest.json.original after first save');
      }
      const again = await getSegmentTracks(jar, episode.id, seg.id);
      if (again.clips.length !== saved.clips.length) {
        throw new Error('GET tracks clip count mismatch after save');
      }
      // Second save should not claim another first-time backup
      const saved2 = await saveSegmentTracks(jar, episode.id, seg.id, again.clips);
      if (saved2.originalBackedUp) {
        throw new Error('Expected originalBackedUp false when .original already exists');
      }
    }),
  );

  results.push(
    await runOne('PATCH trimRanges persists alongside tracks layout', async () => {
      const trimRanges = [[0.5, Math.min(2, durationSec - 0.1)]];
      const res = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trimRanges, name: 'Tracks Editor Intro' }),
        },
        jar,
      );
      if (res.status !== 200) {
        throw new Error(`PATCH segment failed: ${res.status} ${await res.text()}`);
      }
      const patched = await res.json();
      if (JSON.stringify(patched.trimRanges) !== JSON.stringify(trimRanges)) {
        throw new Error(
          `trimRanges mismatch: ${JSON.stringify(patched.trimRanges)} vs ${JSON.stringify(trimRanges)}`,
        );
      }
    }),
  );

  results.push(
    await runOne('POST .../tracks/remake completes after save', async () => {
      const mtDir =
        findSegmentMultitrackDir(podcast.id, episode.id, seg.id) || planted.mtDir;
      // Segment mix file lives next to the upload; remake rewrites segment audio under uploads.
      const beforeTracks = await getSegmentTracks(jar, episode.id, seg.id);
      await saveSegmentTracks(jar, episode.id, seg.id, beforeTracks.clips);
      const status = await remakeSegmentTracks(jar, episode.id, seg.id);
      if (status.status !== 'done') {
        throw new Error(`Expected remake done, got ${JSON.stringify(status)}`);
      }
      // Mix path: segment audio is stored as uploads/.../segments or similar; assert list still ok.
      const after = await getSegmentTracks(jar, episode.id, seg.id);
      if (!after.clips?.length) throw new Error('Clips missing after remake');
      void mtDir;
    }),
  );

  results.push(
    await runOne('POST .../tracks/media upload adds take file', async () => {
      const media = await uploadSegmentTrackMedia(jar, episode.id, seg.id, {
        trackName: 'Bed Track',
        filename: 'import-bed.mp3',
      });
      if (!media.filePath || !(media.durationMs > 0)) {
        throw new Error(`Unexpected media payload: ${JSON.stringify(media)}`);
      }
      const mtDir =
        findSegmentMultitrackDir(podcast.id, episode.id, seg.id) || planted.mtDir;
      const abs = join(mtDir, media.filePath.replace(/\\/g, '/').split('/').pop());
      if (!existsSync(abs)) {
        throw new Error(`Uploaded take missing on disk: ${abs}`);
      }
      const tracks = await getSegmentTracks(jar, episode.id, seg.id);
      const startMs = 0;
      const lengthMs = Math.max(1, media.durationMs);
      const clip = {
        segmentId: `import_${Date.now().toString(36)}`,
        filePath: media.filePath,
        startMs,
        lengthMs,
        endMs: startMs + lengthMs,
        sourceOffsetMs: 0,
        participantName: media.participantName || 'Bed Track',
        volume: 1,
        muted: false,
        source: 'import',
      };
      await saveSegmentTracks(jar, episode.id, seg.id, [...tracks.clips, clip]);
      const after = await getSegmentTracks(jar, episode.id, seg.id);
      const takeFiles = after.takes.map((t) => t.filePath);
      const base = media.filePath.replace(/\\/g, '/').split('/').pop();
      if (!takeFiles.some((f) => f === media.filePath || f === base || f.endsWith(base))) {
        throw new Error(`New take not listed: ${takeFiles.join(',')}`);
      }
    }),
  );

  results.push(
    await runOne('GET .../tracks/waveform and stream for take file', async () => {
      const wf = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/tracks/waveform?file=host.mp3`,
        {},
        jar,
      );
      if (wf.status !== 200) {
        throw new Error(`Waveform expected 200, got ${wf.status} ${await wf.text()}`);
      }
      const body = await wf.json();
      if (!Array.isArray(body.data) || !body.data.length) {
        throw new Error('Waveform JSON missing data array');
      }

      const stream = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/tracks/stream?file=host.mp3`,
        { headers: { Range: 'bytes=0-1023' } },
        jar,
      );
      if (stream.status !== 200 && stream.status !== 206) {
        throw new Error(`Stream expected 200/206, got ${stream.status} ${await stream.text()}`);
      }
      const buf = Buffer.from(await stream.arrayBuffer());
      if (buf.length < 1) throw new Error('Stream body empty');
      // Touch planted file size so remake/mix assertions have a baseline
      const mtDir =
        findSegmentMultitrackDir(podcast.id, episode.id, seg.id) || planted.mtDir;
      const hostSize = statSync(join(mtDir, 'host.mp3')).size;
      if (!(hostSize > 0)) throw new Error('host.mp3 empty');
    }),
  );

  results.push(
    await runOne('GET waveform/stream reject missing and dotted basenames', async () => {
      // Takes are resolved by basename under the mt dir; missing basenames 404.
      const missing = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/tracks/stream?file=nope-missing.mp3`,
        {},
        jar,
      );
      if (missing.status !== 404) {
        throw new Error(`Missing stream expected 404, got ${missing.status}`);
      }
      const missingWf = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/tracks/waveform?file=nope-missing.mp3`,
        {},
        jar,
      );
      if (missingWf.status !== 404) {
        throw new Error(`Missing waveform expected 404, got ${missingWf.status}`);
      }
      // Basename ".." is rejected by resolveTakeAudioAbsPath.
      const dotted = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}/tracks/stream?file=${encodeURIComponent('..')}`,
        {},
        jar,
      );
      if (dotted.status !== 400 && dotted.status !== 404) {
        throw new Error(`Dotted basename stream expected 400/404, got ${dotted.status}`);
      }
    }),
  );

  return results;
}
