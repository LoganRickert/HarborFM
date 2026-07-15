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

  const userA = await createUser({ email: `stripe-plans-a-${Date.now()}@e2e.test` });
  const userB = await createUser({ email: `stripe-plans-b-${Date.now()}@e2e.test` });
  const jarA = cookieJar();
  const jarB = cookieJar();
  await login(userA.email, userA.password, jarA);
  await login(userB.email, userB.password, jarB);

  const showA1 = await createShow(jarA, {
    title: 'Stripe Plans A1',
    slug: `stripe-plans-a1-${Date.now()}`,
  });
  const showA2 = await createShow(jarA, {
    title: 'Stripe Plans A2',
    slug: `stripe-plans-a2-${Date.now()}`,
  });
  const showB = await createShow(jarB, {
    title: 'Stripe Plans B',
    slug: `stripe-plans-b-${Date.now()}`,
  });

  let packAId = null;
  let planA1Id = null;
  let planA1ProductId = null;

  results.push(
    await runOne('Setup: create pack and attach to both A shows', async () => {
      const createRes = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'A Plans Stripe',
            mode: 'test',
            testSecretKey: 'sk_test_e2e_secret_bbbbbbbb',
            testPublishableKey: 'pk_test_e2e_pub_bbbbbbbb',
          }),
        },
        jarA,
      );
      if (createRes.status !== 201) {
        throw new Error(`Expected 201 creating pack, got ${createRes.status}`);
      }
      const pack = await createRes.json();
      packAId = pack.id;

      for (const show of [showA1, showA2]) {
        const attach = await apiFetch(
          `/podcasts/${show.id}/stripe`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stripeCredentialsId: packAId,
              stripePaymentsEnabled: true,
            }),
          },
          jarA,
        );
        if (attach.status !== 200) {
          throw new Error(`Expected 200 attaching, got ${attach.status}`);
        }
      }
    }),
  );

  results.push(
    await runOne('POST plan creates month plan with Stripe product ids', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'month',
            amountCents: 500,
            currency: 'usd',
            autoRenewDefault: true,
          }),
        },
        jarA,
      );
      if (res.status !== 201) {
        const body = await res.text();
        throw new Error(`Expected 201, got ${res.status}: ${body}`);
      }
      const plan = await res.json();
      if (plan.kind !== 'month') throw new Error('Expected month kind');
      if (plan.amountCents !== 500) throw new Error('Expected 500 cents');
      if (plan.mode !== 'test') throw new Error('Expected test mode');
      if (!plan.stripeProductId || !plan.stripePriceId) {
        throw new Error('Expected stripe product/price ids');
      }
      if (!plan.productUrl) throw new Error('Expected productUrl');
      planA1Id = plan.id;
      planA1ProductId = plan.stripeProductId;
    }),
  );

  results.push(
    await runOne('Same credentials on second show get different product ids', async () => {
      const res = await apiFetch(
        `/podcasts/${showA2.id}/stripe/plans`,
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
      if (res.status !== 201) {
        throw new Error(`Expected 201, got ${res.status}`);
      }
      const plan = await res.json();
      if (plan.stripeProductId === planA1ProductId) {
        throw new Error('Shows sharing credentials must get distinct products');
      }
    }),
  );

  results.push(
    await runOne('Can create year and one_time plans', async () => {
      for (const [kind, amountCents] of [
        ['year', 5000],
        ['one_time', 2000],
      ]) {
        const res = await apiFetch(
          `/podcasts/${showA1.id}/stripe/plans`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, amountCents, currency: 'usd' }),
          },
          jarA,
        );
        if (res.status !== 201) {
          throw new Error(`Expected 201 for ${kind}, got ${res.status}`);
        }
      }
    }),
  );

  results.push(
    await runOne('Duplicate active kind in same mode is rejected', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'month',
            amountCents: 999,
            currency: 'usd',
          }),
        },
        jarA,
      );
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('GET plans lists only current mode plans', async () => {
      const res = await apiFetch(`/podcasts/${showA1.id}/stripe/plans`, {}, jarA);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.mode !== 'test') throw new Error('Expected mode test');
      if (!Array.isArray(data.plans) || data.plans.length !== 3) {
        throw new Error(`Expected 3 test plans, got ${data.plans?.length}`);
      }
      if (data.plans.some((p) => p.mode !== 'test')) {
        throw new Error('Live plans must not appear in test mode list');
      }
      if (data.billingAnchor !== 'anniversary') {
        throw new Error('Expected default billingAnchor anniversary');
      }
    }),
  );

  results.push(
    await runOne('PATCH billingAnchor persists', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billingAnchor: 'month_start' }),
        },
        jarA,
      );
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.billingAnchor !== 'month_start') {
        throw new Error('Expected billingAnchor month_start');
      }
      const list = await apiFetch(`/podcasts/${showA1.id}/stripe/plans`, {}, jarA);
      const listData = await list.json();
      if (listData.billingAnchor !== 'month_start') {
        throw new Error('Expected plans list to reflect billingAnchor');
      }
    }),
  );

  results.push(
    await runOne('Live-account plans are hidden while a test account is selected', async () => {
      const livePackRes = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'A Live Plans',
            mode: 'live',
            liveSecretKey: 'sk_live_e2e_secret_cccccccc',
            livePublishableKey: 'pk_live_e2e_pub_cccccccc',
          }),
        },
        jarA,
      );
      if (livePackRes.status !== 201) {
        throw new Error(`Expected 201 live pack, got ${livePackRes.status}`);
      }
      const livePack = await livePackRes.json();

      const attachLive = await apiFetch(
        `/podcasts/${showA1.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stripeCredentialsId: livePack.id,
            stripePaymentsEnabled: true,
          }),
        },
        jarA,
      );
      if (attachLive.status !== 200) {
        throw new Error(`Expected 200 attach live, got ${attachLive.status}`);
      }

      const livePlan = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans`,
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
      if (livePlan.status !== 201) {
        throw new Error(`Expected 201 live plan, got ${livePlan.status}`);
      }

      const back = await apiFetch(
        `/podcasts/${showA1.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripeCredentialsId: packAId }),
        },
        jarA,
      );
      if (back.status !== 200) throw new Error(`Expected 200 back to test, got ${back.status}`);

      const list = await apiFetch(`/podcasts/${showA1.id}/stripe/plans`, {}, jarA);
      const data = await list.json();
      if (data.mode !== 'test') throw new Error('Expected test mode');
      if (data.plans.some((p) => p.mode === 'live')) {
        throw new Error('Live plans must be hidden while a test account is selected');
      }
      if (data.plans.length !== 3) {
        throw new Error(`Expected 3 test plans after switch, got ${data.plans.length}`);
      }
    }),
  );

  results.push(
    await runOne('PATCH plan can deactivate', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans/${planA1Id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        },
        jarA,
      );
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const plan = await res.json();
      if (plan.active !== false) throw new Error('Expected inactive');
    }),
  );

  results.push(
    await runOne('Can create new plan of same kind after deactivate', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'month',
            amountCents: 999,
            currency: 'usd',
          }),
        },
        jarA,
      );
      if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
      const plan = await res.json();
      if (plan.kind !== 'month' || plan.active !== true) {
        throw new Error('Expected active month replacement plan');
      }
      if (plan.id === planA1Id) {
        throw new Error('Replacement plan must be a new row');
      }
    }),
  );

  results.push(
    await runOne('Cannot reactivate plan when another of that kind is active', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans/${planA1Id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: true }),
        },
        jarA,
      );
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('User B cannot create plans on user A show', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'year',
            amountCents: 1000,
            currency: 'usd',
          }),
        },
        jarB,
      );
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('User B show without credentials cannot create plan', async () => {
      const res = await apiFetch(
        `/podcasts/${showB.id}/stripe/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'month',
            amountCents: 500,
            currency: 'usd',
          }),
        },
        jarB,
      );
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('DELETE plan removes it from list', async () => {
      const res = await apiFetch(
        `/podcasts/${showA1.id}/stripe/plans/${planA1Id}`,
        { method: 'DELETE' },
        jarA,
      );
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const list = await apiFetch(`/podcasts/${showA1.id}/stripe/plans`, {}, jarA);
      const data = await list.json();
      if (data.plans.some((p) => p.id === planA1Id)) {
        throw new Error('Deleted plan still listed');
      }
    }),
  );

  return results;
}
