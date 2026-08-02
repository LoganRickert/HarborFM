/**
 * E2E: Guest episode review emails and tokenized preview APIs.
 * Draft → scheduled or published+unlisted sends review mail;
 * preview valid while unlisted or listed+scheduled; listed+published redirects;
 * approve/feedback notify host.
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

function extractReviewToken(text) {
  const m = text.match(/[?&]review=([^\s&"'<>]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
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
  const podcast = await createShow(jar, {
    title: 'E2E Guest Review Show',
    slug: `e2e-guest-review-${ts}`,
  });
  const episode = await createEpisode(jar, podcast.id, {
    title: 'E2E Guest Review Episode',
    status: 'draft',
  });

  const catcher = await startHttpCatcher();
  /** @type {string|null} */
  let guestToken = null;
  /** @type {string|null} */
  let hostToken = null;
  /** @type {string|null} */
  let meetingId = null;

  try {
    results.push(
      await runOne('Configure webhook email for guest review', async () => {
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

    results.push(
      await runOne('Schedule meeting and invite guest with email', async () => {
        catcher.reset();
        const scheduledStartAt = isoIn(45 * 60 * 1000);
        const createRes = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodeId: episode.id, scheduledStartAt }),
          },
          jar,
        );
        if (createRes.status !== 200) {
          throw new Error(`Meeting create failed: ${createRes.status} ${await createRes.text()}`);
        }
        meetingId = (await createRes.json()).meeting.id;
        await catcher.waitFor(1, 10000);

        catcher.reset();
        const inviteRes = await apiFetch(
          `/call/meetings/${meetingId}/invites`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: `guest-review-${ts}@example.com`,
              name: 'Guest Riley',
            }),
          },
          jar,
        );
        if (inviteRes.status !== 200) {
          throw new Error(`Invite failed: ${inviteRes.status} ${await inviteRes.text()}`);
        }
        await catcher.waitFor(1, 10000);
      }),
    );

    results.push(
      await runOne('Draft → scheduled (listed) sends review emails once', async () => {
        catcher.reset();
        const res = await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'scheduled',
              unlisted: 0,
              publishAt: isoIn(2 * 60 * 60 * 1000),
              slug: `guest-review-ep-${ts}`,
            }),
          },
          jar,
        );
        if (res.status !== 200) {
          throw new Error(`Schedule failed: ${res.status} ${await res.text()}`);
        }

        await sleep(400);
        await catcher.waitFor(2, 15000);
        const emails = emailContents(catcher);
        const reviewEmails = emails.filter((e) => /please review/i.test(e));
        if (reviewEmails.length < 2) {
          throw new Error(
            `Expected review emails for host and guest, got ${reviewEmails.length}: ${JSON.stringify(emails)}`,
          );
        }
        if (!reviewEmails.some((e) => /Guest Riley/i.test(e))) {
          throw new Error(`Expected guest greeting in review email: ${JSON.stringify(reviewEmails)}`);
        }
        if (!reviewEmails.some((e) => /Preview Episode/i.test(e) || /preview episode/i.test(e))) {
          throw new Error(`Expected Preview Episode CTA: ${JSON.stringify(reviewEmails)}`);
        }

        for (const e of reviewEmails) {
          const token = extractReviewToken(e);
          if (!token) continue;
          if (/Guest Riley/i.test(e)) guestToken = token;
          else hostToken = token;
        }
        if (!guestToken) {
          // Host email may not include display name; take first unused token as guest if needed
          const tokens = reviewEmails.map(extractReviewToken).filter(Boolean);
          guestToken = tokens.find((t) => t !== hostToken) || tokens[0] || null;
          hostToken = tokens.find((t) => t !== guestToken) || tokens[1] || hostToken;
        }
        if (!guestToken) {
          throw new Error(`Could not extract review token from: ${JSON.stringify(reviewEmails)}`);
        }

        catcher.reset();
        const again = await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'E2E Guest Review Episode Renamed' }),
          },
          jar,
        );
        if (again.status !== 200) throw new Error(`Meta patch failed: ${again.status}`);
        await sleep(800);
        const afterMeta = emailContents(catcher);
        if (afterMeta.some((e) => /please review/i.test(e))) {
          throw new Error('Expected no second review email on meta edit');
        }
      }),
    );

    results.push(
      await runOne('GET review token is review while listed+scheduled', async () => {
        const res = await fetch(
          `${baseURL}/public/episode-review?token=${encodeURIComponent(guestToken)}`,
        );
        if (res.status !== 200) {
          throw new Error(`Expected 200, got ${res.status}`);
        }
        const data = await res.json();
        if (data.state !== 'review') {
          throw new Error(`Expected state review, got ${JSON.stringify(data)}`);
        }
        if (data.status !== 'pending') {
          throw new Error(`Expected pending status, got ${data.status}`);
        }
      }),
    );

    results.push(
      await runOne('Public episode with review token clears scheduled gate when audio exists', async () => {
        const epRes = await apiFetch(`/episodes/${episode.id}`, {}, jar);
        if (epRes.status !== 200) throw new Error(`GET episode failed: ${epRes.status}`);
        const ep = await epRes.json();
        const slug = ep.slug;
        if (!slug) throw new Error('Expected episode slug');

        const pub = await fetch(
          `${baseURL}/public/podcasts/${encodeURIComponent(podcast.slug)}/episodes/${encodeURIComponent(slug)}?review=${encodeURIComponent(guestToken)}`,
        );
        if (pub.status !== 200) {
          throw new Error(`Expected 200 public episode, got ${pub.status}`);
        }
        const data = await pub.json();
        if (data.scheduled_not_released === 1 || data.scheduled_not_released === true) {
          throw new Error(
            `Expected scheduled_not_released cleared for review preview, got ${JSON.stringify(data.scheduled_not_released)}`,
          );
        }
        // Audio/waveform URLs only when a final file exists; gate clear is the critical unlock.
        if (ep.audioFinalPath || ep.audio_final_path) {
          if (!data.audio_url || !String(data.audio_url).includes('episode-review/audio')) {
            throw new Error(`Expected review audio_url, got ${data.audio_url}`);
          }
          if (
            !data.private_waveform_url ||
            !String(data.private_waveform_url).includes('episode-review/waveform')
          ) {
            throw new Error(
              `Expected review private_waveform_url, got ${data.private_waveform_url}`,
            );
          }
        }
      }),
    );

    results.push(
      await runOne('Approve notifies host; feedback notifies host', async () => {
        catcher.reset();
        const approveRes = await fetch(`${baseURL}/public/episode-review/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: guestToken }),
        });
        if (approveRes.status !== 200) {
          throw new Error(`Approve failed: ${approveRes.status} ${await approveRes.text()}`);
        }
        await catcher.waitFor(1, 12000);
        const afterApprove = emailContents(catcher);
        if (!afterApprove.some((e) => /episode approved/i.test(e) && /Guest Riley/i.test(e))) {
          throw new Error(`Expected host approve email, got: ${JSON.stringify(afterApprove)}`);
        }

        catcher.reset();
        const feedbackRes = await fetch(`${baseURL}/public/episode-review/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: guestToken,
            message: 'Please trim the intro a bit.',
          }),
        });
        if (feedbackRes.status !== 200) {
          throw new Error(`Feedback failed: ${feedbackRes.status} ${await feedbackRes.text()}`);
        }
        await catcher.waitFor(1, 12000);
        const afterFeedback = emailContents(catcher);
        if (
          !afterFeedback.some(
            (e) =>
              /episode feedback/i.test(e) &&
              /Please trim the intro/i.test(e),
          )
        ) {
          throw new Error(`Expected host feedback email, got: ${JSON.stringify(afterFeedback)}`);
        }
      }),
    );

    results.push(
      await runOne('Listed + published returns redirect_public; mutations rejected', async () => {
        const pub = await apiFetch(
          `/episodes/${episode.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'published',
              unlisted: 0,
              publishAt: new Date().toISOString(),
            }),
          },
          jar,
        );
        if (pub.status !== 200) {
          throw new Error(`Publish failed: ${pub.status} ${await pub.text()}`);
        }

        const res = await fetch(
          `${baseURL}/public/episode-review?token=${encodeURIComponent(guestToken)}`,
        );
        const data = await res.json();
        if (data.state !== 'redirect_public') {
          throw new Error(`Expected redirect_public, got ${JSON.stringify(data)}`);
        }
        if (!data.episodeUrl) {
          throw new Error('Expected episodeUrl on redirect_public');
        }

        const approveRes = await fetch(`${baseURL}/public/episode-review/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: guestToken }),
        });
        if (approveRes.status !== 410) {
          throw new Error(`Expected 410 after public, got ${approveRes.status}`);
        }
      }),
    );

    results.push(
      await runOne('Unlisted published still allows review state', async () => {
        const ep2 = await createEpisode(jar, podcast.id, {
          title: 'E2E Guest Review Unlisted',
          status: 'draft',
        });
        catcher.reset();
        const createRes = await apiFetch(
          '/call/meetings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              episodeId: ep2.id,
              scheduledStartAt: isoIn(40 * 60 * 1000),
            }),
          },
          jar,
        );
        if (createRes.status !== 200) {
          throw new Error(`Meeting2 create failed: ${createRes.status}`);
        }
        const mid = (await createRes.json()).meeting.id;
        await apiFetch(
          `/call/meetings/${mid}/invites`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: `guest-unlisted-${ts}@example.com`,
              name: 'Guest Unlisted',
            }),
          },
          jar,
        );
        await sleep(300);
        catcher.reset();
        const sched = await apiFetch(
          `/episodes/${ep2.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'scheduled',
              unlisted: 1,
              publishAt: isoIn(3 * 60 * 60 * 1000),
              slug: `guest-review-unlisted-${ts}`,
            }),
          },
          jar,
        );
        if (sched.status !== 200) {
          throw new Error(`Unlisted schedule failed: ${sched.status} ${await sched.text()}`);
        }
        await catcher.waitFor(2, 15000);
        const emails = emailContents(catcher).filter((e) => /please review/i.test(e));
        if (emails.length < 2) {
          throw new Error(`Expected unlisted review emails, got: ${JSON.stringify(emailContents(catcher))}`);
        }
        const token = emails.map(extractReviewToken).find(Boolean);
        if (!token) throw new Error('Missing unlisted review token');

        await apiFetch(
          `/episodes/${ep2.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'published',
              unlisted: 1,
              publishAt: new Date().toISOString(),
            }),
          },
          jar,
        );
        const reviewRes = await fetch(
          `${baseURL}/public/episode-review?token=${encodeURIComponent(token)}`,
        );
        const reviewData = await reviewRes.json();
        if (reviewData.state !== 'review') {
          throw new Error(`Expected review while unlisted published, got ${JSON.stringify(reviewData)}`);
        }

        await apiFetch(
          `/episodes/${ep2.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'draft' }),
          },
          jar,
        );
        const afterDraft = await fetch(
          `${baseURL}/public/episode-review?token=${encodeURIComponent(token)}`,
        );
        const afterDraftData = await afterDraft.json();
        if (afterDraftData.state !== 'invalid') {
          throw new Error(`Expected invalid after draft, got ${JSON.stringify(afterDraftData)}`);
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
