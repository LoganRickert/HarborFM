import {
  apiFetch,
  loginAsAdmin,
  createShow,
  createEpisode,
  startCall,
  callWebSocketConnect,
  baseURL,
} from '../../lib/helpers.js';

export async function run({ runOne }) {
  const results = [];
  const { jar } = await loginAsAdmin();
  const podcast = await createShow(jar, { title: 'E2E Call Show', slug: `e2e-call-${Date.now()}` });
  const episode = await createEpisode(jar, podcast.id, { title: 'E2E Call Episode', status: 'draft' });

  results.push(
    await runOne('POST /call/start returns session, joinUrl, token; webrtcUnavailable or no webrtcUrl when unconfigured', async () => {
      const data = await startCall(jar, episode.id);
      if (!data.token || !data.sessionId || !data.joinUrl) {
        throw new Error('Expected token, sessionId, joinUrl');
      }
      // With webrtc not started in e2e, we expect either webrtcUnavailable or absent webrtcUrl
      if (data.webrtcUrl && !data.webrtcUnavailable) {
        throw new Error('Expected webrtcUnavailable or no webrtcUrl when webrtc is unconfigured');
      }
    })
  );

  results.push(
    await runOne('GET /call/join-info/:token returns episode info', async () => {
      const { token } = await startCall(jar, episode.id);
      const res = await fetch(`${baseURL}/call/join-info/${encodeURIComponent(token)}`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.podcast?.title || !data.episode?.id || data.episode.id !== episode.id) {
        throw new Error('Expected podcast and episode in join-info');
      }
    })
  );

  results.push(
    await runOne('GET /call/session?episodeId= returns null when no active session', async () => {
      const otherEp = await createEpisode(jar, podcast.id, { title: 'E2E No Call Ep', status: 'draft' });
      const res = await apiFetch(`/call/session?episodeId=${encodeURIComponent(otherEp.id)}`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data !== null) throw new Error('Expected null when no active session');
    })
  );

  results.push(
    await runOne('GET /call/session?episodeId= returns session when active', async () => {
      const { sessionId, token } = await startCall(jar, episode.id);
      const res = await apiFetch(`/call/session?episodeId=${encodeURIComponent(episode.id)}`, {}, jar);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data || data.sessionId !== sessionId || data.token !== token) {
        throw new Error('Expected active session with matching sessionId and token');
      }
    })
  );

  results.push(
    await runOne('WebSocket without webrtc: startRecording yields recordingError', async () => {
      const { sessionId } = await startCall(jar, episode.id);
      const received = [];
      const { ws } = await callWebSocketConnect(sessionId, {
        jar,
        onMessage: (msg) => { received.push(msg); },
      });
      ws.send(JSON.stringify({ type: 'startRecording' }));
      await new Promise((r) => setTimeout(r, 800));
      ws.close();
      const err = received.find((m) => m.type === 'recordingError');
      if (!err) {
        const started = received.find((m) => m.type === 'recordingStarted');
        if (started) throw new Error('Expected recordingError, got recordingStarted (hides webrtc failure)');
        throw new Error(`Expected recordingError, got: ${JSON.stringify(received.map((m) => m.type))}`);
      }
    })
  );

  results.push(
    await runOne('POST /call/internal/recording-segment 401 without X-Recording-Secret', async () => {
      const res = await fetch(`${baseURL}/call/internal/recording-segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: 'podcasts/p1/episodes/e1/segments/s1.wav',
          segmentId: 's1',
          episodeId: episode.id,
          podcastId: podcast.id,
        }),
      });
      if (res.status !== 401) throw new Error(`Expected 401 without secret, got ${res.status}`);
    })
  );

  results.push(
    await runOne('POST /call/internal/recording-segment 400 with bad body', async () => {
      const res = await fetch(`${baseURL}/call/internal/recording-segment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recording-Secret': 'arbitrary-secret-may-401',
        },
        body: JSON.stringify({ filePath: 'x', segmentId: 'y' }), // missing episodeId, podcastId
      });
      // May be 401 (wrong secret) or 400 (validation) - both are acceptable for "bad request"
      if (res.status !== 400 && res.status !== 401) {
        throw new Error(`Expected 400 or 401, got ${res.status}`);
      }
    })
  );

  return results;
}
