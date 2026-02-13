import { baseURL } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];

  results.push(
    await runOne('GET /health returns 200 and ok', async () => {
      const res = await fetch(`${baseURL}/health`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.ok !== true) throw new Error('Expected ok: true');
    })
  );

  results.push(
    await runOne('GET /version returns 200', async () => {
      const res = await fetch(`${baseURL}/version`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (typeof data.version !== 'string') throw new Error('Expected version string');
    })
  );

  return results;
}
