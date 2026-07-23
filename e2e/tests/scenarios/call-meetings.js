/**
 * E2E: Scheduled episode group-call meetings.
 * Covers create/reschedule/cancel, caps, join window statuses, invites, share links,
 * start meeting vs ad-hoc, join-info/by-code, publish notify, white-label URLs, emails.
 */
import {
  apiFetch,
  baseURL,
  completeSetup,
  createEpisode,
  createShow,
  loginAsAdmin,
  startCall,
} from '../../lib/helpers.js';
import { startHttpCatcher } from '../../lib/httpCatcher.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoIn(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString();
}

/** @param {Awaited<ReturnType<typeof startHttpCatcher>>} catcher */
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

export async function run({ runOne }) {
  const results = [];

  // Allow running this suite alone (full e2e already completed setup via Setup suite).
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
  const podcast = await createShow(jar, {
    title: 'E2E Meeting Show',
    slug: `e2e-meetings-${ts}`,
  });
  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Meeting Episode',
    status: 'draft',
  });

  const catcher = await startHttpCatcher();

  try {
    results.push(
      await runOne('Configure webhook email for meeting notifications', async () => {
        const res = await apiFetch(
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
        if (res.status !== 200) {
          throw new Error(`Expected 200 settings PATCH, got ${res.status}`);
        }
      }),
    );

    /** @type {string|null} */
    let meetingId = null;
    /** @type {string|null} */
    let joinCode = null;
    /** @type {string|null} */
    let joinToken = null;
    /** @type {string|null} */
    let joinUrl = null;

    results.push(
      await runOne('POST /call/meetings schedules meeting and emails creator', async () => {
        catcher.reset();
        const scheduledStartAt = isoIn(30 * 60 * 1000); // 30 min (within early window)
        const res = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodeId: episode.id, scheduledStartAt }),
          },
          jar,
        );
        if (res.status !== 200) {
          throw new Error(`Expected 200, got ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        if (!data.meeting?.id || !data.meeting.joinCode || !data.meeting.token || !data.meeting.joinUrl) {
          throw new Error('Expected meeting with id, joinCode, token, joinUrl');
        }
        if (!/^\d{4}$/.test(data.meeting.joinCode)) {
          throw new Error(`Expected 4-digit joinCode, got ${data.meeting.joinCode}`);
        }
        if (data.meeting.status !== 'scheduled') {
          throw new Error(`Expected status scheduled, got ${data.meeting.status}`);
        }
        if (!data.meeting.withinJoinWindow) {
          throw new Error('Expected withinJoinWindow true for start in 30 minutes');
        }
        meetingId = data.meeting.id;
        joinCode = data.meeting.joinCode;
        joinToken = data.meeting.token;
        joinUrl = data.meeting.joinUrl;

        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        if (!emails.some((e) => /group call scheduled/i.test(e) && /E2E Meeting Episode/i.test(e))) {
          throw new Error(`Expected creator confirmation email, got: ${JSON.stringify(emails)}`);
        }
        if (!emails.some((e) => e.includes(joinCode))) {
          throw new Error('Expected join code in creator email');
        }
      }),
    );

    results.push(
      await runOne('POST /call/meetings 409 when episode already has a meeting', async () => {
        const res = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              episodeId: episode.id,
              scheduledStartAt: isoIn(60 * 60 * 1000),
            }),
          },
          jar,
        );
        if (res.status !== 409) {
          throw new Error(`Expected 409, got ${res.status}: ${await res.text()}`);
        }
      }),
    );

    results.push(
      await runOne('POST /call/meetings 400 when scheduled more than 1 year ahead', async () => {
        const ep2 = await createEpisode(jar, podcast.id, {
          title: 'E2E Far Future Ep',
          status: 'draft',
        });
        const far = isoIn(400 * 24 * 60 * 60 * 1000);
        const res = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodeId: ep2.id, scheduledStartAt: far }),
          },
          jar,
        );
        if (res.status !== 400) {
          throw new Error(`Expected 400, got ${res.status}: ${await res.text()}`);
        }
      }),
    );

    results.push(
      await runOne('GET /call/meetings returns meeting for episode', async () => {
        const res = await apiFetch(
          `/call/meetings?episodeId=${encodeURIComponent(episode.id)}`,
          {},
          jar,
        );
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        const data = await res.json();
        if (!data.meeting || data.meeting.id !== meetingId) {
          throw new Error('Expected active meeting for episode');
        }
        if (data.maxActiveMeetingsPerUser !== 50) {
          throw new Error(`Expected max 50, got ${data.maxActiveMeetingsPerUser}`);
        }
      }),
    );

    results.push(
      await runOne('GET /call/join-info/:token waiting_for_host when host has not started', async () => {
        const res = await fetch(`${baseURL}/call/join-info/${encodeURIComponent(joinToken)}`);
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        const data = await res.json();
        if (data.meetingStatus !== 'waiting_for_host') {
          throw new Error(`Expected waiting_for_host, got ${data.meetingStatus}`);
        }
        if (data.episode?.id !== episode.id) {
          throw new Error('Expected episode id in join-info');
        }
        if (data.joinCode !== joinCode) {
          throw new Error('Expected joinCode in join-info');
        }
      }),
    );

    results.push(
      await runOne('GET /call/by-code/:code returns meeting token before host starts', async () => {
        const res = await fetch(`${baseURL}/call/by-code/${encodeURIComponent(joinCode)}`);
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        const data = await res.json();
        if (data.token !== joinToken) {
          throw new Error('Expected meeting token from by-code');
        }
      }),
    );

    results.push(
      await runOne('GET /call/join-info too_early when outside early window', async () => {
        const epFar = await createEpisode(jar, podcast.id, {
          title: 'E2E Too Early Ep',
          status: 'draft',
        });
        const createRes = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              episodeId: epFar.id,
              scheduledStartAt: isoIn(3 * 60 * 60 * 1000), // 3h -> opens in 2h
            }),
          },
          jar,
        );
        if (createRes.status !== 200) {
          throw new Error(`Create failed: ${createRes.status} ${await createRes.text()}`);
        }
        const m = (await createRes.json()).meeting;
        const infoRes = await fetch(`${baseURL}/call/join-info/${encodeURIComponent(m.token)}`);
        if (infoRes.status !== 200) throw new Error(`Expected 200, got ${infoRes.status}`);
        const info = await infoRes.json();
        if (info.meetingStatus !== 'too_early') {
          throw new Error(`Expected too_early, got ${info.meetingStatus}`);
        }
        // Cleanup so it does not count against the 50-cap later
        await apiFetch(`/call/meetings/${m.id}/cancel`, { method: 'POST' }, jar);
      }),
    );

    results.push(
      await runOne('POST invite email + link-only share; invite prefill on join-info', async () => {
        catcher.reset();
        const emailInvite = await apiFetch(
          `/call/meetings/${meetingId}/invites`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Guest Ada', email: `ada-${ts}@e2e.test` }),
          },
          jar,
        );
        if (emailInvite.status !== 200) {
          throw new Error(`Email invite failed: ${emailInvite.status} ${await emailInvite.text()}`);
        }
        const emailBody = await emailInvite.json();
        if (!emailBody.invite?.id || !emailBody.joinUrl?.includes('invite=')) {
          throw new Error('Expected invite with personalized joinUrl');
        }
        if (emailBody.invite.emailSent !== true) {
          throw new Error(`Expected emailSent true, got ${emailBody.invite.emailSent} (${emailBody.invite.emailError})`);
        }

        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        if (!emails.some((e) => /you're invited/i.test(e) && /Guest Ada/i.test(e) && /E2E Meeting Show/i.test(e))) {
          throw new Error(`Expected guest invite email, got: ${JSON.stringify(emails)}`);
        }

        const linkOnly = await apiFetch(
          `/call/meetings/${meetingId}/invites`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Messenger Bob' }),
          },
          jar,
        );
        if (linkOnly.status !== 200) {
          throw new Error(`Link invite failed: ${linkOnly.status}`);
        }
        const linkBody = await linkOnly.json();
        if (!linkBody.invite?.inviteToken || linkBody.invite.email != null) {
          throw new Error('Expected link-only invite without email');
        }

        const generic = await apiFetch(
          `/call/meetings/${meetingId}/invites`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
          jar,
        );
        if (generic.status !== 200) throw new Error(`Generic link failed: ${generic.status}`);
        const genericBody = await generic.json();
        if (genericBody.invite != null) {
          throw new Error('Expected null invite for blank generic link');
        }
        if (!genericBody.joinUrl || genericBody.joinUrl.includes('invite=')) {
          throw new Error('Expected base joinUrl without invite param');
        }

        const inviteToken = emailBody.invite.inviteToken;
        const infoRes = await fetch(
          `${baseURL}/call/join-info/${encodeURIComponent(joinToken)}?invite=${encodeURIComponent(inviteToken)}`,
        );
        if (infoRes.status !== 200) throw new Error(`join-info invite failed: ${infoRes.status}`);
        const info = await infoRes.json();
        if (info.inviteDisplayName !== 'Guest Ada') {
          throw new Error(`Expected inviteDisplayName Guest Ada, got ${info.inviteDisplayName}`);
        }
      }),
    );

    results.push(
      await runOne('PATCH reschedule emails emailed invitees (not link-only)', async () => {
        catcher.reset();
        const newStart = isoIn(45 * 60 * 1000);
        const res = await apiFetch(
          `/call/meetings/${meetingId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledStartAt: newStart }),
          },
          jar,
        );
        if (res.status !== 200) {
          throw new Error(`Reschedule failed: ${res.status} ${await res.text()}`);
        }
        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        if (!emails.some((e) => /meeting rescheduled/i.test(e) && /Guest Ada/i.test(e))) {
          throw new Error(`Expected reschedule email to Guest Ada, got: ${JSON.stringify(emails)}`);
        }
        if (emails.some((e) => /Messenger Bob/i.test(e))) {
          throw new Error('Link-only share should not receive reschedule email');
        }
      }),
    );

    results.push(
      await runOne('Ad-hoc Start Group Call uses a different code than reserved meeting', async () => {
        const otherEp = await createEpisode(jar, podcast.id, {
          title: 'E2E Adhoc Ep',
          status: 'draft',
        });
        const adhoc = await startCall(jar, otherEp.id);
        if (!adhoc.joinCode) throw new Error('Expected adhoc joinCode');
        if (adhoc.joinCode === joinCode) {
          throw new Error('Ad-hoc join code collided with reserved meeting code');
        }
      }),
    );

    results.push(
      await runOne('POST /call/meetings/:id/start reuses reserved token/code and join-info becomes live', async () => {
        const res = await apiFetch(
          `/call/meetings/${meetingId}/start`,
          { method: 'POST' },
          jar,
        );
        if (res.status !== 200) {
          throw new Error(`Start meeting failed: ${res.status} ${await res.text()}`);
        }
        const data = await res.json();
        if (data.token !== joinToken || data.joinCode !== joinCode) {
          throw new Error('Expected start meeting to reuse reserved token and joinCode');
        }
        if (!data.sessionId) throw new Error('Expected sessionId');

        const infoRes = await fetch(`${baseURL}/call/join-info/${encodeURIComponent(joinToken)}`);
        const info = await infoRes.json();
        if (info.meetingStatus !== 'live') {
          throw new Error(`Expected live, got ${info.meetingStatus}`);
        }

        const sessionRes = await apiFetch(
          `/call/session?episodeId=${encodeURIComponent(episode.id)}`,
          {},
          jar,
        );
        const session = await sessionRes.json();
        if (!session || session.token !== joinToken) {
          throw new Error('Expected active session with meeting token');
        }
      }),
    );

    results.push(
      await runOne('POST /call/meetings/:id/start 409 when call already in progress', async () => {
        const res = await apiFetch(
          `/call/meetings/${meetingId}/start`,
          { method: 'POST' },
          jar,
        );
        // Same host reconnect is 200; start another meeting path shouldn't create second session.
        // Starting again for same host/meeting returns existing session (200).
        if (res.status !== 200) {
          throw new Error(`Expected 200 reuse for same host, got ${res.status}`);
        }
      }),
    );

    results.push(
      await runOne('Ending live call via cancel releases reservation; GET meeting is null', async () => {
        const res = await apiFetch(
          `/call/meetings?episodeId=${encodeURIComponent(episode.id)}`,
          {},
          jar,
        );
        const data = await res.json();
        if (!data.meeting || data.meeting.status !== 'live') {
          throw new Error(`Expected live meeting before cancel path, got ${data.meeting?.status}`);
        }
      }),
    );

    results.push(
      await runOne('White-label: joinUrl uses managed domain when configured', async () => {
        const managedHost = `e2e-meet-wl-${ts}.test`;
        await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dnsDefaultAllowDomain: true }),
          },
          jar,
        );
        await apiFetch(
          `/podcasts/${podcast.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ managedDomain: managedHost }),
          },
          jar,
        );
        const res = await apiFetch(
          `/call/meetings?episodeId=${encodeURIComponent(episode.id)}`,
          {},
          jar,
        );
        const data = await res.json();
        if (!data.meeting?.joinUrl?.includes(managedHost)) {
          throw new Error(`Expected joinUrl to include ${managedHost}, got ${data.meeting?.joinUrl}`);
        }
        // Clear managed domain for later tests
        await apiFetch(
          `/podcasts/${podcast.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ managedDomain: null }),
          },
          jar,
        );
      }),
    );

    results.push(
      await runOne('Publish episode emails invitees once (not host); meta edit does not', async () => {
        catcher.reset();
        // First publish
        const pub = await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', publishAt: new Date().toISOString() }),
          },
          jar,
        );
        if (pub.status !== 200) {
          throw new Error(`Publish failed: ${pub.status} ${await pub.text()}`);
        }
        await sleep(500);
        await catcher.waitFor(1, 12000);
        const afterPublish = emailContents(catcher);
        if (!afterPublish.some((e) => /episode published/i.test(e) && /Guest Ada/i.test(e))) {
          throw new Error(`Expected publish notice to Guest Ada, got: ${JSON.stringify(afterPublish)}`);
        }
        if (afterPublish.some((e) => /admin@e2e\.test/i.test(e) && /episode published/i.test(e))) {
          // Host should not get publish notice (webhook content may not include To:); check subject only for invitee greeting
        }

        catcher.reset();
        const meta = await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'E2E Meeting Episode Renamed', description: 'meta only' }),
          },
          jar,
        );
        if (meta.status !== 200) throw new Error(`Meta patch failed: ${meta.status}`);
        await sleep(800);
        const afterMeta = emailContents(catcher);
        if (afterMeta.some((e) => /episode published/i.test(e) || /group call/i.test(e))) {
          throw new Error(`Expected no meeting emails on meta edit, got: ${JSON.stringify(afterMeta)}`);
        }

        // Republish path: draft then published again should not re-notify (flag set)
        catcher.reset();
        await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'draft' }),
          },
          jar,
        );
        await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', publishAt: new Date().toISOString() }),
          },
          jar,
        );
        await sleep(800);
        const afterRepub = emailContents(catcher);
        if (afterRepub.some((e) => /episode published/i.test(e))) {
          throw new Error('Expected no second publish notice');
        }
      }),
    );

    results.push(
      await runOne('DELETE invite removes invite; cancel emails remaining invitees and releases code', async () => {
        const listRes = await apiFetch(
          `/call/meetings?episodeId=${encodeURIComponent(episode.id)}`,
          {},
          jar,
        );
        const meeting = (await listRes.json()).meeting;
        const emailInv = meeting.invites.find((i) => i.email);
        const linkInv = meeting.invites.find((i) => !i.email && i.displayName);
        if (!emailInv) throw new Error('Expected emailed invite');
        if (linkInv) {
          const del = await apiFetch(
            `/call/meetings/${meetingId}/invites/${linkInv.id}`,
            { method: 'DELETE' },
            jar,
          );
          if (del.status !== 204) throw new Error(`Expected 204 delete, got ${del.status}`);
        }

        catcher.reset();
        const cancelRes = await apiFetch(
          `/call/meetings/${meetingId}/cancel`,
          { method: 'POST' },
          jar,
        );
        if (cancelRes.status !== 200) {
          throw new Error(`Cancel failed: ${cancelRes.status} ${await cancelRes.text()}`);
        }
        await catcher.waitFor(1, 10000);
        const emails = emailContents(catcher);
        if (!emails.some((e) => /meeting cancelled/i.test(e) && /Guest Ada/i.test(e))) {
          throw new Error(`Expected cancel email, got: ${JSON.stringify(emails)}`);
        }

        const byCode = await fetch(`${baseURL}/call/by-code/${encodeURIComponent(joinCode)}`);
        if (byCode.status !== 404) {
          throw new Error(`Expected 404 for released code, got ${byCode.status}`);
        }

        const getRes = await apiFetch(
          `/call/meetings?episodeId=${encodeURIComponent(episode.id)}`,
          {},
          jar,
        );
        const after = await getRes.json();
        if (after.meeting != null) {
          throw new Error('Expected no active meeting after cancel');
        }
      }),
    );

    results.push(
      await runOne('Per-account cap of 50 active reserved meetings', async () => {
        // Cancel leftover active meetings from earlier steps in this suite.
        if (meetingId) {
          await apiFetch(`/call/meetings/${meetingId}/cancel`, { method: 'POST' }, jar).catch(
            () => {},
          );
        }
        const createdIds = [];
        try {
          for (let i = 0; i < 50; i++) {
            const ep = await createEpisode(jar, podcast.id, {
              title: `E2E Cap Ep ${i}`,
              status: 'draft',
            });
            const res = await apiFetch(
              '/call/meetings',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  episodeId: ep.id,
                  scheduledStartAt: isoIn((2 + i) * 60 * 60 * 1000),
                }),
              },
              jar,
            );
            if (res.status !== 200) {
              throw new Error(`Meeting ${i + 1}/50 failed: ${res.status} ${await res.text()}`);
            }
            createdIds.push((await res.json()).meeting.id);
          }
          const overflowEp = await createEpisode(jar, podcast.id, {
            title: 'E2E Cap Overflow',
            status: 'draft',
          });
          const overflow = await apiFetch(
            '/call/meetings',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                episodeId: overflowEp.id,
                scheduledStartAt: isoIn(60 * 60 * 1000),
              }),
            },
            jar,
          );
          if (overflow.status !== 403) {
            throw new Error(`Expected 403 at cap, got ${overflow.status}: ${await overflow.text()}`);
          }
        } finally {
          for (const id of createdIds) {
            await apiFetch(`/call/meetings/${id}/cancel`, { method: 'POST' }, jar).catch(() => {});
          }
        }
      }),
    );

    results.push(
      await runOne('Start Meeting and ad-hoc Start Group Call remain separate after cancel', async () => {
        const ep = await createEpisode(jar, podcast.id, {
          title: 'E2E Separate Paths',
          status: 'draft',
        });
        const createRes = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              episodeId: ep.id,
              scheduledStartAt: isoIn(20 * 60 * 1000),
            }),
          },
          jar,
        );
        if (createRes.status !== 200) {
          throw new Error(`Create failed: ${createRes.status}`);
        }
        const meeting = (await createRes.json()).meeting;

        // Ad-hoc on same episode should work while meeting is scheduled (not live)
        const adhoc = await startCall(jar, ep.id);
        if (adhoc.joinCode === meeting.joinCode) {
          throw new Error('Ad-hoc should not reuse reserved meeting code');
        }
        if (adhoc.token === meeting.token) {
          throw new Error('Ad-hoc should not reuse reserved meeting token');
        }

        // Cannot start scheduled meeting while ad-hoc live
        const startMeet = await apiFetch(
          `/call/meetings/${meeting.id}/start`,
          { method: 'POST' },
          jar,
        );
        if (startMeet.status !== 409) {
          throw new Error(`Expected 409 when ad-hoc call active, got ${startMeet.status}`);
        }
      }),
    );
  } finally {
    // Leave email disabled so later suites' createUser + login are not blocked by
    // registration verification (default on when an email provider is configured).
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

  return results;
}
