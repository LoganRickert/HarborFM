import { apiFetch, loginAsAdmin, createUser, createShow, cookieJar, login, createEpisode } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar, email: adminEmail } = await loginAsAdmin();
  const slug = `e2e-collab-${Date.now()}`;
  const podcast = await createShow(adminJar, { title: 'E2E Collab Show', slug });

  results.push(
    await runOne('POST collaborators adds user by email', async () => {
      const { email } = await createUser({ email: `collab-${Date.now()}@e2e.test` });
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      if (res.status !== 200 && res.status !== 201) throw new Error(`Expected 200/201, got ${res.status}`);
      const data = await res.json();
      if (!data.role && !data.user_id) throw new Error('Expected collaborator in response');
    })
  );

  results.push(
    await runOne('Collaborator with editor role sees show in GET /podcasts', async () => {
      const { email, password } = await createUser({ email: `editor-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch('/podcasts', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const found = data.podcasts?.some((p) => p.id === podcast.id);
      if (!found) throw new Error('Collaborator should see shared show');
    })
  );

  results.push(
    await runOne('Collaborator with manager role can create episode', async () => {
      const { email, password } = await createUser({ email: `manager-ep-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'manager' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const ep = await createEpisode(jar, podcast.id, { title: 'Collab Episode' });
      if (!ep.id) throw new Error('Expected created episode');
    })
  );

  results.push(
    await runOne('Collaborator with view role cannot create episode', async () => {
      const { email, password } = await createUser({ email: `viewer-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Viewer Episode', status: 'draft' }),
      }, jar);
      if (res.status !== 403 && res.status !== 404) throw new Error(`Expected 403 or 404 for view-only, got ${res.status}`);
    })
  );

  results.push(
    await runOne('DELETE collaborator removes access', async () => {
      const { email, password } = await createUser({ email: `remove-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      await apiFetch(`/podcasts/${podcast.id}/collaborators/${u.id}`, {
        method: 'DELETE',
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch('/podcasts', {}, jar);
      const data = await res.json();
      const found = data.podcasts?.some((p) => p.id === podcast.id);
      if (found) throw new Error('Removed collaborator should not see show');
    })
  );

  results.push(
    await runOne('Manager can list collaborators', async () => {
      const { email, password } = await createUser({ email: `mgr-list-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'manager' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.collaborators)) throw new Error('Expected collaborators array');
      if (data.collaborators.length < 1) throw new Error('Expected at least one collaborator');
    })
  );

  results.push(
    await runOne('View role cannot list collaborators', async () => {
      const { email, password } = await createUser({ email: `view-list-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {}, jar);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Editor cannot list collaborators', async () => {
      const { email, password } = await createUser({ email: `ed-list-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {}, jar);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    })
  );

  results.push(
    await runOne('Manager can PATCH collaborator role', async () => {
      const { email: emailA, password: passwordA } = await createUser({ email: `patch-a-${Date.now()}@e2e.test` });
      const { email: emailB, password: passwordB } = await createUser({ email: `patch-b-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailA, role: 'editor' }),
      }, adminJar);
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailB, role: 'manager' }),
      }, adminJar);
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const userA = list.users.find((x) => x.email === emailA);
      if (!userA) throw new Error('User A not found');
      const jarB = cookieJar();
      await login(emailB, passwordB, jarB);
      const patchRes = await apiFetch(`/podcasts/${podcast.id}/collaborators/${userA.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'view' }),
      }, jarB);
      if (patchRes.status !== 200) throw new Error(`Expected 200, got ${patchRes.status}`);
      const patched = await patchRes.json();
      if (patched.role !== 'view') throw new Error(`Expected role view, got ${patched.role}`);
      const jarA = cookieJar();
      await login(emailA, passwordA, jarA);
      const createRes = await apiFetch(`/podcasts/${podcast.id}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'After Demote', status: 'draft' }),
      }, jarA);
      if (createRes.status !== 403 && createRes.status !== 404) throw new Error(`Expected 403/404 after demote to view, got ${createRes.status}`);
    })
  );

  results.push(
    await runOne('View can read podcast and episodes', async () => {
      const { email, password } = await createUser({ email: `view-read-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const podRes = await apiFetch(`/podcasts/${podcast.id}`, {}, jar);
      if (podRes.status !== 200) throw new Error(`Expected 200 for GET podcast, got ${podRes.status}`);
      const epRes = await apiFetch(`/podcasts/${podcast.id}/episodes`, {}, jar);
      if (epRes.status !== 200) throw new Error(`Expected 200 for GET episodes, got ${epRes.status}`);
    })
  );

  results.push(
    await runOne('Editor can read episode but cannot PATCH episode', async () => {
      const episodeForEditor = await createEpisode(adminJar, podcast.id, { title: 'Episode For Editor Test' });
      const { email, password } = await createUser({ email: `ed-read-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      const jar = cookieJar();
      await login(email, password, jar);
      const getRes = await apiFetch(`/episodes/${episodeForEditor.id}`, {}, jar);
      if (getRes.status !== 200) throw new Error(`Expected 200 for GET episode, got ${getRes.status}`);
      const patchRes = await apiFetch(`/episodes/${episodeForEditor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated By Editor' }),
      }, jar);
      if (patchRes.status !== 404) throw new Error(`Expected 404 for PATCH episode as editor, got ${patchRes.status}`);
    })
  );

  results.push(
    await runOne('Manager can add collaborator', async () => {
      const { email: emailM, password: passwordM } = await createUser({ email: `mgr-add-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailM, role: 'manager' }),
      }, adminJar);
      const jarM = cookieJar();
      await login(emailM, passwordM, jarM);
      const { email: emailC, password: passwordC } = await createUser({ email: `mgr-invite-${Date.now()}@e2e.test` });
      const addRes = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailC, role: 'editor' }),
      }, jarM);
      if (addRes.status !== 201) throw new Error(`Expected 201, got ${addRes.status}`);
      const jarC = cookieJar();
      await login(emailC, passwordC, jarC);
      const listRes = await apiFetch('/podcasts', {}, jarC);
      const data = await listRes.json();
      const found = data.podcasts?.some((p) => p.id === podcast.id);
      if (!found) throw new Error('Manager-invited collaborator should see show');
    })
  );

  results.push(
    await runOne('Collaborator can leave (DELETE self)', async () => {
      const { email, password } = await createUser({ email: `leave-${Date.now()}@e2e.test` });
      await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'editor' }),
      }, adminJar);
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      const jar = cookieJar();
      await login(email, password, jar);
      const meRes = await apiFetch('/auth/me', {}, jar);
      const me = await meRes.json();
      if (me.id !== u.id) throw new Error('Auth me id mismatch');
      const delRes = await apiFetch(`/podcasts/${podcast.id}/collaborators/${u.id}`, { method: 'DELETE' }, jar);
      if (delRes.status !== 204) throw new Error(`Expected 204, got ${delRes.status}`);
      const afterRes = await apiFetch('/podcasts', {}, jar);
      const afterData = await afterRes.json();
      const found = afterData.podcasts?.some((p) => p.id === podcast.id);
      if (found) throw new Error('After leave, user should not see show');
    })
  );

  results.push(
    await runOne('POST collaborator invalid role returns 400', async () => {
      const { email } = await createUser({ email: `invalid-role-${Date.now()}@e2e.test` });
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'admin' }),
      }, adminJar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('invalid')) throw new Error('Expected invalid role error');
    })
  );

  results.push(
    await runOne('POST collaborator with unknown email returns 404', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@e2e.test', role: 'view' }),
      }, adminJar);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
      const data = await res.json();
      if (data.code !== 'USER_NOT_FOUND' && (!data.error || !data.error.toLowerCase().includes('not found'))) {
        throw new Error('Expected USER_NOT_FOUND or not found error');
      }
    })
  );

  results.push(
    await runOne('POST owner as collaborator returns 400', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, role: 'view' }),
      }, adminJar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('owner')) throw new Error('Expected owner already on show error');
    })
  );

  results.push(
    await runOne('POST collaborator with disabled user returns 400', async () => {
      const { email } = await createUser({ email: `disabled-collab-${Date.now()}@e2e.test` });
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      }, adminJar);
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('disabled')) throw new Error('Expected disabled account error');
    })
  );

  results.push(
    await runOne('POST collaborator with read_only user returns 400', async () => {
      const { email } = await createUser({ email: `readonly-collab-${Date.now()}@e2e.test` });
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === email);
      if (!u) throw new Error('User not found');
      await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read_only: true }),
      }, adminJar);
      const res = await apiFetch(`/podcasts/${podcast.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'view' }),
      }, adminJar);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('read-only')) throw new Error('Expected read-only account error');
    })
  );

  return results;
}
