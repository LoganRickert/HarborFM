import {
  apiFetch,
  loginAsAdmin,
  createUser,
  createShow,
  cookieJar,
  login,
  baseURL,
} from '../../lib/helpers.js';

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

  const userA = await createUser({ email: `stripe-checkout-a-${Date.now()}@e2e.test` });
  const jarA = cookieJar();
  await login(userA.email, userA.password, jarA);

  const show = await createShow(jarA, {
    title: 'Stripe Checkout Show',
    slug: `stripe-checkout-${Date.now()}`,
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

  results.push(
    await runOne('Setup: pack, attach, monthly plan', async () => {
      const createRes = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'P3 Stripe',
            mode: 'test',
            testSecretKey: 'sk_test_e2e_secret_checkoutaaaa',
            testPublishableKey: 'pk_test_e2e_pub_checkoutaaaa',
            testWebhookSecret: 'whsec_e2e_test_checkoutaaaa',
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
            amountCents: 500,
            currency: 'usd',
          }),
        },
        jarA,
      );
      if (planRes.status !== 201) {
        throw new Error(`Expected 201 plan, got ${planRes.status}`);
      }
      const plan = await planRes.json();
      planId = plan.id;
    }),
  );

  results.push(
    await runOne('Public plans list is enabled with active plan', async () => {
      const res = await apiFetch(`/public/podcasts/${show.slug}/stripe/plans`, {});
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.enabled) throw new Error('Expected enabled true');
      if (data.mode !== 'test') throw new Error('Expected test mode');
      if (!Array.isArray(data.plans) || data.plans.length < 1) {
        throw new Error('Expected at least one plan');
      }
      if (!data.plans.some((p) => p.id === planId)) {
        throw new Error('Expected monthly plan in public list');
      }
    }),
  );

  let sessionId = null;

  results.push(
    await runOne('Checkout creates E2E session URL', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        },
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 checkout, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.url || !data.sessionId) {
        throw new Error('Expected url and sessionId');
      }
      if (!String(data.sessionId).startsWith('cs_e2e_')) {
        throw new Error('Expected E2E session id');
      }
      sessionId = data.sessionId;
    }),
  );

  let rawToken = null;

  results.push(
    await runOne('Webhook checkout.session.completed creates token', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const payload = {
        id: `evt_e2e_${Date.now()}`,
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
            customer: 'cus_e2e_webhook',
            subscription: `sub_e2e_${sessionId}`,
            customer_email: 'listener@e2e.test',
            customer_details: { email: 'listener@e2e.test' },
            metadata: {
              harborfm_podcast_id: show.id,
              harborfm_plan_id: planId,
              harborfm_credentials_id: packId,
              harborfm_mode: 'test',
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 webhook, got ${res.status}: ${body}`);
      }
    }),
  );

  results.push(
    await runOne('Success endpoint returns token and private RSS works', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/checkout/success?session_id=${encodeURIComponent(sessionId)}`,
        {},
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 success, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (!data.token || !String(data.token).startsWith('hfm_sub_')) {
        throw new Error('Expected subscriber token');
      }
      if (data.alreadyClaimed) {
        throw new Error('Expected alreadyClaimed false on first claim');
      }
      rawToken = data.token;

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 200) {
        throw new Error(`Expected private RSS 200, got ${rss.status}`);
      }
      const xml = await rss.text();
      if (!xml.includes('<rss') && !xml.includes('<feed')) {
        throw new Error('Expected RSS/XML body');
      }
    }),
  );

  results.push(
    await runOne('Success endpoint does not re-reveal token on second claim', async () => {
      const res = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/checkout/success?session_id=${encodeURIComponent(sessionId)}`,
        {},
      );
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 success, got ${res.status}: ${body}`);
      }
      const data = await res.json();
      if (data.token) {
        throw new Error('Expected token null on second claim');
      }
      if (!data.alreadyClaimed) {
        throw new Error('Expected alreadyClaimed true on second claim');
      }
      if (!data.success) {
        throw new Error('Expected success true on second claim');
      }
    }),
  );

  results.push(
    await runOne('invoice.payment_failed disables token access', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const payload = {
        id: `evt_e2e_fail_${Date.now()}`,
        object: 'event',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: `in_e2e_${Date.now()}`,
            object: 'invoice',
            parent: {
              type: 'subscription_details',
              subscription_details: {
                subscription: `sub_e2e_${sessionId}`,
                metadata: null,
              },
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 fail webhook, got ${res.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 404) {
        throw new Error(`Expected private RSS 404 after failed payment, got ${rss.status}`);
      }
    }),
  );

  results.push(
    await runOne('invoice.paid re-enables token access', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const payload = {
        id: `evt_e2e_paid_${Date.now()}`,
        object: 'event',
        type: 'invoice.paid',
        data: {
          object: {
            id: `in_e2e_paid_${Date.now()}`,
            object: 'invoice',
            parent: {
              type: 'subscription_details',
              subscription_details: {
                subscription: `sub_e2e_${sessionId}`,
                metadata: null,
              },
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 paid webhook, got ${res.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 200) {
        throw new Error(`Expected private RSS 200 after re-enable, got ${rss.status}`);
      }
    }),
  );

  results.push(
    await runOne('customer.subscription.paused disables token access', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const payload = {
        id: `evt_e2e_paused_${Date.now()}`,
        object: 'event',
        type: 'customer.subscription.paused',
        data: {
          object: {
            id: `sub_e2e_${sessionId}`,
            object: 'subscription',
            status: 'paused',
            cancel_at_period_end: false,
            items: { data: [] },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 pause webhook, got ${res.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 404) {
        throw new Error(`Expected private RSS 404 after pause, got ${rss.status}`);
      }
    }),
  );

  results.push(
    await runOne('customer.subscription.resumed re-enables token access', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const payload = {
        id: `evt_e2e_resumed_${Date.now()}`,
        object: 'event',
        type: 'customer.subscription.resumed',
        data: {
          object: {
            id: `sub_e2e_${sessionId}`,
            object: 'subscription',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
                },
              ],
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 resume webhook, got ${res.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 200) {
        throw new Error(`Expected private RSS 200 after resume, got ${rss.status}`);
      }
    }),
  );

  results.push(
    await runOne('Period end before renewal payment keeps feed access', async () => {
      // Simulate Stripe lag: period clock rolled ~1h ago (within 1-day grace) but
      // subscription is still active while the renewal charge is in flight.
      const path = `/public/stripe/webhook/${packId}`;
      const periodEndedSec = Math.floor(Date.now() / 1000) - 3600;
      const payload = {
        id: `evt_e2e_period_lag_${Date.now()}`,
        object: 'event',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: `sub_e2e_${sessionId}`,
            object: 'subscription',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [{ current_period_end: periodEndedSec }],
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 period-lag webhook, got ${res.status}: ${body}`);
      }

      const tokensRes = await apiFetch(
        `/podcasts/${show.id}/subscriber-tokens?limit=20&offset=0`,
        {},
        jarA,
      );
      if (tokensRes.status !== 200) {
        throw new Error(`Expected 200 tokens list, got ${tokensRes.status}`);
      }
      const tokensData = await tokensRes.json();
      const stripeToken = (tokensData.tokens || []).find((t) =>
        String(t.name || '').includes('listener@e2e.test'),
      );
      if (!stripeToken) throw new Error('Expected Stripe subscriber token in list');
      if (!stripeToken.validUntil || !(stripeToken.validUntil < new Date().toISOString())) {
        throw new Error(
          `Expected token validUntil in the past after period lag, got ${stripeToken.validUntil}`,
        );
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 200) {
        throw new Error(
          `Expected private RSS 200 during renewal lag (active Stripe sub, <1 day), got ${rss.status}`,
        );
      }
    }),
  );

  results.push(
    await runOne('Period end older than 1 day denies access even if Stripe active', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const periodEndedSec = Math.floor(Date.now() / 1000) - 86400 * 2;
      const payload = {
        id: `evt_e2e_period_stale_${Date.now()}`,
        object: 'event',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: `sub_e2e_${sessionId}`,
            object: 'subscription',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [{ current_period_end: periodEndedSec }],
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 stale-period webhook, got ${res.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 404) {
        throw new Error(
          `Expected private RSS 404 when valid_until is >1 day past (sync bug guard), got ${rss.status}`,
        );
      }

      // Restore an in-grace expired period so the following renewal test can extend it.
      const restoreSec = Math.floor(Date.now() / 1000) - 3600;
      const restore = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify({
          id: `evt_e2e_period_restore_${Date.now()}`,
          object: 'event',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: `sub_e2e_${sessionId}`,
              object: 'subscription',
              status: 'active',
              cancel_at_period_end: false,
              items: {
                data: [{ current_period_end: restoreSec }],
              },
            },
          },
        }),
      });
      if (restore.status !== 200) {
        const body = await restore.text();
        throw new Error(`Expected 200 restore webhook, got ${restore.status}: ${body}`);
      }
    }),
  );

  results.push(
    await runOne('invoice.paid renewal extends period and keeps access', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const newPeriodEndSec = Math.floor(Date.now() / 1000) + 86400 * 30;
      const payload = {
        id: `evt_e2e_renewal_paid_${Date.now()}`,
        object: 'event',
        type: 'invoice.paid',
        data: {
          object: {
            id: `in_e2e_renewal_${Date.now()}`,
            object: 'invoice',
            billing_reason: 'subscription_cycle',
            amount_paid: 500,
            currency: 'usd',
            lines: {
              data: [
                {
                  period: {
                    start: Math.floor(Date.now() / 1000) - 60,
                    end: newPeriodEndSec,
                  },
                },
              ],
            },
            parent: {
              type: 'subscription_details',
              subscription_details: {
                subscription: `sub_e2e_${sessionId}`,
                metadata: null,
              },
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 renewal invoice.paid, got ${res.status}: ${body}`);
      }

      const tokensRes = await apiFetch(
        `/podcasts/${show.id}/subscriber-tokens?limit=20&offset=0`,
        {},
        jarA,
      );
      if (tokensRes.status !== 200) {
        throw new Error(`Expected 200 tokens list, got ${tokensRes.status}`);
      }
      const tokensData = await tokensRes.json();
      const stripeToken = (tokensData.tokens || []).find((t) =>
        String(t.name || '').includes('listener@e2e.test'),
      );
      if (!stripeToken?.validUntil || !(stripeToken.validUntil > new Date().toISOString())) {
        throw new Error(
          `Expected token validUntil extended into the future after renewal, got ${stripeToken?.validUntil}`,
        );
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 200) {
        throw new Error(`Expected private RSS 200 after renewal payment, got ${rss.status}`);
      }
    }),
  );

  results.push(
    await runOne('charge.refunded full refund disables token', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const payload = {
        id: `evt_e2e_refund_${Date.now()}`,
        object: 'event',
        type: 'charge.refunded',
        data: {
          object: {
            id: `ch_e2e_${sessionId}`,
            object: 'charge',
            amount: 500,
            amount_refunded: 500,
            currency: 'usd',
            refunded: true,
            payment_intent: `pi_e2e_${sessionId}`,
            billing_details: { email: 'listener@e2e.test' },
            metadata: {
              harborfm_podcast_id: show.id,
              harborfm_plan_id: planId,
              harborfm_credentials_id: packId,
              harborfm_mode: 'test',
            },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 refund webhook, got ${res.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 404) {
        throw new Error(`Expected private RSS 404 after refund, got ${rss.status}`);
      }
    }),
  );

  results.push(
    await runOne('customer.subscription.updated canceled disables token', async () => {
      const path = `/public/stripe/webhook/${packId}`;
      const payload = {
        id: `evt_e2e_canceled_${Date.now()}`,
        object: 'event',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: `sub_e2e_${sessionId}`,
            object: 'subscription',
            status: 'canceled',
            cancel_at_period_end: false,
            items: { data: [] },
          },
        },
      };
      const res = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200 cancel webhook, got ${res.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(rawToken)}/rss`,
      );
      if (rss.status !== 404) {
        throw new Error(`Expected private RSS 404 after cancel, got ${rss.status}`);
      }
    }),
  );

  results.push(
    await runOne('Deleting recurring plan cancels its active subscriptions', async () => {
      const yearRes = await apiFetch(
        `/podcasts/${show.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'year',
            amountCents: 5000,
            currency: 'usd',
          }),
        },
        jarA,
      );
      if (yearRes.status !== 201) {
        throw new Error(`Expected 201 year plan, got ${yearRes.status}`);
      }
      const yearPlanId = (await yearRes.json()).id;

      const checkout = await apiFetch(
        `/public/podcasts/${show.slug}/stripe/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: yearPlanId }),
        },
      );
      if (checkout.status !== 200) {
        throw new Error(`Expected 200 checkout, got ${checkout.status}`);
      }
      const yearSessionId = (await checkout.json()).sessionId;

      const webhook = await apiFetch(`/public/stripe/webhook/${packId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify({
          id: `evt_e2e_plan_del_${Date.now()}`,
          object: 'event',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: yearSessionId,
              object: 'checkout.session',
              mode: 'subscription',
              status: 'complete',
              payment_status: 'paid',
              client_reference_id: show.id,
              customer: 'cus_e2e_plan_del',
              subscription: `sub_e2e_plan_del_${yearSessionId}`,
              customer_email: 'plan-del@e2e.test',
              customer_details: { email: 'plan-del@e2e.test' },
              metadata: {
                harborfm_podcast_id: show.id,
                harborfm_plan_id: yearPlanId,
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
        `/public/podcasts/${show.slug}/stripe/checkout/success?session_id=${encodeURIComponent(yearSessionId)}`,
      );
      if (success.status !== 200) {
        throw new Error(`Expected 200 success, got ${success.status}`);
      }
      const yearToken = (await success.json()).token;
      if (!yearToken) throw new Error('Expected year subscriber token');

      const del = await apiFetch(
        `/podcasts/${show.id}/stripe/plans/${yearPlanId}`,
        { method: 'DELETE' },
        jarA,
      );
      if (del.status !== 200) {
        const body = await del.text();
        throw new Error(`Expected 200 delete plan, got ${del.status}: ${body}`);
      }

      const rss = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(show.slug)}/private/${encodeURIComponent(yearToken)}/rss`,
      );
      if (rss.status !== 404) {
        throw new Error(
          `Expected private RSS 404 after plan delete, got ${rss.status}`,
        );
      }

      const subsList = await apiFetch(
        `/podcasts/${show.id}/stripe/subscriptions?q=plan-del@e2e.test`,
        {},
        jarA,
      );
      if (subsList.status !== 200) {
        throw new Error(`Expected 200 subscriptions, got ${subsList.status}`);
      }
      const subsData = await subsList.json();
      const stillActive = (subsData.subscriptions || []).filter(
        (s) =>
          s.customerEmail === 'plan-del@e2e.test' &&
          (s.status === 'active' || s.status === 'trialing'),
      );
      if (stillActive.length > 0) {
        throw new Error('Expected no active subscription after plan delete');
      }
    }),
  );

  return results;
}
