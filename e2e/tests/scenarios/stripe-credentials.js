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

  // Ensure registration + default can stripe
  await apiFetch(
    '/settings',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationEnabled: true, defaultCanStripe: true }),
    },
    adminJar,
  );

  const userA = await createUser({ email: `stripe-a-${Date.now()}@e2e.test` });
  const userB = await createUser({ email: `stripe-b-${Date.now()}@e2e.test` });
  const jarA = cookieJar();
  const jarB = cookieJar();
  await login(userA.email, userA.password, jarA);
  await login(userB.email, userB.password, jarB);

  const showA1 = await createShow(jarA, {
    title: 'Stripe Show A1',
    slug: `stripe-a1-${Date.now()}`,
  });
  const showA2 = await createShow(jarA, {
    title: 'Stripe Show A2',
    slug: `stripe-a2-${Date.now()}`,
  });
  const showB = await createShow(jarB, {
    title: 'Stripe Show B',
    slug: `stripe-b-${Date.now()}`,
  });

  let packAId = null;

  results.push(
    await runOne('POST /stripe/credentials creates pack for user A', async () => {
      const res = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'A Main Stripe',
            mode: 'test',
            testSecretKey: 'sk_test_e2e_secret_aaaaaaaa',
            testPublishableKey: 'pk_test_e2e_pub_aaaaaaaa',
            testWebhookSecret: 'whsec_e2e_test_aaaaaaaa',
          }),
        },
        jarA,
      );
      if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
      const data = await res.json();
      if (!data.id) throw new Error('Expected id');
      if (data.testSecretKeySet !== true) throw new Error('Expected testSecretKeySet');
      if (data.testSecretKey || data.testSecretKeyEnc) {
        throw new Error('Must not return secret key plaintext/ciphertext');
      }
      if (!data.webhookUrl || !data.webhookUrl.includes(`/public/stripe/webhook/${data.id}`)) {
        throw new Error(`Unexpected webhookUrl: ${data.webhookUrl}`);
      }
      if (data.publishableKey !== 'pk_test_e2e_pub_aaaaaaaa') {
        throw new Error(`Expected publishable key returned, got ${data.publishableKey}`);
      }
      if (data.verified !== true) {
        throw new Error('Expected E2E pack to be verified');
      }
      packAId = data.id;
    }),
  );

  results.push(
    await runOne('Unverified pack cannot be attached to a show', async () => {
      const createRes = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'A Unverified Stripe',
            mode: 'test',
            testSecretKey: 'rk_test_notverified_aaaaaaaa',
            testPublishableKey: 'pk_test_notverified_aaaaaaaa',
            testWebhookSecret: 'whsec_notverified_aaaaaaaa',
          }),
        },
        jarA,
      );
      if (createRes.status !== 201) {
        throw new Error(`Expected 201 unverified pack, got ${createRes.status}`);
      }
      const unverified = await createRes.json();
      if (unverified.verified !== false) {
        throw new Error('Expected verified false for non-E2E pack');
      }
      const attach = await apiFetch(
        `/podcasts/${showA1.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stripeCredentialsId: unverified.id,
            stripePaymentsEnabled: true,
          }),
        },
        jarA,
      );
      if (attach.status !== 400) {
        const body = await attach.text();
        throw new Error(`Expected 400 attach unverified, got ${attach.status}: ${body}`);
      }
      await apiFetch(`/stripe/credentials/${unverified.id}`, { method: 'DELETE' }, jarA);
    }),
  );

  results.push(
    await runOne('GET /stripe/credentials lists only own packs for A', async () => {
      const res = await apiFetch('/stripe/credentials', {}, jarA);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.credentials)) throw new Error('Expected credentials array');
      if (!data.credentials.some((c) => c.id === packAId)) {
        throw new Error('Expected pack A in list');
      }
    }),
  );

  results.push(
    await runOne('User B cannot GET user A credentials by id', async () => {
      const res = await apiFetch(`/stripe/credentials/${packAId}`, {}, jarB);
      if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('User B list does not include user A packs', async () => {
      const res = await apiFetch('/stripe/credentials', {}, jarB);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.credentials.some((c) => c.id === packAId)) {
        throw new Error('User B must not see user A packs');
      }
    }),
  );

  results.push(
    await runOne('User A can attach same pack to two shows', async () => {
      for (const show of [showA1, showA2]) {
        const res = await apiFetch(
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
        if (res.status !== 200) throw new Error(`Expected 200 attach, got ${res.status}`);
        const data = await res.json();
        if (data.stripeCredentialsId !== packAId) {
          throw new Error('Expected stripeCredentialsId set');
        }
        if (data.stripePaymentsEnabled !== true) {
          throw new Error('Expected stripePaymentsEnabled true');
        }
      }
      const list1 = await apiFetch(`/podcasts/${showA1.id}/stripe/credentials`, {}, jarA);
      const list2 = await apiFetch(`/podcasts/${showA2.id}/stripe/credentials`, {}, jarA);
      const d1 = await list1.json();
      const d2 = await list2.json();
      if (d1.stripeCredentialsId !== packAId || d2.stripeCredentialsId !== packAId) {
        throw new Error('Both shows should share the same pack');
      }
    }),
  );

  results.push(
    await runOne('User B cannot attach user A pack to B show', async () => {
      const res = await apiFetch(
        `/podcasts/${showB.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripeCredentialsId: packAId }),
        },
        jarB,
      );
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    }),
  );

  results.push(
    await runOne('PATCH credentials rejects mode changes', async () => {
      const res = await apiFetch(
        `/stripe/credentials/${packAId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'live' }),
        },
        jarA,
      );
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      const data = await res.json();
      if (!String(data.error || '').toLowerCase().includes('cannot be changed')) {
        throw new Error(`Unexpected error: ${data.error}`);
      }
    }),
  );

  results.push(
    await runOne('Separate live account can be created and attached', async () => {
      const createRes = await apiFetch(
        '/stripe/credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'A Live Stripe',
            mode: 'live',
            liveSecretKey: 'sk_live_e2e_secret_bbbbbbbb',
            livePublishableKey: 'pk_live_e2e_pub_bbbbbbbb',
          }),
        },
        jarA,
      );
      if (createRes.status !== 201) {
        throw new Error(`Expected 201 live pack, got ${createRes.status}`);
      }
      const livePack = await createRes.json();
      if (livePack.mode !== 'live') throw new Error('Expected live mode on new pack');

      const attach = await apiFetch(
        `/podcasts/${showA1.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripeCredentialsId: livePack.id }),
        },
        jarA,
      );
      if (attach.status !== 200) throw new Error(`Expected 200 attach live, got ${attach.status}`);

      // Switch show back to test pack
      const back = await apiFetch(
        `/podcasts/${showA1.id}/stripe`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripeCredentialsId: packAId }),
        },
        jarA,
      );
      if (back.status !== 200) throw new Error(`Expected 200 reattach test, got ${back.status}`);
    }),
  );

  results.push(
    await runOne('canStripe=false gates credential routes with 403', async () => {
      const listRes = await apiFetch('/users?limit=100', {}, adminJar);
      const list = await listRes.json();
      const u = list.users.find((x) => x.email === userA.email);
      if (!u) throw new Error('User A not found');
      await apiFetch(
        `/users/${u.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canStripe: false }),
        },
        adminJar,
      );

      const jarA2 = cookieJar();
      await login(userA.email, userA.password, jarA2);
      const res = await apiFetch('/stripe/credentials', {}, jarA2);
      if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);

      // restore
      await apiFetch(
        `/users/${u.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canStripe: true }),
        },
        adminJar,
      );
    }),
  );

  results.push(
    await runOne('GET /stripe/status configured true when pack has secret', async () => {
      const jarA2 = cookieJar();
      await login(userA.email, userA.password, jarA2);
      const res = await apiFetch('/stripe/status', {}, jarA2);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.canStripe !== true || data.configured !== true) {
        throw new Error(`Expected configured true, got ${JSON.stringify(data)}`);
      }
    }),
  );

  results.push(
    await runOne('DELETE credentials unlinks shows', async () => {
      const jarA2 = cookieJar();
      await login(userA.email, userA.password, jarA2);
      const del = await apiFetch(`/stripe/credentials/${packAId}`, { method: 'DELETE' }, jarA2);
      if (del.status !== 200) throw new Error(`Expected 200 delete, got ${del.status}`);
      const status = await apiFetch(`/podcasts/${showA1.id}/stripe/status`, {}, jarA2);
      const data = await status.json();
      if (data.stripeCredentialsId != null) {
        throw new Error('Expected stripeCredentialsId cleared after delete');
      }
    }),
  );

  return results;
}
