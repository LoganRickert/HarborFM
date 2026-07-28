/**
 * Compute workers: enable, auth, status, regenerate secrets, and IP ban on guessing.
 */
import { randomBytes } from 'crypto';
import {
  completeSetup,
  loginAsAdmin,
  apiFetch,
  connectWorkerWs,
} from '../../lib/helpers.js';

const E2E_CLIENT_IP = process.env.E2E_CLIENT_IP || '127.0.0.1';
const MAX_BAN_ATTEMPTS = 20;

async function unbanLoopback(adminJar) {
  for (const ip of [E2E_CLIENT_IP, '127.0.0.1', '::1']) {
    await apiFetch(`/bans/${encodeURIComponent(ip)}`, { method: 'DELETE' }, adminJar);
  }
}

async function enableWorkers(adminJar) {
  const patch = await apiFetch(
    '/settings',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workersEnabled: true }),
    },
    adminJar,
  );
  if (!patch.ok) {
    const t = await patch.text();
    throw new Error(`Enable workers failed: ${patch.status} ${t}`);
  }
  const get = await apiFetch('/settings', {}, adminJar);
  if (!get.ok) throw new Error(`GET /settings failed: ${get.status}`);
  const settings = await get.json();
  if (!settings.workersEnabled) throw new Error('workersEnabled not true after enable');
  if (!settings.workersWsPath || !settings.workersSharedSecret) {
    throw new Error('workersWsPath / workersSharedSecret missing after enable');
  }
  return {
    path: settings.workersWsPath,
    secret: settings.workersSharedSecret,
  };
}

function closeQuietly(ws) {
  if (!ws) return;
  try {
    ws.close();
  } catch {
    /* ignore */
  }
}

export async function run({ runOne }) {
  const results = [];
  // Allow suite to run filtered (E2E_SUITE=Workers) without depending on Setup suite order.
  await completeSetup({ registrationEnabled: true, publicFeedsEnabled: true }).catch(() => {});
  const { jar: adminJar } = await loginAsAdmin();
  await unbanLoopback(adminJar);

  let creds = null;

  results.push(
    await runOne('Enable workers and read path/secret', async () => {
      creds = await enableWorkers(adminJar);
    }),
  );

  results.push(
    await runOne('Worker feature toggles round-trip', async () => {
      const patch = await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workersUseForTranscripts: false,
            workersUseForVideos: false,
            workersUseForFinalEpisodes: true,
          }),
        },
        adminJar,
      );
      if (!patch.ok) {
        const t = await patch.text();
        throw new Error(`PATCH worker toggles failed: ${patch.status} ${t}`);
      }
      const get = await apiFetch('/settings', {}, adminJar);
      if (!get.ok) throw new Error(`GET /settings failed: ${get.status}`);
      const settings = await get.json();
      if (settings.workersUseForTranscripts !== false) {
        throw new Error('workersUseForTranscripts expected false');
      }
      if (settings.workersUseForVideos !== false) {
        throw new Error('workersUseForVideos expected false');
      }
      if (settings.workersUseForFinalEpisodes !== true) {
        throw new Error('workersUseForFinalEpisodes expected true');
      }
      const restore = await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workersUseForTranscripts: true,
            workersUseForVideos: true,
            workersUseForFinalEpisodes: true,
          }),
        },
        adminJar,
      );
      if (!restore.ok) {
        const t = await restore.text();
        throw new Error(`Restore worker toggles failed: ${restore.status} ${t}`);
      }
    }),
  );

  results.push(
    await runOne('Worker auth_ok and workers-status shows connected', async () => {
      if (!creds) throw new Error('missing credentials from prior step');
      const name = 'e2e-worker-main';
      const conn = await connectWorkerWs({
        path: creds.path,
        secret: creds.secret,
        name,
      });
      if (!conn.ok) {
        throw new Error(
          `Expected auth_ok, got code=${conn.code} reason=${conn.reason} authError=${conn.authError}`,
        );
      }
      try {
        const statusRes = await apiFetch('/settings/workers-status', {}, adminJar);
        if (!statusRes.ok) {
          throw new Error(`workers-status failed: ${statusRes.status}`);
        }
        const status = await statusRes.json();
        if ((status.connected ?? 0) < 1) {
          throw new Error(`Expected connected >= 1, got ${JSON.stringify(status)}`);
        }
        const match = (status.workers || []).some(
          (w) => w.name === name && w.state,
        );
        if (!match) {
          throw new Error(
            `Expected worker named ${name} in status, got ${JSON.stringify(status.workers)}`,
          );
        }
      } finally {
        closeQuietly(conn.ws);
      }
    }),
  );

  results.push(
    await runOne('Wrong path closes with 1008 Unauthorized', async () => {
      const badPath = randomBytes(18).toString('hex');
      const conn = await connectWorkerWs({
        path: badPath,
        secret: 'irrelevant',
      });
      closeQuietly(conn.ws);
      if (conn.ok) throw new Error('Expected auth failure for wrong path');
      if (conn.code !== 1008) {
        throw new Error(`Expected close code 1008, got ${conn.code}`);
      }
      const reason = (conn.reason || '').toLowerCase();
      if (reason && !reason.includes('unauthorized') && !reason.includes('too many')) {
        throw new Error(`Unexpected reason for wrong path: ${conn.reason}`);
      }
    }),
  );

  results.push(
    await runOne('Wrong secret yields auth_error Invalid secret', async () => {
      if (!creds) throw new Error('missing credentials');
      await unbanLoopback(adminJar);
      const conn = await connectWorkerWs({
        path: creds.path,
        secret: 'wrong-secret-' + randomBytes(8).toString('hex'),
      });
      closeQuietly(conn.ws);
      if (conn.ok) throw new Error('Expected auth failure for wrong secret');
      if (conn.code !== 1008) {
        throw new Error(`Expected close code 1008, got ${conn.code}`);
      }
      if (conn.authError !== 'Invalid secret') {
        throw new Error(`Expected authError Invalid secret, got ${conn.authError}`);
      }
    }),
  );

  results.push(
    await runOne('Non-auth first message yields Expected auth', async () => {
      if (!creds) throw new Error('missing credentials');
      await unbanLoopback(adminJar);
      const conn = await connectWorkerWs({
        path: creds.path,
        secret: null,
        firstMessage: { type: 'ping' },
      });
      closeQuietly(conn.ws);
      if (conn.ok) throw new Error('Expected auth failure for non-auth message');
      if (conn.code !== 1008) {
        throw new Error(`Expected close code 1008, got ${conn.code}`);
      }
      if (conn.authError !== 'Expected auth') {
        throw new Error(`Expected authError Expected auth, got ${conn.authError}`);
      }
    }),
  );

  results.push(
    await runOne('Regenerate secrets invalidates old credentials', async () => {
      if (!creds) throw new Error('missing credentials');
      await unbanLoopback(adminJar);
      const oldPath = creds.path;
      const oldSecret = creds.secret;

      const regen = await apiFetch(
        '/settings/workers-regenerate-secrets',
        { method: 'POST' },
        adminJar,
      );
      if (!regen.ok) {
        throw new Error(`regenerate failed: ${regen.status} ${await regen.text()}`);
      }
      const body = await regen.json();
      if (!body.workersWsPath || !body.workersSharedSecret) {
        throw new Error('regenerate response missing credentials');
      }
      if (body.workersWsPath === oldPath || body.workersSharedSecret === oldSecret) {
        throw new Error('regenerate did not change path/secret');
      }

      const oldConn = await connectWorkerWs({
        path: oldPath,
        secret: oldSecret,
      });
      closeQuietly(oldConn.ws);
      if (oldConn.ok) throw new Error('Old credentials should fail after regenerate');

      const newConn = await connectWorkerWs({
        path: body.workersWsPath,
        secret: body.workersSharedSecret,
        name: 'e2e-worker-regen',
      });
      if (!newConn.ok) {
        throw new Error(
          `New credentials failed: code=${newConn.code} reason=${newConn.reason} authError=${newConn.authError}`,
        );
      }
      closeQuietly(newConn.ws);
      creds = {
        path: body.workersWsPath,
        secret: body.workersSharedSecret,
      };
    }),
  );

  results.push(
    await runOne('Wrong path/secret eventually bans IP; unban restores Invalid secret', async () => {
      if (!creds) throw new Error('missing credentials');
      await unbanLoopback(adminJar);

      let banned = false;
      for (let i = 0; i < MAX_BAN_ATTEMPTS; i++) {
        const conn = await connectWorkerWs({
          path: creds.path,
          secret: 'bad-' + randomBytes(8).toString('hex'),
          timeoutMs: 5000,
        });
        closeQuietly(conn.ws);
        const reason = (conn.reason || '').toLowerCase();
        if (reason.includes('too many failed')) {
          banned = true;
          break;
        }
        if (conn.ok) throw new Error('Unexpected auth_ok with bad secret');
      }
      if (!banned) {
        throw new Error(
          `Expected IP ban after ${MAX_BAN_ATTEMPTS} bad secret attempts`,
        );
      }

      const stillBanned = await connectWorkerWs({
        path: creds.path,
        secret: creds.secret,
        timeoutMs: 5000,
      });
      closeQuietly(stillBanned.ws);
      if (stillBanned.ok) {
        throw new Error('Expected ban to block even correct credentials');
      }
      if (!(stillBanned.reason || '').toLowerCase().includes('too many failed')) {
        throw new Error(
          `Expected Too many failed attempts while banned, got ${stillBanned.reason}`,
        );
      }

      await unbanLoopback(adminJar);

      const after = await connectWorkerWs({
        path: creds.path,
        secret: 'still-wrong-' + randomBytes(4).toString('hex'),
      });
      closeQuietly(after.ws);
      if (after.ok) throw new Error('Expected wrong secret to fail after unban');
      if (after.authError !== 'Invalid secret') {
        throw new Error(
          `After unban expected Invalid secret, got authError=${after.authError} reason=${after.reason}`,
        );
      }
    }),
  );

  await unbanLoopback(adminJar);

  results.push(
    await runOne('Disable workers so later suites are unaffected', async () => {
      const patch = await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workersEnabled: false }),
        },
        adminJar,
      );
      if (!patch.ok) {
        const t = await patch.text();
        throw new Error(`Disable workers failed: ${patch.status} ${t}`);
      }
      const get = await apiFetch('/settings', {}, adminJar);
      if (!get.ok) throw new Error(`GET /settings failed: ${get.status}`);
      const settings = await get.json();
      if (settings.workersEnabled) {
        throw new Error('workersEnabled still true after disable');
      }
    }),
  );

  return results;
}
