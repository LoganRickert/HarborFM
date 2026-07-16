/**
 * E2E: Episode Alerts - settings/CRUD, permissions, community webhook on publish,
 * email signup/verify/unsubscribe (via local webhook email catcher), scheduled publishAt.
 */
import {
  apiFetch,
  baseURL,
  cookieJar,
  createEpisode,
  createShow,
  createUser,
  login,
  loginAsAdmin,
} from '../../lib/helpers.js';
import { startHttpCatcher } from '../../lib/httpCatcher.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {Awaited<ReturnType<typeof startHttpCatcher>>} catcher */
function emailContents(catcher) {
  return catcher.requests
    .map((r) => {
      if (r.json && typeof r.json === 'object' && r.json !== null && 'content' in r.json) {
        // Server email webhook: { content: "Subject: ...\n\n..." }
        // Discord also uses `content` but not a Subject: prefix.
        const content = String(/** @type {{ content?: unknown }} */ (r.json).content ?? '');
        if (/^Subject:\s*/i.test(content)) return content;
      }
      return '';
    })
    .filter((c) => c.length > 0);
}

/** @param {Awaited<ReturnType<typeof startHttpCatcher>>} catcher */
function jsonWebhookPayloads(catcher) {
  return catcher.requests
    .map((r) => r.json)
    .filter(
      (j) =>
        j &&
        typeof j === 'object' &&
        typeof /** @type {{ title?: unknown }} */ (j).title === 'string' &&
        typeof /** @type {{ episodeUrl?: unknown }} */ (j).episodeUrl === 'string',
    );
}

function extractVerifyToken(text) {
  const m = text.match(/episode-alerts\/verify\?token=([^\s&"'<>]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function extractUnsubToken(text) {
  const m = text.match(/episode-alerts\/unsubscribe\?token=([^\s&"'<>]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();
  const ts = Date.now();
  const slug = `e2e-alerts-${ts}`;
  const show = await createShow(adminJar, {
    title: 'E2E Episode Alerts',
    slug,
  });

  const catcher = await startHttpCatcher();
  let unsubToken = null;
  /** @type {string|null} */
  let jsonWebhookDestId = null;
  /** @type {string|null} */
  let builtinDestId = null;

  try {
    results.push(
      await runOne('GET /settings includes defaultCanEpisodeAlert (default true)', async () => {
        const res = await apiFetch('/settings', {}, adminJar);
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        const data = await res.json();
        if (typeof data.defaultCanEpisodeAlert !== 'boolean') {
          throw new Error('Expected defaultCanEpisodeAlert boolean');
        }
        if (data.defaultCanEpisodeAlert !== true) {
          throw new Error(
            `Expected defaultCanEpisodeAlert true by default, got ${data.defaultCanEpisodeAlert}`,
          );
        }
      }),
    );

    results.push(
      await runOne('PATCH /settings can toggle defaultCanEpisodeAlert', async () => {
        let res = await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultCanEpisodeAlert: false }),
          },
          adminJar,
        );
        if (res.status !== 200) throw new Error(`Expected 200 setting false, got ${res.status}`);
        let data = await res.json();
        if (data.defaultCanEpisodeAlert !== false) {
          throw new Error('Expected defaultCanEpisodeAlert false after PATCH');
        }

        res = await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultCanEpisodeAlert: true }),
          },
          adminJar,
        );
        if (res.status !== 200) throw new Error(`Expected 200 setting true, got ${res.status}`);
        data = await res.json();
        if (data.defaultCanEpisodeAlert !== true) {
          throw new Error('Expected defaultCanEpisodeAlert true after PATCH');
        }
      }),
    );

    results.push(
      await runOne('User without canEpisodeAlert gets 403 on episode-alerts routes', async () => {
        await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultCanEpisodeAlert: true, registrationEnabled: true }),
          },
          adminJar,
        );

        const { email, password } = await createUser({
          email: `alerts-gate-${ts}@e2e.test`,
        });
        const userJar = cookieJar();
        await login(email, password, userJar);
        const userShow = await createShow(userJar, {
          title: 'E2E Alerts Gate Show',
          slug: `e2e-alerts-gate-${ts}`,
        });

        const listRes = await apiFetch('/users?limit=200', {}, adminJar);
        const list = await listRes.json();
        const u = list.users.find((x) => x.email === email);
        if (!u) throw new Error('User not found in list');

        const patchRes = await apiFetch(
          `/users/${u.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ canEpisodeAlert: false }),
          },
          adminJar,
        );
        if (patchRes.status !== 200) {
          throw new Error(`Expected 200 PATCH user, got ${patchRes.status}`);
        }

        const denied = await apiFetch(
          `/podcasts/${userShow.id}/episode-alerts`,
          {},
          userJar,
        );
        if (denied.status !== 403) {
          throw new Error(`Expected 403 after disabling canEpisodeAlert, got ${denied.status}`);
        }

        await apiFetch(
          '/settings',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultCanEpisodeAlert: true }),
          },
          adminJar,
        );
      }),
    );

    results.push(
      await runOne('Configure webhook email provider and enable show alerts + destinations', async () => {
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
          adminJar,
        );
        if (settingsRes.status !== 200) {
          throw new Error(`Expected 200 settings PATCH, got ${settingsRes.status}`);
        }

        const enableRes = await apiFetch(
          `/podcasts/${show.id}/episode-alerts`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              episodeAlertsEnabled: true,
              episodeAlertsMailingAddress: '123 E2E Street, Test City',
            }),
          },
          adminJar,
        );
        if (enableRes.status !== 200) {
          const t = await enableRes.text();
          throw new Error(`Expected 200 enable alerts, got ${enableRes.status}: ${t}`);
        }

        const builtinRes = await apiFetch(
          `/podcasts/${show.id}/episode-alerts/destinations`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'builtin', enabled: true, name: 'E2E Builtin' }),
          },
          adminJar,
        );
        if (builtinRes.status !== 201) {
          const t = await builtinRes.text();
          throw new Error(`Expected 201 builtin dest, got ${builtinRes.status}: ${t}`);
        }
        builtinDestId = (await builtinRes.json()).destination?.id;

        const whRes = await apiFetch(
          `/podcasts/${show.id}/episode-alerts/destinations`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'json_webhook',
              enabled: true,
              name: 'E2E JSON Webhook',
              config: { url: catcher.baseUrl },
            }),
          },
          adminJar,
        );
        if (whRes.status !== 201) {
          const t = await whRes.text();
          throw new Error(`Expected 201 json_webhook dest, got ${whRes.status}: ${t}`);
        }
        jsonWebhookDestId = (await whRes.json()).destination?.id;
        if (!jsonWebhookDestId) throw new Error('Missing json_webhook destination id');

        const discordRes = await apiFetch(
          `/podcasts/${show.id}/episode-alerts/destinations`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'discord',
              enabled: true,
              name: 'E2E Discord',
              config: { webhookUrl: catcher.baseUrl },
            }),
          },
          adminJar,
        );
        if (discordRes.status !== 201) {
          const t = await discordRes.text();
          throw new Error(`Expected 201 discord dest, got ${discordRes.status}: ${t}`);
        }

        const getRes = await apiFetch(`/podcasts/${show.id}/episode-alerts`, {}, adminJar);
        if (getRes.status !== 200) throw new Error(`Expected 200 GET alerts, got ${getRes.status}`);
        const data = await getRes.json();
        if (!data.settings?.episodeAlertsEnabled) {
          throw new Error('Expected episodeAlertsEnabled true');
        }
        if (data.emailAvailable !== true) {
          throw new Error(`Expected emailAvailable true, got ${data.emailAvailable}`);
        }
        if (!Array.isArray(data.destinations) || data.destinations.length < 3) {
          throw new Error(`Expected >=3 destinations, got ${data.destinations?.length}`);
        }
        if (typeof data.listCounts?.general !== 'number') {
          throw new Error('Expected listCounts.general');
        }
      }),
    );

    results.push(
      await runOne('PATCH and DELETE destination round-trip', async () => {
        const createRes = await apiFetch(
          `/podcasts/${show.id}/episode-alerts/destinations`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'slack',
              enabled: true,
              name: 'Temp Slack',
              config: { webhookUrl: `${catcher.baseUrl}/slack-temp` },
            }),
          },
          adminJar,
        );
        if (createRes.status !== 201) {
          throw new Error(`Expected 201 temp dest, got ${createRes.status}`);
        }
        const dest = (await createRes.json()).destination;
        const patchRes = await apiFetch(
          `/podcasts/${show.id}/episode-alerts/destinations/${dest.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Temp Slack Renamed', enabled: false }),
          },
          adminJar,
        );
        if (patchRes.status !== 200) {
          throw new Error(`Expected 200 PATCH dest, got ${patchRes.status}`);
        }
        const patched = await patchRes.json();
        if (patched.destination?.name !== 'Temp Slack Renamed') {
          throw new Error('Expected renamed destination');
        }
        if (patched.destination?.enabled !== false) {
          throw new Error('Expected enabled false');
        }

        const delRes = await apiFetch(
          `/podcasts/${show.id}/episode-alerts/destinations/${dest.id}`,
          { method: 'DELETE' },
          adminJar,
        );
        if (delRes.status !== 204) {
          throw new Error(`Expected 204 DELETE dest, got ${delRes.status}`);
        }
      }),
    );

    results.push(
      await runOne('Public GET episode-alerts reflects enabled + emailSignupAvailable', async () => {
        const res = await fetch(
          `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episode-alerts`,
        );
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        const data = await res.json();
        if (data.enabled !== true) throw new Error(`Expected enabled true, got ${data.enabled}`);
        if (data.emailSignupAvailable !== true) {
          throw new Error(`Expected emailSignupAvailable true, got ${data.emailSignupAvailable}`);
        }
      }),
    );

    results.push(
      await runOne('Publish fires json_webhook (+ discord); draft/re-publish is idempotent', async () => {
        catcher.reset();
        const ep = await createEpisode(adminJar, show.id, {
          title: `E2E Alerts Webhook Ep ${ts}`,
          status: 'draft',
        });

        const pubRes = await apiFetch(
          `/episodes/${ep.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', publishAt: null }),
          },
          adminJar,
        );
        if (pubRes.status !== 200) {
          throw new Error(`Expected 200 publish, got ${pubRes.status}`);
        }

        await catcher.waitFor(2, 10000);
        const payloads = jsonWebhookPayloads(catcher);
        if (payloads.length < 1) {
          throw new Error(
            `Expected json_webhook payload, got requests=${catcher.requests.length} bodies=${JSON.stringify(catcher.requests.map((r) => r.json).slice(0, 5))}`,
          );
        }
        const payload = payloads[0];
        if (payload.title !== `E2E Alerts Webhook Ep ${ts}`) {
          throw new Error(`Unexpected title ${payload.title}`);
        }
        if (!payload.podcastTitle || !payload.episodeUrl) {
          throw new Error(`Missing podcastTitle/episodeUrl in ${JSON.stringify(payload)}`);
        }

        const discordHits = catcher.requests.filter(
          (r) =>
            r.json &&
            typeof r.json === 'object' &&
            (Array.isArray(/** @type {{ embeds?: unknown }} */ (r.json).embeds) ||
              typeof /** @type {{ content?: unknown }} */ (r.json).content === 'string') &&
            !('episodeUrl' in /** @type {object} */ (r.json)),
        );
        if (discordHits.length < 1) {
          throw new Error('Expected Discord webhook payload');
        }

        const afterFirst = catcher.requests.length;

        await apiFetch(
          `/episodes/${ep.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'draft' }),
          },
          adminJar,
        );
        await apiFetch(
          `/episodes/${ep.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', publishAt: null }),
          },
          adminJar,
        );
        await sleep(500);
        if (catcher.requests.length !== afterFirst) {
          throw new Error(
            `Expected idempotent re-publish (still ${afterFirst} requests), got ${catcher.requests.length}`,
          );
        }
      }),
    );

    results.push(
      await runOne('Public signup sends verify email; verify confirms list membership', async () => {
        catcher.reset();
        const email = `alerts-sub-${ts}@e2e.test`;
        const signupRes = await fetch(
          `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episode-alerts/signup`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          },
        );
        if (signupRes.status !== 200) {
          const t = await signupRes.text();
          throw new Error(`Expected 200 signup, got ${signupRes.status}: ${t}`);
        }
        const signupBody = await signupRes.json();
        if (signupBody.ok !== true || signupBody.verificationRequired !== true) {
          throw new Error(`Unexpected signup body ${JSON.stringify(signupBody)}`);
        }

        await catcher.waitFor(1, 10000);
        const contents = emailContents(catcher);
        if (contents.length < 1) throw new Error('Expected verify email content');
        const token = extractVerifyToken(contents.join('\n'));
        if (!token) {
          throw new Error(`Could not extract verify token from: ${contents[0].slice(0, 400)}`);
        }

        const verifyRes = await fetch(
          `${baseURL}/public/episode-alerts/verify?token=${encodeURIComponent(token)}`,
          { redirect: 'manual' },
        );
        if (verifyRes.status !== 302 && verifyRes.status !== 301) {
          throw new Error(`Expected redirect verify, got ${verifyRes.status}`);
        }
        const loc = verifyRes.headers.get('location') || '';
        if (!loc.includes('alerts=confirmed')) {
          throw new Error(`Expected alerts=confirmed in Location, got ${loc}`);
        }

        const getRes = await apiFetch(`/podcasts/${show.id}/episode-alerts`, {}, adminJar);
        const data = await getRes.json();
        if ((data.listCounts?.general ?? 0) < 1) {
          throw new Error(`Expected listCounts.general >= 1, got ${JSON.stringify(data.listCounts)}`);
        }

        const badVerify = await fetch(
          `${baseURL}/public/episode-alerts/verify?token=not-a-real-token`,
          { redirect: 'manual' },
        );
        const badLoc = badVerify.headers.get('location') || '';
        if (!badLoc.includes('alerts=invalid')) {
          throw new Error(`Expected alerts=invalid, got ${badLoc}`);
        }
      }),
    );

    results.push(
      await runOne('Publish new episode emails verified subscriber (unsubscribe link)', async () => {
        catcher.reset();
        const ep = await createEpisode(adminJar, show.id, {
          title: `E2E Alerts Email Ep ${ts}`,
          status: 'draft',
        });
        const pubRes = await apiFetch(
          `/episodes/${ep.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', publishAt: null }),
          },
          adminJar,
        );
        if (pubRes.status !== 200) {
          throw new Error(`Expected 200 publish, got ${pubRes.status}`);
        }

        // json_webhook + discord + alert email
        const deadline = Date.now() + 12000;
        let alertMail = null;
        while (Date.now() < deadline) {
          const contents = emailContents(catcher);
          alertMail = contents.find((c) => /unsubscribe/i.test(c)) || null;
          if (alertMail) break;
          await sleep(50);
        }
        if (!alertMail) {
          throw new Error(
            `Expected alert email with unsubscribe link; emailContents=${JSON.stringify(emailContents(catcher).map((c) => c.slice(0, 160)))} requestCount=${catcher.requests.length}`,
          );
        }
        unsubToken = extractUnsubToken(alertMail);
        if (!unsubToken) {
          throw new Error(`Could not extract unsubscribe token from: ${alertMail.slice(0, 500)}`);
        }
      }),
    );

    results.push(
      await runOne('Unsubscribe removes subscriber; invalid token redirects unsub-invalid', async () => {
        if (!unsubToken) throw new Error('Missing unsubToken from prior test');

        const beforeRes = await apiFetch(`/podcasts/${show.id}/episode-alerts`, {}, adminJar);
        const before = await beforeRes.json();
        const beforeCount = before.listCounts?.general ?? 0;

        const unsubRes = await fetch(
          `${baseURL}/public/episode-alerts/unsubscribe?token=${encodeURIComponent(unsubToken)}`,
          { redirect: 'manual' },
        );
        if (unsubRes.status !== 302 && unsubRes.status !== 301) {
          throw new Error(`Expected redirect unsubscribe, got ${unsubRes.status}`);
        }
        const loc = unsubRes.headers.get('location') || '';
        if (!loc.includes('alerts=unsubscribed')) {
          throw new Error(`Expected alerts=unsubscribed, got ${loc}`);
        }

        const afterRes = await apiFetch(`/podcasts/${show.id}/episode-alerts`, {}, adminJar);
        const after = await afterRes.json();
        const afterCount = after.listCounts?.general ?? 0;
        if (afterCount >= beforeCount) {
          throw new Error(
            `Expected listCounts.general to drop (${beforeCount} -> ${afterCount})`,
          );
        }

        const bad = await fetch(
          `${baseURL}/public/episode-alerts/unsubscribe?token=not-a-real-token`,
          { redirect: 'manual' },
        );
        const badLoc = bad.headers.get('location') || '';
        if (!badLoc.includes('alerts=unsub-invalid')) {
          throw new Error(`Expected alerts=unsub-invalid, got ${badLoc}`);
        }
      }),
    );

    results.push(
      await runOne('Scheduled publishAt: no alert until publishAt is in the past', async () => {
        catcher.reset();
        const ep = await createEpisode(adminJar, show.id, {
          title: `E2E Alerts Scheduled Ep ${ts}`,
          status: 'draft',
        });
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const futureRes = await apiFetch(
          `/episodes/${ep.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published', publishAt: future }),
          },
          adminJar,
        );
        if (futureRes.status !== 200) {
          throw new Error(`Expected 200 future publish, got ${futureRes.status}`);
        }

        await sleep(800);
        if (jsonWebhookPayloads(catcher).length > 0) {
          throw new Error('Expected no json_webhook while publishAt is in the future');
        }

        const past = new Date(Date.now() - 60_000).toISOString();
        const pastRes = await apiFetch(
          `/episodes/${ep.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publishAt: past }),
          },
          adminJar,
        );
        if (pastRes.status !== 200) {
          throw new Error(`Expected 200 past publishAt, got ${pastRes.status}`);
        }

        await catcher.waitFor(1, 10000);
        const payloads = jsonWebhookPayloads(catcher);
        if (payloads.length < 1) {
          throw new Error('Expected json_webhook after publishAt moved to past');
        }
        if (payloads[0].title !== `E2E Alerts Scheduled Ep ${ts}`) {
          throw new Error(`Unexpected scheduled payload title ${payloads[0].title}`);
        }
      }),
    );
  } finally {
    await apiFetch(
      '/settings',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailProvider: 'none' }),
      },
      adminJar,
    ).catch(() => {});
    await catcher.close().catch(() => {});
    // Keep destinations referenced so linters don't complain about unused assigns in odd paths
    void builtinDestId;
    void jsonWebhookDestId;
  }

  return results;
}
