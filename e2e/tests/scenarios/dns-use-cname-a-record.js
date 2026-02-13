/**
 * E2E: Use CNAME toggle and A record IP (Settings).
 *
 * - GET /settings returns dns_use_cname (default true) and dns_a_record_ip (default "").
 * - PATCH can set dns_use_cname false and dns_a_record_ip to an IP; GET returns them.
 * - PATCH can set dns_use_cname true again; dns_a_record_ip is preserved.
 *
 * DNS provider stays "none" so Cloudflare is not called; we only test settings round-trip.
 */
import { apiFetch, loginAsAdmin } from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();

  results.push(
    await runOne('GET /settings returns dns_use_cname true and dns_a_record_ip by default', async () => {
      const res = await apiFetch('/settings', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dns_use_cname !== true) {
        throw new Error(`Expected dns_use_cname true by default, got ${data.dns_use_cname}`);
      }
      if (data.dns_a_record_ip !== '' && data.dns_a_record_ip != null) {
        throw new Error(`Expected dns_a_record_ip empty by default, got ${JSON.stringify(data.dns_a_record_ip)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH /settings can set dns_use_cname false and dns_a_record_ip', async () => {
      const res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns_use_cname: false,
          dns_a_record_ip: '192.0.2.1',
        }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dns_use_cname !== false) {
        throw new Error(`Expected dns_use_cname false, got ${data.dns_use_cname}`);
      }
      if ((data.dns_a_record_ip || '').trim() !== '192.0.2.1') {
        throw new Error(`Expected dns_a_record_ip "192.0.2.1", got ${JSON.stringify(data.dns_a_record_ip)}`);
      }
    })
  );

  results.push(
    await runOne('GET /settings returns updated dns_use_cname and dns_a_record_ip', async () => {
      const res = await apiFetch('/settings', {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dns_use_cname !== false) throw new Error(`Expected dns_use_cname false, got ${data.dns_use_cname}`);
      if ((data.dns_a_record_ip || '').trim() !== '192.0.2.1') {
        throw new Error(`Expected dns_a_record_ip "192.0.2.1", got ${JSON.stringify(data.dns_a_record_ip)}`);
      }
    })
  );

  results.push(
    await runOne('PATCH /settings can set dns_use_cname true again', async () => {
      const res = await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_use_cname: true }),
      }, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.dns_use_cname !== true) throw new Error(`Expected dns_use_cname true, got ${data.dns_use_cname}`);
      if ((data.dns_a_record_ip || '').trim() !== '192.0.2.1') {
        throw new Error(`Expected dns_a_record_ip still "192.0.2.1", got ${JSON.stringify(data.dns_a_record_ip)}`);
      }
    })
  );

  results.push(
    await runOne('Restore dns_use_cname and clear dns_a_record_ip', async () => {
      await apiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dns_use_cname: true, dns_a_record_ip: '' }),
      }, jar);
    })
  );

  return results;
}
