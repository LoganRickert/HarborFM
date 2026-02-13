import { apiFetch, loginAsAdmin } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('GET /llm/available returns provider info', async () => {
      const res = await apiFetch('/llm/available', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (typeof data.available !== 'boolean' && typeof data.provider === 'undefined') {
        throw new Error('Expected available or provider in response');
      }
    })
  );

  return results;
}
