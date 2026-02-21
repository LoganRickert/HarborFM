import { apiFetch, loginAsAdmin, createShow } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('POST /public/reviews submit (podcast only)', async () => {
      const podcast = await createShow(jar, { slug: `e2e-reviews-${Date.now()}` });
      const res = await fetch(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api'}/public/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          podcastSlug: podcast.slug,
          name: 'E2E Reviewer',
          email: 'reviewer@e2e.test',
          rating: 5,
          body: 'This is a test review with at least ten characters.',
        }),
      });
      if (res.status !== 200 && res.status !== 400) {
        const t = await res.text();
        throw new Error(`Expected 200 or 400, got ${res.status} ${t}`);
      }
      if (res.ok) {
        const data = await res.json();
        if (data.ok !== true && data.id === undefined) throw new Error('Expected { ok: true } or { id }');
      }
    })
  );

  results.push(
    await runOne('POST /public/reviews reject body too short', async () => {
      const podcast = await createShow(jar, { slug: `e2e-reviews-short-${Date.now()}` });
      const res = await fetch(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api'}/public/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          podcastSlug: podcast.slug,
          name: 'E2E',
          email: 'short@e2e.test',
          rating: 3,
          body: 'short',
        }),
      });
      if (res.status !== 400) {
        const t = await res.text();
        throw new Error(`Expected 400, got ${res.status} ${t}`);
      }
    })
  );

  results.push(
    await runOne('POST /public/reviews reject duplicate email per podcast', async () => {
      const podcast = await createShow(jar, { slug: `e2e-reviews-dup-${Date.now()}` });
      const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api';
      const payload = {
        podcastSlug: podcast.slug,
        name: 'E2E Dup',
        email: 'dup@e2e.test',
        rating: 4,
        body: 'First review with enough characters here.',
      };
      const res1 = await fetch(`${base}/public/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res1.status !== 200) {
        const t = await res1.text();
        throw new Error(`First submit expected 200, got ${res1.status} ${t}`);
      }
      const res2 = await fetch(`${base}/public/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res2.status !== 400) {
        const t = await res2.text();
        throw new Error(`Second submit (duplicate email) expected 400, got ${res2.status} ${t}`);
      }
    })
  );

  results.push(
    await runOne('GET /public/podcasts/:slug/reviews returns list', async () => {
      const podcast = await createShow(jar, { slug: `e2e-reviews-list-${Date.now()}` });
      const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api';
      const res = await fetch(`${base}/public/podcasts/${encodeURIComponent(podcast.slug)}/reviews`);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if (!Array.isArray(data.reviews)) throw new Error('Expected reviews array');
    })
  );

  results.push(
    await runOne('GET /podcasts/:id/reviews (authenticated) returns list', async () => {
      const podcast = await createShow(jar, { slug: `e2e-reviews-admin-${Date.now()}` });
      const res = await apiFetch(`/podcasts/${podcast.id}/reviews`, {}, jar);
      if (res.status !== 200) {
        const t = await res.text();
        throw new Error(`Expected 200, got ${res.status} ${t}`);
      }
      const data = await res.json();
      if (!Array.isArray(data.reviews)) throw new Error('Expected reviews array');
      if (data.pagination == null || typeof data.pagination.total !== 'number') {
        throw new Error('Expected pagination with total');
      }
    })
  );

  results.push(
    await runOne('PATCH /podcasts/:id/reviews/:reviewId/approve (authenticated)', async () => {
      const podcast = await createShow(jar, { slug: `e2e-reviews-approve-${Date.now()}` });
      const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api';
      const submitRes = await fetch(`${base}/public/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          podcastSlug: podcast.slug,
          name: 'Approve Test',
          email: 'approve@e2e.test',
          rating: 5,
          body: 'Review to approve with enough characters.',
        }),
      });
      if (!submitRes.ok) {
        const t = await submitRes.text();
        throw new Error(`Submit failed: ${submitRes.status} ${t}`);
      }
      const submitData = await submitRes.json();
      const reviewId = submitData.id;
      if (!reviewId) throw new Error('Expected id in submit response');

      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}/reviews/${encodeURIComponent(reviewId)}/approve`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        jar
      );
      if (patchRes.status !== 200) {
        const t = await patchRes.text();
        throw new Error(`Approve failed: ${patchRes.status} ${t}`);
      }

      const listRes = await apiFetch(`/podcasts/${podcast.id}/reviews`, {}, jar);
      const listData = await listRes.json();
      const review = listData.reviews?.find((r) => r.id === reviewId);
      if (!review) throw new Error('Review not found in list');
      if (!review.approved) throw new Error('Expected review to be approved');
    })
  );

  results.push(
    await runOne('GET /public/reviews/verify-email invalid token returns 400', async () => {
      const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api';
      const res = await fetch(`${base}/public/reviews/verify-email?token=invalid-token`);
      if (res.status !== 400 && res.status !== 404) {
        const t = await res.text();
        throw new Error(`Expected 400 or 404, got ${res.status} ${t}`);
      }
    })
  );

  results.push(
    await runOne('GET /public/reviews/delete invalid token returns 400', async () => {
      const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api';
      const res = await fetch(`${base}/public/reviews/delete?token=invalid-token`);
      if (res.status !== 400 && res.status !== 404) {
        const t = await res.text();
        throw new Error(`Expected 400 or 404, got ${res.status} ${t}`);
      }
    })
  );

  return results;
}
