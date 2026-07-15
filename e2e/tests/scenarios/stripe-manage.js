import {
  apiFetch,
  loginAsAdmin,
  createUser,
  createShow,
  cookieJar,
  login,
  baseURL,
} from '../../lib/helpers.js';

const E2E_CLIENT_IP = process.env.E2E_CLIENT_IP || '127.0.0.1';

/** Clear subscriber-token bans so rotated-token 404 checks are not masked by 429. */
async function unbanLoopback(adminJar) {
  for (const ip of [E2E_CLIENT_IP, '127.0.0.1', '::1']) {
    await apiFetch(`/bans/${encodeURIComponent(ip)}`, { method: 'DELETE' }, adminJar);
  }
}

export async function run({ runOne }) {
  const results = [];
  const { jar: adminJar } = await loginAsAdmin();

  await apiFetch(
    '/settings',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationEnabled: true, defaultCanStripe: true }),
    },
    adminJar,
  );

  const userA = await createUser({ email: `stripe-manage-a-${Date.now()}@e2e.test` });
  const jarA = cookieJar();
  await login(userA.email, userA.password, jarA);

  const show = await createShow(jarA, {
    title: 'Stripe Manage Show',
    slug: `stripe-manage-${Date.now()}`,
  });

  await apiFetch(
    `/podcasts/${show.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriberOnlyFeedEnabled: true }),
    },
    jarA,
  );

  let packId = null;
  let planId = null;
  let sessionId = null;
  let rawToken = null;
  const listenerJar = cookieJar();

  results.push(
    await runOne('Setup: pack, attach, plan, checkout + webhook', async () => {
      const createRes = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'P4 Stripe',
            mode: 'test',
            testSecretKey: 'sk_test_e2e_secret_manageaaaa',
            testPublishableKey: 'pk_test_e2e_pub_manageaaaa',
            testWebhookSecret: 'whsec_e2e_test_manageaaaa',
          }),
        },
        jarA,
      );
      if (createRes.status !== 201) {
        throw new Error(`Expected 201 pack, got ${createRes.status}`);
      }
      const pack = await createRes.json();
      packId = pack.id;

      const attach = await apiFetch(
        `/podcasts/${show.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stripeCredentialsId: packId,
            stripePaymentsEnabled: true,
          }),
        },
        jarA,
      );
      if (attach.status !== 200) {
        throw new Error(`Expected 200 attach, got ${attach.status}`);
      }

      const planRes = await apiFetch(
        `/podcasts/${show.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'month',
            amountCents: 700,
            currency: 'usd',
          }),
        },
        jarA,
      );
      if (planRes.status !== 201) {
        throw new Error(`Expected 201 plan, got ${planRes.status}`);
      }
      planId = (await planRes.json()).id;

      const checkout = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        },
      );
      if (checkout.status !== 200) {
        throw new Error(`Expected 200 checkout, got ${checkout.status}`);
      }
      sessionId = (await checkout.json()).sessionId;

      const webhook = await apiFetch(`/public/stripe/webhook/${packId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify({
          id: `evt_e2e_p4_${Date.now()}`,
          object: 'event',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: sessionId,
              object: 'checkout.session',
              mode: 'subscription',
              status: 'complete',
              payment_status: 'paid',
              client_reference_id: show.id,
              customer: 'cus_e2e_p4',
              subscription: `sub_e2e_${sessionId}`,
              customer_email: 'listener-p4@e2e.test',
              customer_details: { email: 'listener-p4@e2e.test' },
              metadata: {
                harborfm_podcast_id: show.id,
                harborfm_plan_id: planId,
                harborfm_credentials_id: packId,
                harborfm_mode: 'test',
              },
            },
          },
        }),
      });
      if (webhook.status !== 200) {
        throw new Error(`Expected 200 webhook, got ${webhook.status}`);
      }

      const success = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/checkout/success?session_id=${encodeURIComponent(sessionId)}`,
        {},
        listenerJar,
      );
      if (success.status !== 200) {
        throw new Error(`Expected 200 success, got ${success.status}`);
      }
      const data = await success.json();
      rawToken = data.token;
      if (!rawToken?.startsWith('hfm_sub_')) {
        throw new Error('Expected subscriber token');
      }
      if (data.alreadyClaimed) {
        throw new Error('Expected alreadyClaimed false on first claim');
      }

      const second = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/checkout/success?session_id=${encodeURIComponent(sessionId)}`,
        {},
        listenerJar,
      );
      if (second.status !== 200) {
        throw new Error(`Expected 200 on second success, got ${second.status}`);
      }
      const secondData = await second.json();
      if (secondData.token) {
        throw new Error('Expected token null on second claim');
      }
      if (!secondData.alreadyClaimed) {
        throw new Error('Expected alreadyClaimed true on second claim');
      }
    }),
  );

  results.push(
    await runOne('GET subscription status returns active plan', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/status`,
        {},
        listenerJar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 status, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (data.status !== 'active' && data.status !== 'one_time') {
        throw new Error(`Expected active status, got ${data.status}`);
      }
      if (!data.canManageBilling) throw new Error('Expected canManageBilling');
      if (!data.canCancelAtPeriodEnd) throw new Error('Expected canCancelAtPeriodEnd');
      if (!data.plan || data.plan.id !== planId) {
        throw new Error('Expected plan on status');
      }
    }),
  );

  results.push(
    await runOne('Portal returns E2E billing URL', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/portal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        listenerJar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 portal, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.url || !String(data.url).includes('billing.stripe.com/e2e')) {
        throw new Error(`Expected E2E portal URL, got ${data.url}`);
      }
    }),
  );

  results.push(
    await runOne('Cancel at period end + webhook sync', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/cancel-at-period-end`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cancel: true }),
        },
        listenerJar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 cancel, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.cancelAtPeriodEnd) {
        throw new Error('Expected cancelAtPeriodEnd true');
      }

      const webhook = await apiFetch(`/public/stripe/webhook/${packId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify({
          id: `evt_e2e_p4_cancel_${Date.now()}`,
          object: 'event',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: `sub_e2e_${sessionId}`,
              object: 'subscription',
              status: 'active',
              cancel_at_period_end: true,
              items: {
                data: [
                  {
                    current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
                  },
                ],
              },
            },
          },
        }),
      });
      if (webhook.status !== 200) {
        throw new Error(`Expected 200 cancel webhook, got ${webhook.status}`);
      }

      const status = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/status`,
        {},
        listenerJar,
      );
      const statusData = await status.json();
      if (!statusData.cancelAtPeriodEnd) {
        throw new Error('Expected cancelAtPeriodEnd after webhook');
      }
      if (!statusData.canRenew) {
        throw new Error('Expected canRenew when cancel scheduled');
      }
    }),
  );

  results.push(
    await runOne('Renew undoes cancel_at_period_end', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/renew`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        listenerJar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 renew, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (data.cancelAtPeriodEnd !== false) {
        throw new Error('Expected cancelAtPeriodEnd false after renew');
      }
    }),
  );

  results.push(
    await runOne('Second renew within 1 minute returns 429', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/renew`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        listenerJar,
      );
      if (res.status !== 429) {
        const body = await res.text();
        throw new Error(`Expected 429 renew cooldown, got ${res.status}: ${body}`);
      }
      const retryAfter = res.headers.get('retry-after');
      if (!retryAfter || Number(retryAfter) < 1) {
        throw new Error(`Expected Retry-After header, got ${retryAfter}`);
      }
    }),
  );

  results.push(
    await runOne('Recover-token second request within 1 minute returns 429', async () => {
      await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            emailProvider: 'webhook',
            emailWebhookUrl: 'http://127.0.0.1:9',
          }),
        },
        adminJar,
      );

      const first = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/recover-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'listener-p4@e2e.test' }),
        },
      );
      if (first.status !== 200) {
        const body = await first.text();
        throw new Error(`Expected 200 recover-token, got ${first.status}: ${body}`);
      }

      const second = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/recover-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'listener-p4@e2e.test' }),
        },
      );
      if (second.status !== 429) {
        const body = await second.text();
        throw new Error(
          `Expected 429 recover-token cooldown, got ${second.status}: ${body}`,
        );
      }

      await apiFetch(
        '/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailProvider: 'none' }),
        },
        adminJar,
      );
    }),
  );

  results.push(
    await runOne('Regenerate rotates token; old RSS 404, new RSS 200', async () => {
      const oldToken = rawToken;
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/regenerate-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        listenerJar,
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 regenerate, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.token || data.token === oldToken) {
        throw new Error('Expected a new token');
      }
      rawToken = data.token;

      // Earlier suites may have burned the unknown-token ban budget for loopback.
      await unbanLoopback(adminJar);

      const oldRss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(oldToken)}/rss`,
      );
      if (oldRss.status !== 404) {
        throw new Error(`Expected old token RSS 404, got ${oldRss.status}`);
      }

      const newRss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (newRss.status !== 200) {
        throw new Error(`Expected new token RSS 200, got ${newRss.status}`);
      }

      // Token body auth still works without cookie
      const statusByToken = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/status?token=${encodeURIComponent(rawToken)}`,
        {},
      );
      if (statusByToken.status !== 200) {
        throw new Error(`Expected status via token query, got ${statusByToken.status}`);
      }
    }),
  );

  results.push(
    await runOne('Unauthenticated manage endpoints return 404', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/subscription/status`,
        {},
      );
      if (res.status !== 404) {
        throw new Error(`Expected 404 without auth, got ${res.status}`);
      }
    }),
  );

  return results;
}
