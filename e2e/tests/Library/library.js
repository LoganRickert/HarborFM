import { apiFetch, loginAsAdmin } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('GET /library returns assets list', async () => {
      const res = await apiFetch('/library', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.assets)) throw new Error('Expected assets array');
    })
  );

  return results;
}
