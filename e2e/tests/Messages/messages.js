import { apiFetch, loginAsAdmin } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('GET /messages returns list', async () => {
      const res = await apiFetch('/messages', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.messages)) throw new Error('Expected messages array');
    })
  );

  return results;
}
