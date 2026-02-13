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
        body: JSON.stringify({ segment_ids: reversedIds }),
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
