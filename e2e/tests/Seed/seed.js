/**
 * E2E tests for password seed functionality.
 * Run via: pnpm run e2e:seed (starts server with ADMIN_EMAIL + ADMIN_PASSWORD, runs db:seedSetup first).
 * Expects admin to already exist from seed; no setup token or /setup/complete.
 */
import { baseURL, cookieJar, login } from '../../lib/helpers.js';

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'seed-admin@e2e.test';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'seed-password-123';

export async function run({ runOne }) {
  const results = [];

  results.push(
    await runOne('GET /setup/status returns setupRequired false after seed', async () => {
      const res = await fetch(`${baseURL}/setup/status`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.setupRequired !== false) {
        throw new Error(`Expected setupRequired: false (admin was seeded), got ${JSON.stringify(data)}`);
      }
    })
  );

  results.push(
    await runOne('POST /auth/login with seeded admin email and password succeeds', async () => {
      const jar = cookieJar();
      const { user } = await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, jar);
      if (!user || !user.email) throw new Error('Expected user with email');
      if (user.email.toLowerCase() !== SEED_ADMIN_EMAIL.toLowerCase()) {
        throw new Error(`Expected user.email ${SEED_ADMIN_EMAIL}, got ${user.email}`);
      }
      if (!user.id) throw new Error('Expected user.id');
    })
  );

  results.push(
    await runOne('POST /auth/login with wrong password fails', async () => {
      const res = await fetch(`${baseURL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: SEED_ADMIN_EMAIL, password: 'wrong-password' }),
        redirect: 'manual',
      });
      if (res.status === 200) {
        const data = await res.json();
        if (data.user) throw new Error('Expected login to fail with wrong password');
      }
      if (res.status !== 401 && res.status !== 200) {
        throw new Error(`Expected 401 or 200 with no user, got ${res.status}`);
      }
    })
  );

  results.push(
    await runOne('Seeded admin can access /auth/me', async () => {
      const jar = cookieJar();
      await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, jar);
      const res = await fetch(`${baseURL}/auth/me`, {
        headers: jar.apply(),
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const meUser = data.user ?? data;
      if (meUser.email?.toLowerCase() !== SEED_ADMIN_EMAIL.toLowerCase()) {
        throw new Error(`Expected /auth/me to return seeded admin, got ${JSON.stringify(data)}`);
      }
      if (meUser.role !== 'admin') throw new Error(`Expected role admin, got ${meUser.role}`);
    })
  );

  return results;
}
