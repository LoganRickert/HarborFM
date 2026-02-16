/// <reference types="node" />
import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { createCallRecordingFixture, PORT } from './call-recording-helpers';

const WEBRTC_PORT = Number(process.env.WEBRTC_PORT) || 3098;
const WEBRTC_WS_URL = `ws://127.0.0.1:${WEBRTC_PORT}/ws`;
const WEBRTC_API = `http://127.0.0.1:${WEBRTC_PORT}`;
const API_BASE = `http://127.0.0.1:${PORT}/api`;

function connectWebRtcWs(roomId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WEBRTC_WS_URL}?roomId=${encodeURIComponent(roomId)}`);
    ws.on('open', () => resolve(ws));
    ws.on('close', (code) => {
      if (code !== 1000) reject(new Error(`WebSocket closed: code=${code}`));
    });
    ws.on('error', reject);
  });
}

function connectWebRtcWsAndExpectClose(roomId: string): Promise<{ closed: boolean; code?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WEBRTC_WS_URL}?roomId=${encodeURIComponent(roomId)}`);
    ws.on('open', () => {
      ws.on('close', (code) => resolve({ closed: true, code }));
    });
    ws.on('close', (code) => resolve({ closed: true, code }));
    ws.on('error', () => resolve({ closed: true }));
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.close();
        resolve({ closed: false });
      }
    }, 2000);
  });
}

/** Create a room via POST /room (e2e runs with WEBRTC_INSECURE_SKIP_AUTH=1). */
async function createRoom(roomId: string, hostToken?: string): Promise<void> {
  const res = await fetch(`${WEBRTC_API}/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, ...(hostToken ? { hostToken } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /room failed: ${res.status} ${text}`);
  }
}

test.describe('WebRTC security', () => {
  test('WebSocket rejects connection when roomId does not exist (no auto-create)', async () => {
    const result = await connectWebRtcWsAndExpectClose('nonexistent-room-xyz');
    expect(result.closed).toBe(true);
  });

  test('WebSocket rejects invalid roomId with path traversal', async () => {
    const result = await connectWebRtcWsAndExpectClose('../../etc/passwd');
    expect(result.closed).toBe(true);
  });

  test('WebSocket rejects invalid roomId with special characters', async () => {
    const result = await connectWebRtcWsAndExpectClose('room@invalid!chars');
    expect(result.closed).toBe(true);
  });

  test('WebSocket rejects invalid roomId with spaces', async () => {
    const result = await connectWebRtcWsAndExpectClose('room with spaces');
    expect(result.closed).toBe(true);
  });

  test('WebSocket accepts valid roomId when room was pre-created via POST /room', async () => {
    const roomId = `valid-room-${Date.now()}`;
    await createRoom(roomId);
    const ws = await connectWebRtcWs(roomId);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test('Oversize message is ignored (no crash)', async () => {
    const roomId = `oversize-${Date.now()}`;
    await createRoom(roomId);
    const ws = await connectWebRtcWs(roomId);
    const hugePayload = JSON.stringify({ type: 'getRouterRtpCapabilities', padding: 'x'.repeat(300 * 1024) });
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 3000);
      ws.on('message', () => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      });
      ws.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      ws.send(hugePayload);
    });
  });

  test('playSoundboard with invalid assetId returns error (host only)', async ({ page }) => {
    test.setTimeout(25000);
    const fixture = await createCallRecordingFixture(page);
    const csrf = (await page.context().storageState()).cookies.find((c) => c.name === 'harborfm_csrf')?.value;
    if (!csrf) throw new Error('No CSRF cookie');

    const startRes = await page.request.post(`${API_BASE}/call/start`, {
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: { episodeId: fixture.episodeId },
    });
    if (!startRes.ok()) throw new Error(`Start call failed: ${await startRes.text()}`);
    const { roomId, webrtcUrl, hostToken } = await startRes.json();
    if (!roomId || !webrtcUrl) throw new Error('No roomId/webrtcUrl - webrtc may be unavailable');

    const ws = new WebSocket(`${webrtcUrl}?roomId=${encodeURIComponent(roomId)}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });

    if (hostToken) {
      ws.send(JSON.stringify({ type: 'setHostToken', hostToken }));
    }

    const createTransport = (): Promise<string> =>
      new Promise((resolve, reject) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'webRtcTransportCreated') resolve(msg.id);
          else if (msg.type === 'error') reject(new Error(msg.error));
        });
        ws.send(JSON.stringify({ type: 'createWebRtcTransport' }));
      });

    ws.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
    await new Promise<void>((r) => ws.once('message', () => r()));
    await createTransport();

    const response = await new Promise<string>((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
      ws.send(
        JSON.stringify({
          type: 'playSoundboard',
          assetId: '../../../etc/passwd',
        }),
      );
      setTimeout(() => resolve(''), 5000);
    });
    ws.close();

    expect(response).toBeTruthy();
    const msg = JSON.parse(response || '{}');
    expect(msg.type).toBe('soundboardError');
    expect(msg.error).not.toBe('Host only');
  });

  test('guest cannot playSoundboard (Host only)', async ({ page }) => {
    test.setTimeout(25000);
    const fixture = await createCallRecordingFixture(page);
    const csrf = (await page.context().storageState()).cookies.find((c) => c.name === 'harborfm_csrf')?.value;
    if (!csrf) throw new Error('No CSRF cookie');

    const startRes = await page.request.post(`${API_BASE}/call/start`, {
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: { episodeId: fixture.episodeId },
    });
    if (!startRes.ok()) throw new Error(`Start call failed: ${await startRes.text()}`);
    const { roomId, webrtcUrl } = await startRes.json();
    if (!roomId || !webrtcUrl) throw new Error('No roomId/webrtcUrl - webrtc may be unavailable');

    const ws = new WebSocket(`${webrtcUrl}?roomId=${encodeURIComponent(roomId)}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });

    ws.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
    await new Promise<void>((r) => ws.once('message', () => r()));
    ws.send(JSON.stringify({ type: 'createWebRtcTransport' }));
    await new Promise<void>((r) => ws.once('message', () => r()));

    const response = await new Promise<string>((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
      ws.send(JSON.stringify({ type: 'playSoundboard', assetId: 'some-asset-id' }));
      setTimeout(() => resolve(''), 5000);
    });
    ws.close();

    expect(response).toBeTruthy();
    const msg = JSON.parse(response || '{}');
    expect(msg.type).toBe('error');
    expect(msg.error).toBe('Host only');
  });

  test('guest cannot soundboardVolume (Host only)', async ({ page }) => {
    test.setTimeout(20000);
    const fixture = await createCallRecordingFixture(page);
    const csrf = (await page.context().storageState()).cookies.find((c) => c.name === 'harborfm_csrf')?.value;
    if (!csrf) throw new Error('No CSRF cookie');

    const startRes = await page.request.post(`${API_BASE}/call/start`, {
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: { episodeId: fixture.episodeId },
    });
    if (!startRes.ok()) throw new Error(`Start call failed: ${await startRes.text()}`);
    const { roomId, webrtcUrl } = await startRes.json();
    if (!roomId || !webrtcUrl) throw new Error('No roomId/webrtcUrl - webrtc may be unavailable');

    const ws = new WebSocket(`${webrtcUrl}?roomId=${encodeURIComponent(roomId)}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });

    ws.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
    await new Promise<void>((r) => ws.once('message', () => r()));

    const response = await new Promise<string>((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
      ws.send(JSON.stringify({ type: 'soundboardVolume', volume: 0.5 }));
      setTimeout(() => resolve(''), 5000);
    });
    ws.close();

    expect(response).toBeTruthy();
    const msg = JSON.parse(response || '{}');
    expect(msg.type).toBe('error');
    expect(msg.error).toBe('Host only');
  });

  test('guest cannot stopSoundboard (Host only)', async ({ page }) => {
    test.setTimeout(20000);
    const fixture = await createCallRecordingFixture(page);
    const csrf = (await page.context().storageState()).cookies.find((c) => c.name === 'harborfm_csrf')?.value;
    if (!csrf) throw new Error('No CSRF cookie');

    const startRes = await page.request.post(`${API_BASE}/call/start`, {
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: { episodeId: fixture.episodeId },
    });
    if (!startRes.ok()) throw new Error(`Start call failed: ${await startRes.text()}`);
    const { roomId, webrtcUrl } = await startRes.json();
    if (!roomId || !webrtcUrl) throw new Error('No roomId/webrtcUrl - webrtc may be unavailable');

    const ws = new WebSocket(`${webrtcUrl}?roomId=${encodeURIComponent(roomId)}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });

    ws.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
    await new Promise<void>((r) => ws.once('message', () => r()));

    const response = await new Promise<string>((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
      ws.send(JSON.stringify({ type: 'stopSoundboard' }));
      setTimeout(() => resolve(''), 5000);
    });
    ws.close();

    expect(response).toBeTruthy();
    const msg = JSON.parse(response || '{}');
    expect(msg.type).toBe('error');
    expect(msg.error).toBe('Host only');
  });

  test('associateProducer with invalid participantId does not crash (silently rejected)', async () => {
    const roomId = `assoc-invalid-${Date.now()}`;
    await createRoom(roomId);

    const ws = await connectWebRtcWs(roomId);
    ws.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
    await new Promise<void>((r) => ws.once('message', () => r()));

    ws.send(JSON.stringify({
      type: 'associateProducer',
      producerId: 'nonexistent',
      participantId: '../../etc/passwd',
      participantName: 'Test',
    }));

    await new Promise<void>((r) => setTimeout(r, 500));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
