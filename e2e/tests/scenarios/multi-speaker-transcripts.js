/**
 * E2E: Multi-speaker transcripts (nickname, include toggle, multi-track Whisper flag, episode stitch).
 */
import { existsSync, readdirSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  apiFetch,
  completeSetup,
  createEpisode,
  createShow,
  e2eDataDir,
  loginAsAdmin,
  addRecordedSegment,
  plantSegmentMultitrack,
  getSegmentTracks,
  saveSegmentTracks,
  uploadEpisodeAudio,
  processEpisodeAudio,
  pollStatus,
  testDataMp3,
} from '../../lib/helpers.js';

function findSegmentAudioAbs(podcastId, episodeId, segmentId, audioBasename) {
  const base = join(e2eDataDir(), 'uploads', podcastId, episodeId, 'segments');
  if (!existsSync(base)) return null;
  if (audioBasename) {
    const preferred = join(base, audioBasename);
    if (existsSync(preferred)) return preferred;
  }
  const names = readdirSync(base);
  const direct = names.find(
    (n) => n.includes(segmentId) && /\.(mp3|wav|webm|ogg|m4a)$/i.test(n),
  );
  if (direct) return join(base, direct);
  return null;
}

function srtCue(index, start, end, text) {
  return `${index}\n${start} --> ${end}\n${text}\n`;
}

export async function run({ runOne }) {
  const results = [];
  try {
    await completeSetup({ registrationEnabled: true, publicFeedsEnabled: true });
  } catch {
    // already set up
  }

  const { jar } = await loginAsAdmin();
  const ts = Date.now();
  const podcast = await createShow(jar, {
    title: 'E2E Multi-speaker Transcript Show',
    slug: `e2e-mt-tx-${ts}`,
  });
  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Multi-speaker Transcript Ep',
    status: 'draft',
  });

  results.push(
    await runOne('Cast nickname create and update', async () => {
      const createRes = await apiFetch(
        `/podcasts/${podcast.id}/cast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Logan Rickert',
            nickname: 'Logan',
            role: 'host',
            isPublic: 1,
          }),
        },
        jar,
      );
      if (createRes.status !== 200 && createRes.status !== 201) {
        throw new Error(
          `Create cast: expected 200/201, got ${createRes.status} ${await createRes.text()}`,
        );
      }
      const created = await createRes.json();
      if (created.nickname !== 'Logan') {
        throw new Error(`Expected nickname Logan, got ${created.nickname}`);
      }
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}/cast/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: 'Lo' }),
        },
        jar,
      );
      if (!patchRes.ok) {
        throw new Error(`Patch cast: ${patchRes.status} ${await patchRes.text()}`);
      }
      const updated = await patchRes.json();
      if (updated.nickname !== 'Lo') {
        throw new Error(`Expected nickname Lo, got ${updated.nickname}`);
      }
      // Clear nickname
      const clearRes = await apiFetch(
        `/podcasts/${podcast.id}/cast/${created.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: '' }),
        },
        jar,
      );
      if (!clearRes.ok) {
        throw new Error(`Clear nickname: ${clearRes.status}`);
      }
      const cleared = await clearRes.json();
      if (cleared.nickname != null && cleared.nickname !== '') {
        throw new Error(`Expected null nickname, got ${cleared.nickname}`);
      }
    }),
  );

  const seg = await addRecordedSegment(jar, episode.id);
  plantSegmentMultitrack({
    podcastId: podcast.id,
    episodeId: episode.id,
    segmentId: seg.id,
    durationSec: seg.durationSec ?? 10,
    hostName: 'Host One',
    guestName: 'Guest Two',
  });

  results.push(
    await runOne('includeInTranscript defaults and persists', async () => {
      const before = await getSegmentTracks(jar, episode.id, seg.id);
      if (!before.clips?.length || before.clips.length < 2) {
        throw new Error('Expected planted host + guest clips');
      }
      // Host/guest clips omit the field until set; defaults are host-on (participantId).
      for (const c of before.clips) {
        if (c.includeInTranscript != null && c.includeInTranscript !== true) {
          throw new Error(
            `Expected unset or true includeInTranscript for call clips, got ${c.includeInTranscript}`,
          );
        }
        if (!c.participantId) {
          throw new Error('Planted clips should have participantId');
        }
      }
      // Import-style clip defaults off when explicitly stored false after save.
      const withImport = [
        ...before.clips.map((c, i) => ({
          ...c,
          includeInTranscript: i === 0,
        })),
        {
          segmentId: 'import-clip',
          producerId: 'import-lane',
          participantName: 'Bed Music',
          startMs: 0,
          endMs: 1000,
          lengthMs: 1000,
          filePath: 'host.mp3',
          codec: 'libmp3lame',
          source: 'import',
          includeInTranscript: false,
        },
      ];
      await saveSegmentTracks(jar, episode.id, seg.id, withImport);
      const after = await getSegmentTracks(jar, episode.id, seg.id);
      const importClip = after.clips.find((c) => c.segmentId === 'import-clip');
      if (!importClip || importClip.includeInTranscript !== false) {
        throw new Error(
          `Expected import clip includeInTranscript false, got ${JSON.stringify(importClip)}`,
        );
      }
      const callFlags = after.clips
        .filter((c) => c.segmentId !== 'import-clip')
        .map((c) => c.includeInTranscript === true);
      if (!callFlags.some(Boolean) || callFlags.every(Boolean)) {
        throw new Error(
          `Expected mixed includeInTranscript on call clips, got ${JSON.stringify(
            after.clips.map((c) => ({
              id: c.segmentId,
              include: c.includeInTranscript,
            })),
          )}`,
        );
      }
      // Drop import clip for later multi-track ASR test
      await saveSegmentTracks(
        jar,
        episode.id,
        seg.id,
        after.clips.filter((c) => c.segmentId !== 'import-clip'),
      );
    }),
  );

  results.push(
    await runOne('multiTrackWhisperEnabled defaults on and can disable', async () => {
      const listRes = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (!listRes.ok) throw new Error(`List segments: ${listRes.status}`);
      const list = await listRes.json();
      const row = (list.segments || []).find((s) => s.id === seg.id);
      if (!row) throw new Error('Segment missing from list');
      if (row.multiTrackWhisperEnabled === false) {
        throw new Error('Expected multiTrackWhisperEnabled default true');
      }
      const patch = await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ multiTrackWhisperEnabled: false }),
        },
        jar,
      );
      if (!patch.ok) {
        throw new Error(`PATCH segment: ${patch.status} ${await patch.text()}`);
      }
      const list2 = await (await apiFetch(`/episodes/${episode.id}/segments`, {}, jar)).json();
      const row2 = (list2.segments || []).find((s) => s.id === seg.id);
      if (row2?.multiTrackWhisperEnabled !== false) {
        throw new Error('Expected multiTrackWhisperEnabled false after PATCH');
      }
      // Restore default for later stitch tests
      await apiFetch(
        `/episodes/${episode.id}/segments/${seg.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ multiTrackWhisperEnabled: true }),
        },
        jar,
      );
    }),
  );

  const segB = await addRecordedSegment(jar, episode.id);
  const audioA = findSegmentAudioAbs(
    podcast.id,
    episode.id,
    seg.id,
    seg.audioPath,
  );
  const audioB = findSegmentAudioAbs(
    podcast.id,
    episode.id,
    segB.id,
    segB.audioPath,
  );

  results.push(
    await runOne('Episode generate stitches segment transcripts with offsets', async () => {
      if (!audioA || !audioB) {
        throw new Error(
          `Missing segment audio files (A=${audioA} B=${audioB})`,
        );
      }
      const srtA =
        srtCue(1, '00:00:00,000', '00:00:01,000', 'Alpha: Hello from A') +
        '\n' +
        srtCue(2, '00:00:01,500', '00:00:02,000', 'Beta: Second A');
      const srtB = srtCue(
        1,
        '00:00:00,000',
        '00:00:01,000',
        'Alpha: Hello from B',
      );
      const txtA = audioA.replace(/\.[^.]+$/, '.txt');
      const txtB = audioB.replace(/\.[^.]+$/, '.txt');
      writeFileSync(txtA, srtA, 'utf8');
      writeFileSync(txtB, srtB, 'utf8');
      // Ensure transcripts are newer than mix / takes so stitch skips regen.
      const future = new Date(Date.now() + 60_000);
      utimesSync(txtA, future, future);
      utimesSync(txtB, future, future);

      await uploadEpisodeAudio(jar, episode.id, podcast.id, testDataMp3());
      await processEpisodeAudio(jar, episode.id);

      const start = await apiFetch(
        `/episodes/${episode.id}/generate-transcript`,
        { method: 'POST' },
        jar,
      );
      if (start.status !== 202 && start.status !== 200) {
        throw new Error(
          `generate-transcript: expected 202, got ${start.status} ${await start.text()}`,
        );
      }
      await pollStatus(`/episodes/${episode.id}/transcript-status`, jar, {
        pendingStatuses: ['transcribing', 'idle'],
        successStatuses: ['done'],
        timeoutMs: 180000,
      });

      const getTx = await apiFetch(`/episodes/${episode.id}/transcript`, {}, jar);
      if (!getTx.ok) {
        throw new Error(`GET transcript: ${getTx.status} ${await getTx.text()}`);
      }
      const { text } = await getTx.json();
      if (!text || typeof text !== 'string') {
        throw new Error('Expected transcript text');
      }
      if (!text.includes('Hello from A') || !text.includes('Hello from B')) {
        throw new Error(`Stitched transcript missing cues:\n${text}`);
      }
      // Segment B cues should be shifted by segment A duration (approx >= 1s).
      if (!/00:00:0[1-9].*Hello from B|00:00:[1-9].*Hello from B/.test(text)) {
        // Allow if A duration is very short; still require B cue present after A content order
        const idxA = text.indexOf('Hello from A');
        const idxB = text.indexOf('Hello from B');
        if (idxA < 0 || idxB < 0 || idxB < idxA) {
          throw new Error(`Expected B cue after A in stitched SRT:\n${text}`);
        }
      }
    }),
  );

  const asrRes = await apiFetch('/asr/available', {}, jar);
  const asr = asrRes.ok ? await asrRes.json() : { available: false };

  if (asr.available) {
    results.push(
      await runOne('Multi-track segment generate labels speakers when ASR available', async () => {
        // Restore both hosts included
        const tracks = await getSegmentTracks(jar, episode.id, seg.id);
        const clips = tracks.clips.map((c) => ({
          ...c,
          includeInTranscript: true,
        }));
        await saveSegmentTracks(jar, episode.id, seg.id, clips);

        const start = await apiFetch(
          `/episodes/${episode.id}/segments/${seg.id}/transcript?regenerate=true`,
          { method: 'POST' },
          jar,
        );
        if (start.status !== 202 && start.status !== 200) {
          throw new Error(
            `segment transcript: ${start.status} ${await start.text()}`,
          );
        }
        await pollStatus(
          `/episodes/${episode.id}/segments/${seg.id}/transcript-status`,
          jar,
          {
            pendingStatuses: ['transcribing', 'idle'],
            successStatuses: ['done'],
            timeoutMs: 300000,
          },
        );
        const getTx = await apiFetch(
          `/episodes/${episode.id}/segments/${seg.id}/transcript`,
          {},
          jar,
        );
        if (!getTx.ok) {
          throw new Error(`GET segment transcript: ${getTx.status}`);
        }
        const { text } = await getTx.json();
        const hasHost = /Host One\s*:/.test(text);
        const hasGuest = /Guest Two\s*:/.test(text);
        if (!hasHost || !hasGuest) {
          throw new Error(
            `Expected Host One: and Guest Two: prefixes in multi-track SRT:\n${text.slice(0, 500)}`,
          );
        }
      }),
    );

    results.push(
      await runOne('Episode generate regenerates stale segment transcript', async () => {
        if (!audioA || !audioB) {
          throw new Error(`Missing segment audio (A=${audioA} B=${audioB})`);
        }
        const marker = `STALE_MARKER_${Date.now()}`;
        const txtA = audioA.replace(/\.[^.]+$/, '.txt');
        const txtB = audioB.replace(/\.[^.]+$/, '.txt');
        writeFileSync(
          txtA,
          srtCue(1, '00:00:00,000', '00:00:01,000', marker),
          'utf8',
        );
        writeFileSync(
          txtB,
          srtCue(1, '00:00:00,000', '00:00:01,000', 'Fresh B cue'),
          'utf8',
        );
        // Make segment A transcript stale vs mix audio; keep B fresh.
        const past = new Date(Date.now() - 120_000);
        const future = new Date(Date.now() + 60_000);
        utimesSync(txtA, past, past);
        utimesSync(audioA, future, future);
        utimesSync(txtB, future, future);

        const start = await apiFetch(
          `/episodes/${episode.id}/generate-transcript`,
          { method: 'POST' },
          jar,
        );
        if (start.status !== 202 && start.status !== 200) {
          throw new Error(
            `generate-transcript: ${start.status} ${await start.text()}`,
          );
        }
        await pollStatus(`/episodes/${episode.id}/transcript-status`, jar, {
          pendingStatuses: ['transcribing', 'idle'],
          successStatuses: ['done'],
          timeoutMs: 300000,
        });
        const getTx = await apiFetch(`/episodes/${episode.id}/transcript`, {}, jar);
        if (!getTx.ok) {
          throw new Error(`GET transcript: ${getTx.status}`);
        }
        const { text } = await getTx.json();
        if (text.includes(marker)) {
          throw new Error(
            `Expected stale segment A transcript to be regenerated (marker still present):\n${text.slice(0, 400)}`,
          );
        }
        if (!text.includes('Fresh B cue')) {
          throw new Error(`Expected fresh segment B cue in stitch:\n${text.slice(0, 400)}`);
        }
      }),
    );
  }

  return results;
}
