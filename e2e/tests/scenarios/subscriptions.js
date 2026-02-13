import { baseURL, apiFetch, loginAsAdmin, createShow } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-sub-${Date.now()}`;
  const podcast = await createShow(jar, { title: 'E2E Sub Show', slug });

  results.push(
    await runOne('PATCH podcast subscriber_only_feed_enabled enables subscriber feed', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_only_feed_enabled: 1 }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    })
  );

  results.push(
    await runOne('POST subscriber-tokens creates token and returns id + token', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Sub Token' }),
      }, jar);
      if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
      const data = await res.json();
      if (!data.id) throw new Error('Expected token id');
      if (!data.token || !data.token.startsWith('hfm_sub_')) throw new Error('Expected raw token');
    })
  );

  results.push(
    await runOne('GET private RSS with token returns 200', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Private RSS Token' }),
      }, jar);
      const created = await createRes.json();
      const token = created.token;
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(token)}/rss`);
      if (res.status !== 200) throw new Error(`Expected 200 for private RSS, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('<?xml') && !text.includes('<rss')) throw new Error('Expected RSS XML');
    })
  );

  results.push(
    await runOne('Private RSS with token id (not raw token) returns 404', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Token Id Test' }),
      }, jar);
      const created = await createRes.json();
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(created.id)}/rss`);
      if (res.status !== 404) throw new Error(`Expected 404 when using token id instead of raw token, got ${res.status}`);
    })
  );

  results.push(
    await runOne('POST /public/subscriber-auth with valid token returns 200', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Auth Token' }),
      }, jar);
      const created = await createRes.json();
      const res = await fetch(`${baseURL}/public/subscriber-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token, podcastSlug: slug }),
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.success !== true) throw new Error('Expected success: true');
    })
  );

  results.push(
    await runOne('POST subscriber-tokens with valid_until in the past returns 400', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const res = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Past Expiry Token', valid_until: past }),
      }, jar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('past')) throw new Error('Expected past/expiration error');
    })
  );

  results.push(
    await runOne('Expired token (valid_until 1s) returns 404 after 2s wait', async () => {
      const oneSecondLater = new Date(Date.now() + 1000).toISOString();
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Expires Soon Token', valid_until: oneSecondLater }),
      }, jar);
      if (createRes.status !== 201) throw new Error(`Expected 201, got ${createRes.status}`);
      const created = await createRes.json();
      await new Promise((r) => setTimeout(r, 2100));
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(created.token)}/rss`);
      if (res.status !== 404) throw new Error(`Expected 404 for expired token, got ${res.status}`);
    })
  );

  results.push(
    await runOne('PATCH subscriber-token disabled: true and token no longer works', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'To Disable Token' }),
      }, jar);
      const created = await createRes.json();
      const patchRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      }, jar);
      if (patchRes.status !== 200) throw new Error(`Expected 200 from PATCH, got ${patchRes.status}`);
      const rssRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(created.token)}/rss`);
      if (rssRes.status !== 404) throw new Error(`Expected 404 for disabled token, got ${rssRes.status}`);
      const authRes = await fetch(`${baseURL}/public/subscriber-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token, podcastSlug: slug }),
      });
      if (authRes.status !== 404) throw new Error(`Expected 404 for disabled token (subscriber-auth), got ${authRes.status}`);
    })
  );

  results.push(
    await runOne('DELETE subscriber-token and token no longer works', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'To Delete Token' }),
      }, jar);
      const created = await createRes.json();
      const delRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens/${created.id}`, {
        method: 'DELETE',
      }, jar);
      if (delRes.status !== 204) throw new Error(`Expected 204 from DELETE, got ${delRes.status}`);
      const rssRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/private/${encodeURIComponent(created.token)}/rss`);
      if (rssRes.status !== 404) throw new Error(`Expected 404 for deleted token, got ${rssRes.status}`);
      const authRes = await fetch(`${baseURL}/public/subscriber-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token, podcastSlug: slug }),
      });
      if (authRes.status !== 404) throw new Error(`Expected 404 for deleted token (subscriber-auth), got ${authRes.status}`);
    })
  );

  return results;
}
