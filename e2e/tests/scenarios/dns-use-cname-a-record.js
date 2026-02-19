/**
 * E2E: Use CNAME toggle and A record IP (Settings).
 *
 * - GET /settings returns dnsUseCname (default true) and dnsARecordIp (default "").
 * - PATCH can set dnsUseCname false and dnsARecordIp to an IP; GET returns them.
 * - PATCH can set dnsUseCname true again; dnsARecordIp is preserved.
 *
 * DNS provider stays "none" so Cloudflare is not called; we only test settings round-trip.
 */
import { apiFetch, loginAsAdmin } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('GET /settings returns dnsUseCname true and dnsARecordIp by default', async () => {
      const res = await apiFetch('/settings', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dnsUseCname !== true) {
        throw new Error(`Expected dnsUseCname true by default, got ${data.dnsUseCname}`);
      }
      if (data.dnsARecordIp !== '' && data.dnsARecordIp != null) {
        throw new Error(`Expected dnsARecordIp empty by default, got ${JSON.stringify(data.dnsARecordIp)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH /settings can set dnsUseCname false and dnsARecordIp', async () => {
      const res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnsUseCname: false,
          dnsARecordIp: '192.0.2.1',
        }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dnsUseCname !== false) {
        throw new Error(`Expected dnsUseCname false, got ${data.dnsUseCname}`);
      }
      if ((data.dnsARecordIp || '').trim() !== '192.0.2.1') {
        throw new Error(`Expected dnsARecordIp "192.0.2.1", got ${JSON.stringify(data.dnsARecordIp)}`);
      }
    })
  );

  results.push(
    await runOne('GET /settings returns updated dnsUseCname and dnsARecordIp', async () => {
      const res = await apiFetch('/settings', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dnsUseCname !== false) throw new Error(`Expected dnsUseCname false, got ${data.dnsUseCname}`);
      if ((data.dnsARecordIp || '').trim() !== '192.0.2.1') {
        throw new Error(`Expected dnsARecordIp "192.0.2.1", got ${JSON.stringify(data.dnsARecordIp)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH /settings can set dnsUseCname true again', async () => {
      const res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsUseCname: true }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dnsUseCname !== true) throw new Error(`Expected dnsUseCname true, got ${data.dnsUseCname}`);
      if ((data.dnsARecordIp || '').trim() !== '192.0.2.1') {
        throw new Error(`Expected dnsARecordIp still "192.0.2.1", got ${JSON.stringify(data.dnsARecordIp)}`);
      }
    })
  );

  results.push(
    await runOne('Restore dnsUseCname and clear dnsARecordIp', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnsUseCname: true, dnsARecordIp: '' }),
      }, jar);
    })
  );

  return results;
}
