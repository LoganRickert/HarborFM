import { baseURL } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const apiBase = baseURL.replace(/\/$/, '');

  results.push(
    await runOne('GET /docs/json returns 200 and valid OpenAPI spec', async () => {
      const res = await fetch(`${apiBase}/docs/json`);
      if (res.status !== 200) throw new Error(`Expected 200 for /docs/json, got ${res.status}`);
      const data = await res.json();
      if (data.openapi !== '3.0.0' && !data.swagger) throw new Error('Expected OpenAPI or Swagger spec');
      if (!data.paths || typeof data.paths !== 'object') throw new Error('Expected paths object in spec');
    })
  );

  results.push(
    await runOne('GET /docs returns 200 (Swagger UI)', async () => {
      const res = await fetch(`${apiBase}/docs`);
      if (res.status !== 200) throw new Error(`Expected 200 for /docs, got ${res.status}`);
      const text = await res.text();
      if (!text.includes('swagger') && !text.includes('openapi')) throw new Error('Expected Swagger/OpenAPI UI HTML');
    })
  );

  return results;
}
