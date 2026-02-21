/**
 * Subscriber-only messages: podcast setting and contact API enforcement.
 * - PATCH subscriberOnlyMessages persists and is returned by public podcast GET.
 * - POST /contact with podcastSlug when subscriberOnlyMessages is on returns 403 without subscriber auth.
 * - POST /contact with podcastSlug when subscriberOnlyMessages is on returns 200 with subscriber cookie.
 */
import {
  baseURL,
  apiFetch,
  loginAsAdmin,
  createShow,
  cookieJar,
} from '../../lib/helpers.js';

function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const one = res.headers.get('set-cookie');
  return one ? [one] : [];
}

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const slug = `e2e-msg-only-${Date.now()}`;
  const podcast = await createShow(jar, { title: 'E2E Subscriber Only Messages', slug, description: '' });

  results.push(
    await runOne('PATCH podcast subscriberOnlyFeedEnabled + subscriberOnlyMessages, GET public returns subscriber_only_messages', async () => {
      await apiFetch(`/podcasts/${podcast.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriberOnlyFeedEnabled: 1, subscriberOnlyMessages: 1 }),
      }, jar);
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const val = data.subscriber_only_messages;
      if (val !== 1 && val !== true) {
        throw new Error(`Expected subscriber_only_messages 1 or true, got ${JSON.stringify(val)}`);
      }
    })
  );

  results.push(
    await runOne('POST /contact with podcastSlug when subscriberOnlyMessages: no cookie returns 403', async () => {
      const res = await fetch(`${baseURL}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E',
          email: 'e2e@e2e.test',
          message: 'Test message',
          podcastSlug: slug,
        }),
      });
      if (res.status !== 403) throw new Error(`Expected 403 without subscriber auth, got ${res.status}`);
      const data = await res.json();
      if (!data.error || !data.error.toLowerCase().includes('subscriber')) {
        throw new Error(`Expected error about subscribers, got ${JSON.stringify(data)}`);
      }
    })
  );

  results.push(
    await runOne('POST /contact with podcastSlug when subscriberOnlyMessages: with subscriber cookie returns 200', async () => {
      const createRes = await apiFetch(`/podcasts/${podcast.id}/subscriber-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Contact Token' }),
      }, jar);
      if (createRes.status !== 201) throw new Error(`Expected 201 creating token, got ${createRes.status}`);
      const created = await createRes.json();

      const authRes = await fetch(`${baseURL}/public/subscriber-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token, podcastSlug: slug }),
      });
      if (authRes.status !== 200) throw new Error(`Expected 200 from subscriber-auth, got ${authRes.status}`);

      const publicJar = cookieJar();
      publicJar.store(getSetCookies(authRes));

      const contactRes = await fetch(`${baseURL}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...publicJar.apply() },
        body: JSON.stringify({
          name: 'E2E',
          email: 'e2e@e2e.test',
          message: 'Test message with subscriber auth',
          podcastSlug: slug,
        }),
      });
      if (contactRes.status !== 200) throw new Error(`Expected 200 with subscriber cookie, got ${contactRes.status}`);
      const contactData = await contactRes.json();
      if (contactData.ok !== true) throw new Error(`Expected ok: true, got ${JSON.stringify(contactData)}`);
    })
  );

  return results;
}
