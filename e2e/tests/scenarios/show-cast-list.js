import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const slug = `e2e-cast-list-${Date.now()}`;
  const podcast = await createShow(adminJar, { title: 'E2E Cast List Show', slug });

  results.push(
    await runOne('Add cast members and list returns them', async () => {
      const hostRes = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'List Host', role: 'host', is_public: 1 }),
      }, adminJar);
      if (hostRes.status !== 200 && hostRes.status !== 201) {
        throw new Error(`Create host: expected 200/201, got ${hostRes.status}`);
      }
      const host = await hostRes.json();
      if (!host.id || host.role !== 'host') throw new Error('Expected host with id');

      const guestRes = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'List Guest', role: 'guest', is_public: 1 }),
      }, adminJar);
      if (guestRes.status !== 200 && guestRes.status !== 201) {
        throw new Error(`Create guest: expected 200/201, got ${guestRes.status}`);
      }
      const guest = await guestRes.json();
      if (!guest.id || guest.role !== 'guest') throw new Error('Expected guest with id');

      const listRes = await apiFetch(`/podcasts/${podcast.id}/cast?limit=20`, {}, adminJar);
      if (listRes.status !== 200) throw new Error(`List cast: expected 200, got ${listRes.status}`);
      const listData = await listRes.json();
      if (!Array.isArray(listData.cast)) throw new Error('Expected cast array');
      if (typeof listData.total !== 'number') throw new Error('Expected total number');

      const foundHost = listData.cast.find((c) => c.id === host.id && c.name === 'List Host');
      const foundGuest = listData.cast.find((c) => c.id === guest.id && c.name === 'List Guest');
      if (!foundHost) throw new Error('List should include created host');
      if (!foundGuest) throw new Error('List should include created guest');
    })
  );

  results.push(
    await runOne('Get cast list with episode_id excludes assigned members', async () => {
      // Add a third cast member
      const extraRes = await apiFetch(`/podcasts/${podcast.id}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Unassigned Guest', role: 'guest', is_public: 1 }),
      }, adminJar);
      if (extraRes.status !== 200 && extraRes.status !== 201) {
        throw new Error(`Create extra cast: expected 200/201, got ${extraRes.status}`);
      }

      const listRes = await apiFetch(`/podcasts/${podcast.id}/cast?limit=20`, {}, adminJar);
      const listData = await listRes.json();
      const castIds = listData.cast.map((c) => c.id);
      if (castIds.length < 2) throw new Error('Need at least 2 cast for this test');

      const episode = await createEpisode(adminJar, podcast.id, { title: 'E2E Cast Exclude Episode', status: 'draft' });
      const assignIds = castIds.slice(0, 2);
      const assignRes = await apiFetch(`/podcasts/${podcast.id}/episodes/${episode.id}/cast`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cast_ids: assignIds }),
      }, adminJar);
      if (assignRes.status !== 200) throw new Error(`Assign cast: expected 200, got ${assignRes.status}`);

      const excludeRes = await apiFetch(
        `/podcasts/${podcast.id}/cast?limit=20&episode_id=${encodeURIComponent(episode.id)}`,
        {},
        adminJar
      );
      if (excludeRes.status !== 200) throw new Error(`List with episode_id: expected 200, got ${excludeRes.status}`);
      const excludeData = await excludeRes.json();
      const excludedIds = excludeData.cast.map((c) => c.id);
      for (const id of assignIds) {
        if (excludedIds.includes(id)) {
          throw new Error(`Assigned cast ${id} should not appear when listing with episode_id`);
        }
      }
    })
  );

  results.push(
    await runOne('Get public cast list and episode cast', async () => {
      const castRes = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/cast`);
      if (castRes.status !== 200) throw new Error(`Public cast: expected 200, got ${castRes.status}`);
      const castData = await castRes.json();
      if (!Array.isArray(castData.hosts)) throw new Error('Expected hosts array');
      if (!Array.isArray(castData.guests)) throw new Error('Expected guests array');
      if (castData.hosts.length === 0 && castData.guests.length === 0) {
        throw new Error('Public cast should have at least one host or guest');
      }

      const episode = await createEpisode(adminJar, podcast.id, {
        title: 'E2E Public Episode Cast',
        status: 'draft',
      });
      await apiFetch(`/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published', publish_at: null }),
      }, adminJar);

      const listRes = await apiFetch(`/podcasts/${podcast.id}/cast?limit=5`, {}, adminJar);
      const listData = await listRes.json();
      const firstCastId = listData.cast?.[0]?.id;
      if (!firstCastId) throw new Error('Need at least one cast to assign');

      await apiFetch(`/podcasts/${podcast.id}/episodes/${episode.id}/cast`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cast_ids: [firstCastId] }),
      }, adminJar);

      const episodeCastRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episode.slug)}/cast`
      );
      if (episodeCastRes.status !== 200) {
        throw new Error(`Public episode cast: expected 200, got ${episodeCastRes.status}`);
      }
      const episodeCastData = await episodeCastRes.json();
      if (!Array.isArray(episodeCastData.cast)) throw new Error('Expected cast array in episode cast');
      if (episodeCastData.cast.length !== 1) {
        throw new Error(`Expected 1 assigned cast on episode, got ${episodeCastData.cast.length}`);
      }
      if (episodeCastData.cast[0].id !== firstCastId) {
        throw new Error(`Expected assigned cast id ${firstCastId}, got ${episodeCastData.cast[0].id}`);
      }
    })
  );

  return results;
}
