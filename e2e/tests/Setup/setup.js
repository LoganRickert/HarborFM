import { baseURL, getSetupToken, completeSetup, cookieJar, login } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];

  results.push(
    await runOne('GET /setup/status returns setupRequired true before setup', async () => {
      const res = await fetch(`${baseURL}/setup/status`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.setupRequired !== true) throw new Error('Expected setupRequired: true');
    })
  );

  results.push(
    await runOne('GET /setup/validate with valid token returns 200 ok', async () => {
      const token = getSetupToken();
      const res = await fetch(`${baseURL}/setup/validate?id=${encodeURIComponent(token)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.ok !== true) throw new Error('Expected ok: true');
    })
  );

  results.push(
    await runOne('POST /setup/complete creates admin and completes setup', async () => {
      await completeSetup({ registration_enabled: true, public_feeds_enabled: true });
      const res = await fetch(`${baseURL}/setup/status`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.setupRequired !== false) throw new Error('Expected setupRequired: false after setup');
    })
  );

  results.push(
    await runOne('GET /setup/status after setup returns registrationEnabled and publicFeedsEnabled', async () => {
      const res = await fetch(`${baseURL}/setup/status`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.registrationEnabled !== true) throw new Error('Expected registrationEnabled: true');
      if (data.publicFeedsEnabled !== true) throw new Error('Expected publicFeedsEnabled: true');
    })
  );

  return results;
}
