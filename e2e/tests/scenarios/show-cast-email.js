/**
 * E2E: Show cast private email field.
 * - Auth cast CRUD returns/persists email
 * - Public cast DTOs never expose email
 * - Episode cast includes email for authenticated clients
 * - Cast request-info emails profile update request (reply-to = clicker)
 * - Meeting invite with cast name+email works (quick-invite path)
 */
import {
  apiFetch,
  baseURL,
  completeSetup,
  createEpisode,
  createShow,
  loginAsAdmin,
} from '../../lib/helpers.js';
import { startHttpCatcher } from '../../lib/httpCatcher.js';

function emailContents(catcher) {
  return catcher.requests
    .map((r) => {
      if (r.json && typeof r.json === 'object' && r.json !== null && 'content' in r.json) {
        const content = String(/** @type {{ content?: unknown }} */ (r.json).content ?? '');
        if (/^Subject:\s*/i.test(content)) return content;
      }
      return '';
    })
    .filter((c) => c.length > 0);
}

function assertNoEmailField(obj, label) {
  if (obj == null || typeof obj !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(obj, 'email')) {
    throw new Error(`${label} must not include email field`);
  }
}

export async function run({ runOne }) {
  const results = [];

  try {
    const statusRes = await fetch(`${baseURL}/setup/status`);
    const status = statusRes.ok ? await statusRes.json() : null;
    if (status?.setupRequired) {
      await completeSetup({ registrationEnabled: true, publicFeedsEnabled: true });
    }
  } catch {
    await completeSetup({ registrationEnabled: true, publicFeedsEnabled: true }).catch(() => {});
  }

  const { jar } = await loginAsAdmin();
  const ts = Date.now();
  const slug = `e2e-cast-email-${ts}`;
  const podcast = await createShow(jar, {
    title: 'E2E Cast Email Show',
    slug,
  });

  let castId = null;
  const castEmail = `cast-host-${ts}@e2e.test`;

  results.push(
    await runOne('POST cast with email returns email on auth API', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}/cast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Email Host',
            role: 'host',
            email: castEmail,
            isPublic: 1,
          }),
        },
        jar,
      );
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`Create cast: expected 200/201, got ${res.status} ${await res.text()}`);
      }
      const body = await res.json();
      castId = body.id;
      if (!castId) throw new Error('Expected cast id');
      if (body.email !== castEmail) {
        throw new Error(`Expected email ${castEmail}, got ${JSON.stringify(body.email)}`);
      }
    }),
  );

  results.push(
    await runOne('GET cast list includes email for authenticated user', async () => {
      const res = await apiFetch(`/podcasts/${podcast.id}/cast?limit=20`, {}, jar);
      if (res.status !== 200) throw new Error(`List cast: expected 200, got ${res.status}`);
      const data = await res.json();
      const found = (data.cast ?? []).find((c) => c.id === castId);
      if (!found) throw new Error('Created cast missing from list');
      if (found.email !== castEmail) {
        throw new Error(`List email mismatch: ${JSON.stringify(found.email)}`);
      }
    }),
  );

  results.push(
    await runOne('PATCH cast email update and clear', async () => {
      const updated = `cast-host-updated-${ts}@e2e.test`;
      const patchRes = await apiFetch(
        `/podcasts/${podcast.id}/cast/${castId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: updated }),
        },
        jar,
      );
      if (patchRes.status !== 200) {
        throw new Error(`PATCH email: expected 200, got ${patchRes.status} ${await patchRes.text()}`);
      }
      const patched = await patchRes.json();
      if (patched.email !== updated) {
        throw new Error(`Expected updated email ${updated}, got ${JSON.stringify(patched.email)}`);
      }

      const clearRes = await apiFetch(
        `/podcasts/${podcast.id}/cast/${castId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: '' }),
        },
        jar,
      );
      if (clearRes.status !== 200) {
        throw new Error(`Clear email: expected 200, got ${clearRes.status}`);
      }
      const cleared = await clearRes.json();
      if (cleared.email != null) {
        throw new Error(`Expected null email after clear, got ${JSON.stringify(cleared.email)}`);
      }

      // Restore for later invite tests
      const restore = await apiFetch(
        `/podcasts/${podcast.id}/cast/${castId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: castEmail }),
        },
        jar,
      );
      if (restore.status !== 200) {
        throw new Error(`Restore email: expected 200, got ${restore.status}`);
      }
    }),
  );

  results.push(
    await runOne('POST cast rejects invalid email', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}/cast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Bad Email Guest',
            role: 'guest',
            email: 'not-an-email',
            isPublic: 1,
          }),
        },
        jar,
      );
      if (res.status === 200 || res.status === 201) {
        throw new Error('Expected invalid email to be rejected');
      }
      if (res.status !== 400) {
        throw new Error(`Expected 400 for invalid email, got ${res.status}`);
      }
    }),
  );

  results.push(
    await runOne('Public cast endpoints never expose email', async () => {
      const res = await fetch(`${baseURL}/public/podcasts/${encodeURIComponent(slug)}/cast`);
      if (res.status !== 200) throw new Error(`Public cast: expected 200, got ${res.status}`);
      const data = await res.json();
      for (const h of data.hosts ?? []) assertNoEmailField(h, 'public host');
      for (const g of data.guests ?? []) assertNoEmailField(g, 'public guest');
      const host = (data.hosts ?? []).find((h) => h.id === castId);
      if (!host) throw new Error('Public hosts should include Email Host');
      if (JSON.stringify(data).toLowerCase().includes(castEmail.toLowerCase())) {
        throw new Error('Public cast JSON must not contain private cast email');
      }
    }),
  );

  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Cast Email Episode',
    status: 'draft',
  });

  results.push(
    await runOne('Episode cast auth API returns email; public episode cast does not', async () => {
      const assignRes = await apiFetch(
        `/podcasts/${podcast.id}/episodes/${episode.id}/cast`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ castIds: [castId] }),
        },
        jar,
      );
      if (assignRes.status !== 200) {
        throw new Error(`Assign cast: expected 200, got ${assignRes.status} ${await assignRes.text()}`);
      }

      const authRes = await apiFetch(
        `/podcasts/${podcast.id}/episodes/${episode.id}/cast`,
        {},
        jar,
      );
      if (authRes.status !== 200) {
        throw new Error(`Auth episode cast: expected 200, got ${authRes.status}`);
      }
      const authData = await authRes.json();
      const member = (authData.cast ?? []).find((c) => c.id === castId);
      if (!member) throw new Error('Episode cast missing assigned member');
      if (member.email !== castEmail) {
        throw new Error(`Episode cast email mismatch: ${JSON.stringify(member.email)}`);
      }

      await apiFetch(
        `/episodes/${episode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'published', publishAt: null }),
        },
        jar,
      );

      const pubRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episode.slug)}/cast`,
      );
      if (pubRes.status !== 200) {
        throw new Error(`Public episode cast: expected 200, got ${pubRes.status}`);
      }
      const pubData = await pubRes.json();
      for (const c of pubData.cast ?? []) assertNoEmailField(c, 'public episode cast');
      if (JSON.stringify(pubData).toLowerCase().includes(castEmail.toLowerCase())) {
        throw new Error('Public episode cast must not contain private cast email');
      }
    }),
  );

  results.push(
    await runOne('POST cast request-info emails profile update request', async () => {
      const catcher = await startHttpCatcher();
      try {
        const photoUrl = 'https://example.com/cast-photo.jpg';
        const socialUrl = 'https://example.com/social';
        const patchRes = await apiFetch(
          `/podcasts/${podcast.id}/cast/${castId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: castEmail,
              photoUrl,
              socialLinks: [socialUrl],
            }),
          },
          jar,
        );
        if (patchRes.status !== 200) {
          throw new Error(
            `PATCH cast for request-info: expected 200, got ${patchRes.status} ${await patchRes.text()}`,
          );
        }

        const settingsRes = await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              emailProvider: 'webhook',
              emailWebhookUrl: catcher.baseUrl,
            }),
          },
          jar,
        );
        if (settingsRes.status !== 200) {
          throw new Error(`Expected 200 settings PATCH, got ${settingsRes.status}`);
        }

        catcher.reset();
        const sendRes = await apiFetch(
          `/podcasts/${podcast.id}/cast/${castId}/request-info`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          jar,
        );
        if (sendRes.status !== 200) {
          throw new Error(
            `request-info: expected 200, got ${sendRes.status} ${await sendRes.text()}`,
          );
        }
        const sendBody = await sendRes.json();
        if (sendBody.ok !== true) throw new Error(`Expected ok true, got ${JSON.stringify(sendBody)}`);

        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        if (
          !emails.some(
            (e) =>
              /update your cast profile/i.test(e) &&
              /Email Host/i.test(e) &&
              /E2E Cast Email Show/i.test(e) &&
              /reply/i.test(e) &&
              /social/i.test(e) &&
              /example\.com\/social/i.test(e),
          )
        ) {
          throw new Error(`Expected cast request-info email, got: ${JSON.stringify(emails)}`);
        }
        const webhook = catcher.requests.find((r) => r.json && typeof r.json === 'object');
        const payload = webhook?.json && typeof webhook.json === 'object' ? webhook.json : null;
        if (payload && typeof payload.reply_to === 'string') {
          if (!/admin@e2e\.test/i.test(payload.reply_to)) {
            throw new Error(`Expected reply_to admin@e2e.test, got ${payload.reply_to}`);
          }
        }
        if (payload && typeof payload.to === 'string' && payload.to !== castEmail) {
          throw new Error(`Expected to ${castEmail}, got ${payload.to}`);
        }
      } finally {
        await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailProvider: 'none' }),
          },
          jar,
        ).catch(() => {});
        await catcher.close();
      }
    }),
  );

  results.push(
    await runOne('Meeting invite with cast name+email (quick-invite path)', async () => {
      const catcher = await startHttpCatcher();
      try {
        const settingsRes = await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              emailProvider: 'webhook',
              emailWebhookUrl: catcher.baseUrl,
            }),
          },
          jar,
        );
        if (settingsRes.status !== 200) {
          throw new Error(`Expected 200 settings PATCH, got ${settingsRes.status}`);
        }

        const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const meetingRes = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodeId: episode.id, scheduledStartAt: startAt }),
          },
          jar,
        );
        if (meetingRes.status !== 200 && meetingRes.status !== 201) {
          throw new Error(
            `Create meeting: expected 200/201, got ${meetingRes.status} ${await meetingRes.text()}`,
          );
        }
        const meeting = await meetingRes.json();
        const meetingId = meeting.meeting?.id ?? meeting.id;
        if (!meetingId) throw new Error('Expected meeting id');

        // Ignore creator confirmation email from meeting create
        catcher.reset();

        const inviteRes = await apiFetch(
          `/call/meetings/${meetingId}/invites`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Email Host', email: castEmail }),
          },
          jar,
        );
        if (inviteRes.status !== 200) {
          throw new Error(`Invite: expected 200, got ${inviteRes.status} ${await inviteRes.text()}`);
        }
        const inviteBody = await inviteRes.json();
        if (!inviteBody.invite?.id) throw new Error('Expected invite row');
        if (inviteBody.invite.emailSent !== true) {
          throw new Error(
            `Expected emailSent true, got ${inviteBody.invite.emailSent} (${inviteBody.invite.emailError})`,
          );
        }

        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        if (
          !emails.some(
            (e) =>
              /you're invited/i.test(e) &&
              /Email Host/i.test(e) &&
              /E2E Cast Email Show/i.test(e),
          )
        ) {
          throw new Error(`Expected cast quick-invite email, got: ${JSON.stringify(emails)}`);
        }

        await apiFetch(`/call/meetings/${meetingId}/cancel`, { method: 'POST' }, jar);
      } finally {
        await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailProvider: 'none' }),
          },
          jar,
        ).catch(() => {});
        await catcher.close();
      }
    }),
  );

  return results;
}
