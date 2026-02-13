import { baseURL } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];

  results.push(
    await runOne('POST /contact accepts body (may return 400/503 without email config)', async () => {
      const res = await fetch(`${baseURL}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@e2e.test', message: 'E2E test message', name: 'E2E' }),
      });
      if (res.status !== 200 && res.status !== 400 && res.status !== 503) {
        throw new Error(`Expected 200, 400, or 503 (email not configured), got ${res.status}`);
      }
    })
  );

  return results;
}
