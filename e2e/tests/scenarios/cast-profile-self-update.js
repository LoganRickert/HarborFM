/**
 * E2E: Cast profile self-update (email link + pending approval).
 * - Update email includes form link; cast list shows active invite
 * - Latest token only
 * - Public submit creates/upserts pending (incl. socials); host notify mail
 * - Expire unused invite
 * - Approve applies + cast notify mail
 * - Throttle fourth submit within the hour
 */
import {
  apiFetch,
  baseURL,
  completeSetup,
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

function extractUpdateToken(emailText) {
  const match = emailText.match(
    /\/cast-profile-update\?token=([A-Za-z0-9_\-%]+)/,
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
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
  const slug = `e2e-cast-self-update-${ts}`;
  const podcast = await createShow(jar, {
    title: 'E2E Cast Self Update Show',
    slug,
  });

  const castEmail = `cast-self-${ts}@e2e.test`;
  let castId = null;
  /** @type {string | null} */
  let token1 = null;
  /** @type {string | null} */
  let token2 = null;

  results.push(
    await runOne('Create cast with email for self-update', async () => {
      const res = await apiFetch(
        `/podcasts/${podcast.id}/cast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Self Update Guest',
            role: 'guest',
            email: castEmail,
            description: 'Original description',
            socialLinks: ['https://example.com/old'],
            timeZone: 'America/New_York',
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
      if (body.timeZone !== 'America/New_York') {
        throw new Error(`Expected timeZone America/New_York, got ${body.timeZone}`);
      }
    }),
  );

  results.push(
    await runOne('Update email includes form link and active invite flag', async () => {
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
        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        const updateMail = emails.find((e) => /update your cast profile/i.test(e));
        if (!updateMail) {
          throw new Error(`Expected update email, got: ${JSON.stringify(emails)}`);
        }
        if (!/cast-profile-update\?token=/i.test(updateMail)) {
          throw new Error('Expected cast-profile-update form link in email');
        }
        token1 = extractUpdateToken(updateMail);
        if (!token1) throw new Error('Could not extract update token from email');

        const listRes = await apiFetch(`/podcasts/${podcast.id}/cast?limit=20`, {}, jar);
        if (listRes.status !== 200) throw new Error(`List cast: ${listRes.status}`);
        const list = await listRes.json();
        const found = (list.cast ?? []).find((c) => c.id === castId);
        if (!found?.hasActiveProfileInvite) {
          throw new Error('Expected hasActiveProfileInvite true after Update email');
        }
        if (found.hasPendingProfileUpdate) {
          throw new Error('Expected hasPendingProfileUpdate false before submit');
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
    await runOne('Latest token only after second Update', async () => {
      const catcher = await startHttpCatcher();
      try {
        await apiFetch(
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
        catcher.reset();
        const sendRes = await apiFetch(
          `/podcasts/${podcast.id}/cast/${castId}/request-info`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          jar,
        );
        if (sendRes.status !== 200) {
          throw new Error(`second request-info: ${sendRes.status} ${await sendRes.text()}`);
        }
        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        const updateMail = emails.find((e) => /cast-profile-update\?token=/i.test(e));
        token2 = extractUpdateToken(updateMail || '');
        if (!token2) throw new Error('Missing second token');
        if (token2 === token1) throw new Error('Expected rotated token to differ');

        const oldGet = await fetch(
          `${baseURL}/public/cast-profile-update?token=${encodeURIComponent(token1)}`,
        );
        const oldBody = await oldGet.json();
        if (oldBody.state !== 'invalid') {
          throw new Error(`Old token should be invalid, got ${JSON.stringify(oldBody)}`);
        }

        const newGet = await fetch(
          `${baseURL}/public/cast-profile-update?token=${encodeURIComponent(token2)}`,
        );
        const newBody = await newGet.json();
        if (newBody.state !== 'ok') {
          throw new Error(`New token should work, got ${JSON.stringify(newBody)}`);
        }
        if (!Array.isArray(newBody.socialLinks)) {
          throw new Error('Expected socialLinks on form GET');
        }
        if (newBody.timeZone !== 'America/New_York') {
          throw new Error(`Expected form timeZone America/New_York, got ${newBody.timeZone}`);
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
    await runOne('Public submit creates pending and upserts', async () => {
      const catcher = await startHttpCatcher();
      try {
        await apiFetch(
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
        catcher.reset();

        const submit1 = await fetch(`${baseURL}/public/cast-profile-update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token2,
            name: 'Proposed Name',
            nickname: 'Nick',
            description: 'Proposed description',
            socialLinks: ['https://example.com/new-social'],
            timeZone: 'America/Chicago',
          }),
        });
        if (submit1.status !== 200) {
          throw new Error(`submit1: ${submit1.status} ${await submit1.text()}`);
        }

        await catcher.waitFor(1, 10000);
        const hostMails = emailContents(catcher);
        if (!hostMails.some((e) => /cast profile update pending/i.test(e))) {
          throw new Error(`Expected host pending notify, got ${JSON.stringify(hostMails)}`);
        }

        const listRes = await apiFetch(`/podcasts/${podcast.id}/cast?limit=20`, {}, jar);
        const list = await listRes.json();
        const found = (list.cast ?? []).find((c) => c.id === castId);
        if (!found?.hasPendingProfileUpdate) {
          throw new Error('Expected hasPendingProfileUpdate after submit');
        }
        if (found.hasActiveProfileInvite) {
          throw new Error('Active invite flag should be false when pending exists');
        }

        const submit2 = await fetch(`${baseURL}/public/cast-profile-update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token2,
            name: 'Proposed Name 2',
            nickname: 'Nick2',
            description: 'Proposed description 2',
            socialLinks: [
              'https://example.com/new-social',
              'https://example.com/second',
            ],
            timeZone: 'America/Los_Angeles',
          }),
        });
        if (submit2.status !== 200) {
          throw new Error(`submit2 upsert: ${submit2.status} ${await submit2.text()}`);
        }

        const pendingRes = await apiFetch(
          `/podcasts/${podcast.id}/cast/${castId}/profile-pending`,
          {},
          jar,
        );
        if (pendingRes.status !== 200) {
          throw new Error(`pending GET: ${pendingRes.status} ${await pendingRes.text()}`);
        }
        const pending = await pendingRes.json();
        if (pending.pending?.name !== 'Proposed Name 2') {
          throw new Error(`Expected upserted name, got ${JSON.stringify(pending.pending)}`);
        }
        if ((pending.pending?.socialLinks || []).length !== 2) {
          throw new Error(`Expected 2 social links, got ${JSON.stringify(pending.pending?.socialLinks)}`);
        }
        if (pending.pending?.timeZone !== 'America/Los_Angeles') {
          throw new Error(
            `Expected pending timeZone America/Los_Angeles, got ${pending.pending?.timeZone}`,
          );
        }
        if (pending.current?.timeZone !== 'America/New_York') {
          throw new Error(
            `Expected current timeZone America/New_York, got ${pending.current?.timeZone}`,
          );
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
    await runOne('Expire unused invite rejects token', async () => {
      // Create a second cast so we can expire without pending.
      const res = await apiFetch(
        `/podcasts/${podcast.id}/cast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Expire Invite Guest',
            role: 'guest',
            email: `expire-${ts}@e2e.test`,
            isPublic: 1,
          }),
        },
        jar,
      );
      const expireCast = await res.json();
      const expireCastId = expireCast.id;
      const catcher = await startHttpCatcher();
      try {
        await apiFetch(
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
        catcher.reset();
        await apiFetch(
          `/podcasts/${podcast.id}/cast/${expireCastId}/request-info`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          jar,
        );
        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        const token = extractUpdateToken(emails.find((e) => /cast-profile-update/i.test(e)) || '');
        if (!token) throw new Error('Missing expire-test token');

        const expireRes = await apiFetch(
          `/podcasts/${podcast.id}/cast/${expireCastId}/profile-invite/expire`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          jar,
        );
        if (expireRes.status !== 200) {
          throw new Error(`expire: ${expireRes.status} ${await expireRes.text()}`);
        }
        const expiredBody = await expireRes.json();
        if (expiredBody.hasActiveProfileInvite) {
          throw new Error('Expected invite expired');
        }

        const getRes = await fetch(
          `${baseURL}/public/cast-profile-update?token=${encodeURIComponent(token)}`,
        );
        const getBody = await getRes.json();
        if (getBody.state !== 'invalid') {
          throw new Error(`Expired token should be invalid, got ${JSON.stringify(getBody)}`);
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
    await runOne('Disregard pending does not email cast', async () => {
      const createRes = await apiFetch(
        `/podcasts/${podcast.id}/cast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Disregard Guest',
            role: 'guest',
            email: `disregard-${ts}@e2e.test`,
            isPublic: 1,
          }),
        },
        jar,
      );
      if (createRes.status !== 200 && createRes.status !== 201) {
        throw new Error(`Create disregard cast: ${createRes.status}`);
      }
      const disregardCast = await createRes.json();
      const disregardCastId = disregardCast.id;

      const catcher = await startHttpCatcher();
      try {
        await apiFetch(
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
        catcher.reset();
        await apiFetch(
          `/podcasts/${podcast.id}/cast/${disregardCastId}/request-info`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          jar,
        );
        await catcher.waitFor(1, 10000);
        const token = extractUpdateToken(
          emailContents(catcher).find((e) => /cast-profile-update/i.test(e)) || '',
        );
        if (!token) throw new Error('Missing disregard-test token');

        const submitRes = await fetch(`${baseURL}/public/cast-profile-update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            name: 'Should Be Discarded',
            socialLinks: ['https://example.com/discard'],
          }),
        });
        if (submitRes.status !== 200) {
          throw new Error(`disregard submit: ${submitRes.status} ${await submitRes.text()}`);
        }

        catcher.reset();
        const disregardRes = await apiFetch(
          `/podcasts/${podcast.id}/cast/${disregardCastId}/profile-pending/disregard`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          jar,
        );
        if (disregardRes.status !== 200) {
          throw new Error(
            `disregard: ${disregardRes.status} ${await disregardRes.text()}`,
          );
        }
        const body = await disregardRes.json();
        if (body.hasPendingProfileUpdate) {
          throw new Error('Pending flag should clear after disregard');
        }
        if (body.name !== 'Disregard Guest') {
          throw new Error(`Cast name should be unchanged, got ${body.name}`);
        }
        if (!body.hasActiveProfileInvite) {
          throw new Error('Invite token should remain active after disregard');
        }

        const stillValid = await fetch(
          `${baseURL}/public/cast-profile-update?token=${encodeURIComponent(token)}`,
        );
        const stillBody = await stillValid.json();
        if (stillBody.state !== 'ok') {
          throw new Error(
            `Token should still work after disregard, got ${JSON.stringify(stillBody)}`,
          );
        }

        await new Promise((r) => setTimeout(r, 500));
        const mails = emailContents(catcher);
        if (mails.some((e) => /profile was updated|approved/i.test(e))) {
          throw new Error(`Disregard must not email cast, got ${JSON.stringify(mails)}`);
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
    await runOne('Approve applies pending and notifies cast', async () => {
      const catcher = await startHttpCatcher();
      try {
        await apiFetch(
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
        catcher.reset();
        const approveRes = await apiFetch(
          `/podcasts/${podcast.id}/cast/${castId}/profile-pending/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'Approved Name',
              nickname: 'ApprovedNick',
              description: 'Approved description',
              socialLinks: ['https://example.com/approved'],
              timeZone: 'America/Denver',
            }),
          },
          jar,
        );
        if (approveRes.status !== 200) {
          throw new Error(`approve: ${approveRes.status} ${await approveRes.text()}`);
        }
        const approved = await approveRes.json();
        if (approved.name !== 'Approved Name') {
          throw new Error(`Expected Approved Name, got ${approved.name}`);
        }
        if ((approved.socialLinks || [])[0] !== 'https://example.com/approved') {
          throw new Error(`Expected approved socials, got ${JSON.stringify(approved.socialLinks)}`);
        }
        if (approved.timeZone !== 'America/Denver') {
          throw new Error(`Expected approved timeZone America/Denver, got ${approved.timeZone}`);
        }
        if (approved.hasPendingProfileUpdate) {
          throw new Error('Pending flag should clear after approve');
        }
        if (!approved.hasActiveProfileInvite) {
          throw new Error('Invite token should remain active after approve');
        }

        const stillValid = await fetch(
          `${baseURL}/public/cast-profile-update?token=${encodeURIComponent(token2)}`,
        );
        const stillBody = await stillValid.json();
        if (stillBody.state !== 'ok') {
          throw new Error(
            `Token should still work after approve, got ${JSON.stringify(stillBody)}`,
          );
        }

        await catcher.waitFor(1, 10000);
        const mails = emailContents(catcher);
        if (!mails.some((e) => /profile was updated/i.test(e) || /profile update was approved/i.test(e))) {
          throw new Error(`Expected cast approval email, got ${JSON.stringify(mails)}`);
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
    await runOne('Public submit throttles after 3 per hour', async () => {
      const createRes = await apiFetch(
        `/podcasts/${podcast.id}/cast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Throttle Guest',
            role: 'guest',
            email: `throttle-${ts}@e2e.test`,
            isPublic: 1,
          }),
        },
        jar,
      );
      if (createRes.status !== 200 && createRes.status !== 201) {
        throw new Error(`Create throttle cast: ${createRes.status}`);
      }
      const throttleCast = await createRes.json();
      const throttleCastId = throttleCast.id;

      const catcher = await startHttpCatcher();
      try {
        await apiFetch(
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
        catcher.reset();
        await apiFetch(
          `/podcasts/${podcast.id}/cast/${throttleCastId}/request-info`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          jar,
        );
        await catcher.waitFor(1, 10000);
        const token = extractUpdateToken(
          emailContents(catcher).find((e) => /cast-profile-update/i.test(e)) || '',
        );
        if (!token) throw new Error('Missing throttle-test token');

        for (let i = 0; i < 3; i++) {
          const res = await fetch(`${baseURL}/public/cast-profile-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              name: `Throttle ${i}`,
              socialLinks: [],
            }),
          });
          if (res.status !== 200) {
            throw new Error(`throttle submit ${i}: ${res.status} ${await res.text()}`);
          }
        }
        const fourth = await fetch(`${baseURL}/public/cast-profile-update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            name: 'Throttle 3',
            socialLinks: [],
          }),
        });
        if (fourth.status !== 429) {
          throw new Error(`Expected 429 on fourth submit, got ${fourth.status} ${await fourth.text()}`);
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

  return results;
}
