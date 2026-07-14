import { apiFetch, loginAsAdmin, createShow, createEpisode, addRecordedSegment } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, { title: 'E2E Segments Show', slug: `e2e-seg-${Date.now()}` });
  const episode = await createEpisode(jar, podcast.id, { title: 'E2E Seg Ep', status: 'draft' });

  results.push(
    await runOne('GET /episodes/:id/segments returns list', async () => {
      const res = await apiFetch(`/episodes/${episode.id}/segments`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.segments)) throw new Error('Expected segments array');
    })
  );

  results.push(
    await runOne('PATCH segment trimRanges and markers persists', async () => {
      const patchEp = await createEpisode(jar, podcast.id, { title: 'E2E Patch Seg Ep', status: 'draft' });
      const seg = await addRecordedSegment(jar, patchEp.id);
      const durationSec = seg.durationSec ?? 60;
      const trimRanges = [[1, Math.min(5, durationSec - 0.1)]];
      const markers = [{ time: Math.min(2, durationSec), title: 'Intro' }];

      const res = await apiFetch(`/episodes/${patchEp.id}/segments/${seg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trimRanges, markers }),
      }, jar);
      if (res.status !== 200) throw new Error(`PATCH segment failed: ${res.status} ${await res.text()}`);
      const patched = await res.json();
      if (JSON.stringify(patched.trimRanges) !== JSON.stringify(trimRanges)) {
        throw new Error(`trimRanges: expected ${JSON.stringify(trimRanges)}, got ${JSON.stringify(patched.trimRanges)}`);
      }
      if (!patched.markers?.length || patched.markers[0].title !== 'Intro') {
        throw new Error(`markers: expected [{ time: 2, title: 'Intro' }], got ${JSON.stringify(patched.markers)}`);
      }

      const listRes = await apiFetch(`/episodes/${patchEp.id}/segments`, {}, jar);
      if (listRes.status !== 200) throw new Error(`GET segments failed: ${listRes.status}`);
      const list = await listRes.json();
      const found = list.segments?.find((s) => s.id === seg.id);
      if (!found) throw new Error('Segment not found after PATCH');
      if (JSON.stringify(found.trimRanges) !== JSON.stringify(trimRanges)) {
        throw new Error(`Persisted trimRanges: expected ${JSON.stringify(trimRanges)}, got ${JSON.stringify(found.trimRanges)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH segment invalid trimRanges returns 400', async () => {
      const patchEp = await createEpisode(jar, podcast.id, { title: 'E2E Invalid Trim Ep', status: 'draft' });
      const seg = await addRecordedSegment(jar, patchEp.id);
      const durationSec = seg.durationSec ?? 60;

      const res = await apiFetch(`/episodes/${patchEp.id}/segments/${seg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trimRanges: [[0, durationSec + 10]] }),
      }, jar);
      if (res.status !== 400) throw new Error(`Expected 400 for invalid trimRanges, got ${res.status}`);
      const data = await res.json();
      if (!data.error) throw new Error('Expected error message in response');
    })
  );

  results.push(
    await runOne('PATCH segment invalid markers returns 400', async () => {
      const patchEp = await createEpisode(jar, podcast.id, { title: 'E2E Invalid Marker Ep', status: 'draft' });
      const seg = await addRecordedSegment(jar, patchEp.id);
      const durationSec = seg.durationSec ?? 60;

      const res = await apiFetch(`/episodes/${patchEp.id}/segments/${seg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markers: [{ time: durationSec + 10, title: 'Out of range' }] }),
      }, jar);
      if (res.status !== 400) throw new Error(`Expected 400 for invalid markers, got ${res.status}`);
      const data = await res.json();
      if (!data.error) throw new Error('Expected error message in response');
    })
  );

  results.push(
    await runOne('PATCH episode finalMarkers persists', async () => {
      const markersEp = await createEpisode(jar, podcast.id, { title: 'E2E Final Markers Ep', status: 'draft' });
      const markers = [{ time: 0, title: 'Start', color: '#ff0000' }];

      const res = await apiFetch(`/episodes/${markersEp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalMarkers: markers }),
      }, jar);
      if (res.status !== 200) throw new Error(`PATCH episode failed: ${res.status} ${await res.text()}`);

      const getRes = await apiFetch(`/episodes/${markersEp.id}`, {}, jar);
      if (getRes.status !== 200) throw new Error(`GET episode failed: ${getRes.status}`);
      const ep = await getRes.json();
      if (!ep.finalMarkers?.length || ep.finalMarkers[0].title !== 'Start') {
        throw new Error(`finalMarkers: expected [{ time: 0, title: 'Start', color: '#ff0000' }], got ${JSON.stringify(ep.finalMarkers)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH segment soundbite marker persists', async () => {
      const patchEp = await createEpisode(jar, podcast.id, { title: 'E2E Soundbite Seg Ep', status: 'draft' });
      const seg = await addRecordedSegment(jar, patchEp.id);
      const durationSec = seg.durationSec ?? 60;
      const markers = [
        {
          time: Math.min(2, durationSec),
          title: 'Clip',
          color: '#06b6d4',
          markerType: 'soundbite',
          duration: 30,
        },
      ];

      const res = await apiFetch(`/episodes/${patchEp.id}/segments/${seg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markers }),
      }, jar);
      if (res.status !== 200) throw new Error(`PATCH segment failed: ${res.status} ${await res.text()}`);
      const patched = await res.json();
      const m = patched.markers?.[0];
      if (!m || m.markerType !== 'soundbite' || m.duration !== 30 || m.title !== 'Clip') {
        throw new Error(`Expected soundbite marker, got ${JSON.stringify(patched.markers)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH segment soundbite without duration returns 400', async () => {
      const patchEp = await createEpisode(jar, podcast.id, { title: 'E2E Soundbite No Dur Ep', status: 'draft' });
      const seg = await addRecordedSegment(jar, patchEp.id);
      const durationSec = seg.durationSec ?? 60;

      const res = await apiFetch(`/episodes/${patchEp.id}/segments/${seg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markers: [{ time: Math.min(1, durationSec), markerType: 'soundbite', title: 'Bad' }],
        }),
      }, jar);
      if (res.status !== 400) throw new Error(`Expected 400 for soundbite without duration, got ${res.status}`);
    })
  );

  results.push(
    await runOne('PATCH segment soundbite with invalid duration returns 400', async () => {
      const patchEp = await createEpisode(jar, podcast.id, { title: 'E2E Soundbite Bad Dur Ep', status: 'draft' });
      const seg = await addRecordedSegment(jar, patchEp.id);
      const durationSec = seg.durationSec ?? 60;

      for (const duration of [14, 121]) {
        const res = await apiFetch(`/episodes/${patchEp.id}/segments/${seg.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markers: [
              {
                time: Math.min(1, durationSec),
                markerType: 'soundbite',
                title: 'Bad',
                duration,
              },
            ],
          }),
        }, jar);
        if (res.status !== 400) {
          throw new Error(`Expected 400 for soundbite duration ${duration}, got ${res.status}`);
        }
      }
    })
  );

  results.push(
    await runOne('PATCH episode finalSoundbites persists', async () => {
      const sbEp = await createEpisode(jar, podcast.id, { title: 'E2E Final Soundbites Ep', status: 'draft' });
      const soundbites = [{ time: 5, duration: 45, title: 'Highlight', color: '#22c55e' }];

      const res = await apiFetch(`/episodes/${sbEp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalSoundbites: soundbites }),
      }, jar);
      if (res.status !== 200) throw new Error(`PATCH episode failed: ${res.status} ${await res.text()}`);

      const getRes = await apiFetch(`/episodes/${sbEp.id}`, {}, jar);
      if (getRes.status !== 200) throw new Error(`GET episode failed: ${getRes.status}`);
      const ep = await getRes.json();
      const sb = ep.finalSoundbites?.[0];
      if (!sb || sb.title !== 'Highlight' || sb.duration !== 45 || sb.time !== 5) {
        throw new Error(`finalSoundbites: expected Highlight@5/45s, got ${JSON.stringify(ep.finalSoundbites)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH episode invalid finalSoundbites returns 400', async () => {
      const sbEp = await createEpisode(jar, podcast.id, { title: 'E2E Invalid Soundbites Ep', status: 'draft' });

      const res = await apiFetch(`/episodes/${sbEp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalSoundbites: [{ time: 0, duration: 10, title: 'Too short' }],
        }),
      }, jar);
      if (res.status !== 400) throw new Error(`Expected 400 for invalid finalSoundbites, got ${res.status}`);
    })
  );

  results.push(
    await runOne('POST render returns 202 and completes', async () => {
      const renderEp = await createEpisode(jar, podcast.id, { title: 'E2E Render Ep', status: 'draft' });
      await addRecordedSegment(jar, renderEp.id);

      let res = await apiFetch(`/episodes/${renderEp.id}/render`, { method: 'POST' }, jar);
      if (res.status !== 202) throw new Error(`Expected 202, got ${res.status}`);
      const startData = await res.json();
      if (startData.status !== 'building') throw new Error(`Expected status building, got ${startData.status}`);

      const timeoutMs = 120_000;
      const pollIntervalMs = 2000;
      const start = Date.now();
      let statusData;
      while (Date.now() - start < timeoutMs) {
        res = await apiFetch(`/episodes/${renderEp.id}/render-status`, {}, jar);
        statusData = await res.json();
        if (statusData.status === 'done') break;
        if (statusData.status === 'failed') {
          throw new Error(`Render failed: ${statusData.error || 'unknown'}`);
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      if (statusData?.status !== 'done') throw new Error('Render timeout');

      res = await apiFetch(`/episodes/${renderEp.id}/final-waveform`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected final-waveform 200 after render, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Render rate limit returns 429', async () => {
      const ep1 = await createEpisode(jar, podcast.id, { title: 'E2E Rate Limit Ep 1', status: 'draft' });
      const ep2 = await createEpisode(jar, podcast.id, { title: 'E2E Rate Limit Ep 2', status: 'draft' });
      await addRecordedSegment(jar, ep1.id);
      await addRecordedSegment(jar, ep2.id);

      const res1 = await apiFetch(`/episodes/${ep1.id}/render`, { method: 'POST' }, jar);
      if (res1.status !== 202) throw new Error(`First render expected 202, got ${res1.status}`);

      const res2 = await apiFetch(`/episodes/${ep2.id}/render`, { method: 'POST' }, jar);
      if (res2.status !== 429) throw new Error(`Second render expected 429 (rate limited), got ${res2.status}`);
    })
  );

  results.push(
    await runOne('POST render with no segments returns 400', async () => {
      await new Promise((r) => setTimeout(r, 1100));
      const noSegEp = await createEpisode(jar, podcast.id, { title: 'E2E No Seg Ep', status: 'draft' });

      const res = await apiFetch(`/episodes/${noSegEp.id}/render`, { method: 'POST' }, jar);
      if (res.status !== 400) throw new Error(`Expected 400 when no segments, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.includes('one section')) {
        throw new Error(`Expected error about adding section, got ${data.error || 'no error'}`);
      }
    })
  );

  results.push(
    await runOne('Render aggregates soundbite markers into finalSoundbites', async () => {
      await new Promise((r) => setTimeout(r, 1100));
      const renderEp = await createEpisode(jar, podcast.id, { title: 'E2E Render Soundbites Ep', status: 'draft' });
      const seg = await addRecordedSegment(jar, renderEp.id);
      const durationSec = seg.durationSec ?? 60;
      const markerTime = Math.min(3, durationSec);

      let res = await apiFetch(`/episodes/${renderEp.id}/segments/${seg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markers: [
            {
              time: markerTime,
              title: 'Built bite',
              color: '#a855f7',
              markerType: 'soundbite',
              duration: 60,
            },
            {
              time: Math.min(1, durationSec),
              title: 'Chapter A',
              markerType: 'chapter',
            },
          ],
        }),
      }, jar);
      if (res.status !== 200) throw new Error(`PATCH segment failed: ${res.status} ${await res.text()}`);

      res = await apiFetch(`/episodes/${renderEp.id}/render`, { method: 'POST' }, jar);
      if (res.status !== 202) throw new Error(`Expected 202, got ${res.status}`);

      const timeoutMs = 120_000;
      const pollIntervalMs = 2000;
      const start = Date.now();
      let statusData;
      while (Date.now() - start < timeoutMs) {
        res = await apiFetch(`/episodes/${renderEp.id}/render-status`, {}, jar);
        statusData = await res.json();
        if (statusData.status === 'done') break;
        if (statusData.status === 'failed') {
          throw new Error(`Render failed: ${statusData.error || 'unknown'}`);
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      if (statusData?.status !== 'done') throw new Error('Render timeout');

      res = await apiFetch(`/episodes/${renderEp.id}`, {}, jar);
      if (res.status !== 200) throw new Error(`GET episode failed: ${res.status}`);
      const ep = await res.json();
      if (!ep.finalMarkers?.some((m) => m.title === 'Chapter A')) {
        throw new Error(`Expected chapter in finalMarkers, got ${JSON.stringify(ep.finalMarkers)}`);
      }
      const sb = ep.finalSoundbites?.find((s) => s.title === 'Built bite');
      if (!sb || sb.duration !== 60) {
        throw new Error(`Expected soundbite in finalSoundbites, got ${JSON.stringify(ep.finalSoundbites)}`);
      }
      if (typeof sb.time !== 'number' || Math.abs(sb.time - markerTime) > 0.05) {
        throw new Error(`Expected soundbite time ~${markerTime}, got ${sb.time}`);
      }
    })
  );

  results.push(
    await runOne('PUT /episodes/:id/segments/reorder reorders segments and persists new order', async () => {
      const reorderEp = await createEpisode(jar, podcast.id, { title: 'E2E Reorder Ep', status: 'draft' });
      await addRecordedSegment(jar, reorderEp.id);
      await addRecordedSegment(jar, reorderEp.id);
      await addRecordedSegment(jar, reorderEp.id);

      let res = await apiFetch(`/episodes/${reorderEp.id}/segments`, {}, jar);
      if (res.status !== 200) throw new Error(`GET segments failed: ${res.status}`);
      const before = await res.json();
      if (!before.segments || before.segments.length !== 3) throw new Error(`Expected 3 segments, got ${before.segments?.length ?? 0}`);
      const originalIds = before.segments.map((s) => s.id);
      const originalOrder = originalIds.join(',');

      const reversedIds = [originalIds[2], originalIds[1], originalIds[0]];
      res = await apiFetch(`/episodes/${reorderEp.id}/segments/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentIds: reversedIds }),
      }, jar);
      if (res.status !== 200) throw new Error(`Reorder failed: ${res.status} ${await res.text()}`);
      const reorderData = await res.json();
      const afterIds = (reorderData.segments || []).map((s) => s.id);
      if (afterIds.join(',') !== reversedIds.join(',')) {
        throw new Error(`Reorder response order: expected [${reversedIds.join(',')}], got [${afterIds.join(',')}]`);
      }

      res = await apiFetch(`/episodes/${reorderEp.id}/segments`, {}, jar);
      if (res.status !== 200) throw new Error(`GET segments after reorder failed: ${res.status}`);
      const after = await res.json();
      const persistedIds = (after.segments || []).map((s) => s.id);
      if (persistedIds.join(',') !== reversedIds.join(',')) {
        throw new Error(`Persisted order: expected [${reversedIds.join(',')}], got [${persistedIds.join(',')}] (original was [${originalOrder}])`);
      }
      for (let i = 0; i < after.segments.length; i++) {
        if (after.segments[i].position !== i) {
          throw new Error(`Segment at index ${i} has position ${after.segments[i].position}, expected ${i}`);
        }
      }
    })
  );

  return results;
}
