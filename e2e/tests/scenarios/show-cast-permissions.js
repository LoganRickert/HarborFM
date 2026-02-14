import { apiFetch, loginAsAdmin, createUser, createShow, cookieJar, login, createEpisode } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const slug = `e2e-cast-${Date.now()}`;
  const podcast = await createShow(adminJar, { title: 'E2E Cast Show', slug });

  results.push(
    await runOne('Owner can create host', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Host', role: 'host', is_public: 1 }),
      }, adminJar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
      const data = await res.json();
      if (!data.id || data.role !== 'host') throw new Error('Expected host in response');
    })
  );

  results.push(
    await runOne('Owner can create guest', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Guest', role: 'guest', is_public: 1 }),
      }, adminJar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
      const data = await res.json();
      if (!data.id || data.role !== 'guest') throw new Error('Expected guest in response');
    })
  );

  const listRes = await apiFetch(`/podcasts/${podcast.id}/cast?limit=10`, {}, adminJar);
  const listData = await listRes.json();
  const hostCast = listData.cast?.find((c) => c.role === 'host');
  const guestCast = listData.cast?.find((c) => c.role === 'guest');
  if (!hostCast || !guestCast) throw new Error('Setup: need host and guest in cast');

  results.push(
    await runOne('Manager can create host', async () => {
      const { email, password } = await createUser({ email: `mgr-cast-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'manager' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Mgr Host', role: 'host', is_public: 1 }),
      }, jar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Manager can create guest', async () => {
      const { email, password } = await createUser({ email: `mgr-guest-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'manager' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Mgr Guest', role: 'guest', is_public: 1 }),
      }, jar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Editor can create guest', async () => {
      const { email, password } = await createUser({ email: `ed-guest-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ed Guest', role: 'guest', is_public: 1 }),
      }, jar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Editor cannot create host', async () => {
      const { email, password } = await createUser({ email: `ed-nohost-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ed Host Attempt', role: 'host', is_public: 1 }),
      }, jar);
      if (res.status !== 403 && res.status !== 404) throw new Error(`Expected 403 or 404 for editor creating host, got ${res.status}`);
    })
  );

  results.push(
    await runOne('View cannot create host or guest', async () => {
      const { email, password } = await createUser({ email: `view-cast-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const resHost = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'View Host', role: 'host', is_public: 1 }),
      }, jar);
      const resGuest = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'View Guest', role: 'guest', is_public: 1 }),
      }, jar);
      if (resHost.status !== 403 && resHost.status !== 404) throw new Error(`Expected 403/404 for view creating host, got ${resHost.status}`);
      if (resGuest.status !== 403 && resGuest.status !== 404) throw new Error(`Expected 403/404 for view creating guest, got ${resGuest.status}`);
    })
  );

  const episode = await createEpisode(adminJar, podcast.id, { title: 'E2E Cast Episode', status: 'draft' });

  results.push(
    await runOne('Editor can assign cast to episode', async () => {
      const { email, password } = await createUser({ email: `ed-assign-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/episodes/${episode.id}/cast`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cast_ids: [guestCast.id] }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.cast) || data.cast.length !== 1) throw new Error('Expected 1 cast in response');
    })
  );

  results.push(
    await runOne('View cannot assign cast to episode', async () => {
      const { email, password } = await createUser({ email: `view-assign-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/episodes/${episode.id}/cast`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cast_ids: [hostCast.id, guestCast.id] }),
      }, jar);
      if (res.status !== 403 && res.status !== 404) throw new Error(`Expected 403 or 404 for view assigning cast, got ${res.status}`);
    })
  );

  return results;
}
