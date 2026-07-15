import {
  apiFetch,
  loginAsAdmin,
  createUser,
  createShow,
  cookieJar,
  login,
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

  const userA = await createUser({ email: `stripe-coupons-a-${Date.now()}@e2e.test` });
  const userNoStripe = await createUser({
    email: `stripe-coupons-ns-${Date.now()}@e2e.test`,
  });
  const jarA = cookieJar();
  const jarNo = cookieJar();
  await login(userA.email, userA.password, jarA);
  await login(userNoStripe.email, userNoStripe.password, jarNo);

  // Disable stripe for userNoStripe
  const listRes = await apiFetch('/users?limit=100', {}, adminJar);
  const list = await listRes.json();
  const noStripeUser = (list.users || []).find((u) => u.email === userNoStripe.email);
  if (!noStripeUser?.id) {
    throw new Error('Could not find no-stripe user in admin list');
  }
  await apiFetch(
    `/users/${noStripeUser.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canStripe: false }),
    },
    adminJar,
  );

  const showA1 = await createShow(jarA, {
    title: 'Stripe Coupons A1',
    slug: `stripe-coupons-a1-${Date.now()}`,
  });
  const showA2 = await createShow(jarA, {
    title: 'Stripe Coupons A2',
    slug: `stripe-coupons-a2-${Date.now()}`,
  });
  const showNo = await createShow(jarNo, {
    title: 'Stripe Coupons No',
    slug: `stripe-coupons-no-${Date.now()}`,
  });

  await apiFetch(
    `/podcasts/${showA1.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriberOnlyFeedEnabled: true }),
    },
    jarA,
  );

  let packId = null;
  let planId = null;
  let couponId = null;
  let promoId = null;

  results.push(
    await runOne('Setup: pack, attach both A shows, monthly plan', async () => {
      const createRes = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'P5 Stripe',
            mode: 'test',
            testSecretKey: 'sk_test_e2e_secret_couponsaaaa',
            testPublishableKey: 'pk_test_e2e_pub_couponsaaaa',
            testWebhookSecret: 'whsec_e2e_test_couponsaaaa',
          }),
        },
        jarA,
      );
      if (createRes.status !== 201) {
        throw new Error(`Expected 201 pack, got ${createRes.status}`);
      }
      packId = (await createRes.json()).id;

      for (const show of [showA1, showA2]) {
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
      }

      const planRes = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'month',
            amountCents: 1000,
            currency: 'usd',
          }),
        },
        jarA,
      );
      if (planRes.status !== 201) {
        throw new Error(`Expected 201 plan, got ${planRes.status}`);
      }
      planId = (await planRes.json()).id;
    }),
  );

  results.push(
    await runOne('Public plans hasActiveCoupons false before any coupons', async () => {
      const res = await apiFetch(`/public/podcasts/${showA1.slug}/stripe/plans`);
      if (res.status !== 200) {
        throw new Error(`Expected 200 plans, got ${res.status}`);
      }
      const data = await res.json();
      if (data.hasActiveCoupons !== false) {
        throw new Error(`Expected hasActiveCoupons false, got ${data.hasActiveCoupons}`);
      }
    }),
  );

  results.push(
    await runOne('POST coupon creates percent/once coupon', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/coupons`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'SAVE10',
            discountType: 'percent',
            percentOff: 10,
            duration: 'once',
            active: true,
          }),
        },
        jarA,
      );
      if (res.status !== 201) {
        const body = await res.text();
        throw new Error(`Expected 201 coupon, got ${res.status}: ${body}`);
      }
      const coupon = await res.json();
      couponId = coupon.id;
      promoId = coupon.stripePromotionCodeId;
      if (!coupon.stripeCouponId || !promoId) {
        throw new Error('Expected Stripe coupon + promo ids');
      }
      if (coupon.code !== 'SAVE10' || coupon.redemptionCount !== 0) {
        throw new Error('Unexpected coupon payload');
      }
    }),
  );

  results.push(
    await runOne('List coupons includes new coupon', async () => {
      const res = await apiFetch(`/podcasts/${showA1.id}/stripe/coupons`, {}, jarA);
      if (res.status !== 200) {
        throw new Error(`Expected 200 list, got ${res.status}`);
      }
      const data = await res.json();
      if (!data.coupons.some((c) => c.id === couponId)) {
        throw new Error('Expected coupon in list');
      }
    }),
  );

  results.push(
    await runOne('Public hasActiveCoupons true; checkout allows promo codes', async () => {
      const plans = await apiFetch(`/public/podcasts/${showA1.slug}/stripe/plans`);
      const plansData = await plans.json();
      if (!plansData.hasActiveCoupons) {
        throw new Error('Expected hasActiveCoupons true');
      }

      const checkout = await apiFetch(
        `/public/podcasts/${showA1.slug}/stripe/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        },
      );
      if (checkout.status !== 200) {
        const body = await checkout.text();
        throw new Error(`Expected 200 checkout, got ${checkout.status}: ${body}`);
      }
      const data = await checkout.json();
      if (data.allowPromotionCodes !== true) {
        throw new Error(`Expected allowPromotionCodes true, got ${data.allowPromotionCodes}`);
      }
      if (!String(data.url).includes('allow_promotion_codes=1')) {
        throw new Error('Expected e2e URL to include allow_promotion_codes=1');
      }
    }),
  );

  results.push(
    await runOne('Coupons isolated per show on shared pack', async () => {
      const listA2 = await apiFetch(
        `/podcasts/${showA2.id}/stripe/coupons`,
        {},
        jarA,
      );
      const data = await listA2.json();
      if (data.coupons.some((c) => c.id === couponId)) {
        throw new Error('Show A2 must not list A1 coupon');
      }
      const pub = await apiFetch(`/public/podcasts/${showA2.slug}/stripe/plans`);
      const pubData = await pub.json();
      if (pubData.hasActiveCoupons) {
        throw new Error('Show A2 should not have active coupons');
      }
    }),
  );

  results.push(
    await runOne('Fulfill with discount records redemption linked to subscription', async () => {
      const checkout = await apiFetch(
        `/public/podcasts/${showA1.slug}/stripe/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        },
      );
      const { sessionId } = await checkout.json();

      const webhook = await apiFetch(`/public/stripe/webhook/${packId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'e2e',
        },
        body: JSON.stringify({
          id: `evt_e2e_p5_${Date.now()}`,
          object: 'event',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: sessionId,
              object: 'checkout.session',
              mode: 'subscription',
              status: 'complete',
              payment_status: 'paid',
              amount_total: 900,
              total_details: { amount_discount: 100 },
              client_reference_id: showA1.id,
              customer: 'cus_e2e_p5',
              subscription: `sub_e2e_${sessionId}`,
              customer_email: 'coupon-user@e2e.test',
              customer_details: { email: 'coupon-user@e2e.test' },
              discounts: [
                {
                  promotion_code: promoId,
                  coupon: null,
                },
              ],
              metadata: {
                harborfm_podcast_id: showA1.id,
                harborfm_plan_id: planId,
                harborfm_credentials_id: packId,
                harborfm_mode: 'test',
                harborfm_coupon_id: couponId,
                harborfm_promo_code_id: promoId,
              },
            },
          },
        }),
      });
      if (webhook.status !== 200) {
        const body = await webhook.text();
        throw new Error(`Expected 200 webhook, got ${webhook.status}: ${body}`);
      }

      const list = await apiFetch(
        `/podcasts/${showA1.id}/stripe/coupons`,
        {},
        jarA,
      );
      const coupon = (await list.json()).coupons.find((c) => c.id === couponId);
      if (!coupon || coupon.redemptionCount < 1) {
        throw new Error('Expected redemptionCount >= 1');
      }
      if (!coupon.redemptions.some((r) => r.customerEmail === 'coupon-user@e2e.test')) {
        throw new Error('Expected redemption for coupon-user@e2e.test');
      }
      if (!coupon.redemptions[0]?.subscriptionId) {
        throw new Error('Expected redemption linked to subscription');
      }
    }),
  );

  results.push(
    await runOne('Inactive coupon clears hasActiveCoupons', async () => {
      const patch = await apiFetch(
        `/podcasts/${showA1.id}/stripe/coupons/${couponId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        },
        jarA,
      );
      if (patch.status !== 200) {
        throw new Error(`Expected 200 deactivate, got ${patch.status}`);
      }
      const pub = await apiFetch(`/public/podcasts/${showA1.slug}/stripe/plans`);
      const data = await pub.json();
      if (data.hasActiveCoupons) {
        throw new Error('Expected hasActiveCoupons false when coupon inactive');
      }
      // re-enable for later checks
      await apiFetch(
        `/podcasts/${showA1.id}/stripe/coupons/${couponId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: true }),
        },
        jarA,
      );
    }),
  );

  results.push(
    await runOne('Future startsAt coupon is not active', async () => {
      const future = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/coupons`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'LATER20',
            discountType: 'percent',
            percentOff: 20,
            duration: 'once',
            startsAt: future,
            active: true,
          }),
        },
        jarA,
      );
      if (res.status !== 201) {
        const body = await res.text();
        throw new Error(`Expected 201 future coupon, got ${res.status}: ${body}`);
      }
      // Deactivate SAVE10 so only future coupon remains "configured"
      await apiFetch(
        `/podcasts/${showA1.id}/stripe/coupons/${couponId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        },
        jarA,
      );
      const pub = await apiFetch(`/public/podcasts/${showA1.slug}/stripe/plans`);
      const data = await pub.json();
      if (data.hasActiveCoupons) {
        throw new Error('Future-dated coupon should not count as active');
      }
    }),
  );

  results.push(
    await runOne('can_stripe=false cannot manage coupons', async () => {
      const res = await apiFetch(
        `/podcasts/${showNo.id}/stripe/coupons`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'NOPE',
            discountType: 'percent',
            percentOff: 5,
            duration: 'once',
          }),
        },
        jarNo,
      );
      if (res.status !== 403) {
        throw new Error(`Expected 403 without canStripe, got ${res.status}`);
      }
    }),
  );

  return results;
}
