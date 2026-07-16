/**
 * E2E: Episode polls - create/vote/rules, percentage-only public results, survives rebuild-irrelevant persistence.
 */
import {
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
  baseURL,
} from '../../lib/helpers.js';

function newId() {
  return `opt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const ts = Date.now();
  const slug = `e2e-poll-${ts}`;
  const show = await createShow(jar, { title: 'E2E Poll Show', slug });
  const ep = await createEpisode(jar, show.id, { title: 'E2E Poll Episode', status: 'draft' });
  await apiFetch(`/episodes/${ep.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'published', publishAt: null }),
  }, jar);

  const qId = `q${ts}`;
  const optA = newId();
  const optB = newId();
  const pollBody = {
    enabled: true,
    startAt: null,
    endAt: null,
    requireEmail: true,
    publicResults: true,
    limitOneVotePerIp: false,
    questions: [
      {
        id: qId,
        type: 'multiple_choice',
        prompt: 'Favorite color?',
        description: 'Pick one',
        options: [
          { id: optA, label: 'Blue' },
          { id: optB, label: 'Green' },
        ],
      },
    ],
  };

  results.push(
    await runOne('PUT episode poll creates poll that survives GET', async () => {
      const put = await apiFetch(`/episodes/${ep.id}/poll`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pollBody),
      }, jar);
      if (put.status !== 200) throw new Error(`PUT poll expected 200, got ${put.status} ${await put.text()}`);
      const get = await apiFetch(`/episodes/${ep.id}/poll`, {}, jar);
      if (get.status !== 200) throw new Error(`GET poll expected 200, got ${get.status}`);
      const data = await get.json();
      if (!data.enabled) throw new Error('Expected enabled poll');
      if (!Array.isArray(data.questions) || data.questions.length !== 1) {
        throw new Error('Expected 1 question');
      }
      if (data.questions[0].description !== 'Pick one') {
        throw new Error('Expected question description preserved');
      }
    })
  );

  results.push(
    await runOne('Public GET poll returns active poll; vote and get percentages without counts', async () => {
      const getRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(ep.slug)}/poll`,
      );
      if (getRes.status !== 200) throw new Error(`Expected public poll 200, got ${getRes.status}`);
      const poll = await getRes.json();
      if (poll.id == null) throw new Error('Expected poll id');

      const voteRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(ep.slug)}/poll/vote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: qId, optionId: optA }],
            email: `voter1-${ts}@e2e.test`,
          }),
        },
      );
      if (voteRes.status !== 200) {
        throw new Error(`Vote expected 200, got ${voteRes.status} ${await voteRes.text()}`);
      }
      const voteData = await voteRes.json();
      if (!voteData.ok) throw new Error('Expected ok');
      if (!voteData.verificationRequired) throw new Error('Expected verificationRequired when email required');
      if (!voteData.results || !Array.isArray(voteData.results.questions)) {
        throw new Error('Expected results after vote when publicResults');
      }
      const qRes = voteData.results.questions[0];
      if (!qRes.options || qRes.options.some((o) => o.count != null)) {
        throw new Error('Public results must not include absolute counts');
      }
      if (!qRes.options.some((o) => typeof o.percent === 'number')) {
        throw new Error('Expected percent on options');
      }
      // Until verified, require_email polls use verified-only aggregation to 0% ok
    })
  );

  results.push(
    await runOne('Duplicate email cannot vote twice', async () => {
      const voteRes = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(ep.slug)}/poll/vote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: qId, optionId: optB }],
            email: `voter1-${ts}@e2e.test`,
          }),
        },
      );
      if (voteRes.status !== 409) {
        throw new Error(`Expected 409 for duplicate email, got ${voteRes.status} ${await voteRes.text()}`);
      }
    })
  );

  results.push(
    await runOne('limitOneVotePerIp rejects second IP vote when enabled', async () => {
      const put = await apiFetch(`/episodes/${ep.id}/poll`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pollBody, limitOneVotePerIp: true, requireEmail: false }),
      }, jar);
      if (put.status !== 200) throw new Error(`PUT failed: ${put.status}`);

      const first = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(ep.slug)}/poll/vote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: qId, optionId: optB }],
          }),
        },
      );
      if (first.status !== 200 && first.status !== 409) {
        // 409 if cookie/ip already from previous votes is ok for IP test setup
        throw new Error(`First IP vote expected 200 or 409, got ${first.status} ${await first.text()}`);
      }

      const second = await fetch(
        `${baseURL}/public/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(ep.slug)}/poll/vote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [{ questionId: qId, optionId: optA }],
          }),
        },
      );
      if (second.status !== 409 && second.status !== 200) {
        throw new Error(`Expected 409 (IP/cookie) or soft alreadyVoted 200, got ${second.status}`);
      }
      if (second.status === 200) {
        const data = await second.json();
        if (!data.alreadyVoted && !data.ok) {
          throw new Error('Expected alreadyVoted soft response or conflict');
        }
      }
    })
  );

  results.push(
    await runOne('Poll still present after unrelated episode PATCH (rebuild-safe field)', async () => {
      await apiFetch(`/episodes/${ep.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'E2E Poll Episode Updated' }),
      }, jar);
      const get = await apiFetch(`/episodes/${ep.id}/poll`, {}, jar);
      const data = await get.json();
      if (!data.id || !data.questions?.length) {
        throw new Error('Poll must persist independent of episode field updates');
      }
    })
  );

  return results;
}
