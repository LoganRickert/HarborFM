/// <reference types="node" />
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { APIRequestContext, Page } from '@playwright/test';
import { API_BASE, DATA_DIR, findMtDir } from './call-recording-helpers';

export type FakeDialInJoinResult = {
  ok: boolean;
  participantId: string;
  dialInId: string;
  producerId: string;
  sessionId: string;
  roomId: string;
  displayName: string;
};

export async function fakeDialInJoin(
  request: APIRequestContext,
  opts: { joinCode: string; displayName?: string; toneHz?: number },
): Promise<FakeDialInJoinResult> {
  const res = await request.post(`${API_BASE}/call/dial-in/fake/join`, {
    data: {
      joinCode: opts.joinCode,
      displayName: opts.displayName,
      toneHz: opts.toneHz,
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Fake dial-in join failed: ${res.status()} ${text}`);
  }
  return (await res.json()) as FakeDialInJoinResult;
}

export async function fakeDialInLeave(
  request: APIRequestContext,
  opts: { participantId: string; sessionId?: string; dialInId?: string },
): Promise<void> {
  const res = await request.post(`${API_BASE}/call/dial-in/fake/leave`, {
    data: opts,
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Fake dial-in leave failed: ${res.status()} ${text}`);
  }
}

export const E2E_DIAL_IN_NUMBER = '+15555550100';
export const E2E_DIAL_IN_CONSENT = 'E2E consent: this call may be recorded.';

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const state = await request.storageState();
  const csrf = state.cookies.find((c) => c.name === 'harborfm_csrf')?.value;
  if (!csrf) throw new Error('No CSRF cookie for dial-in settings request');
  return { 'x-csrf-token': csrf };
}

/** Enable product dial-in for FakeDialIn/IVR e2e (settings gate + DIAL_IN_FAKE). */
export async function ensureDialInSettings(
  request: APIRequestContext,
  opts?: {
    enabled?: boolean;
    phoneNumber?: string;
    consentPrompt?: string;
    telnyxApiKey?: string;
    telnyxPublicKey?: string;
    telnyxConnectionId?: string;
  },
): Promise<void> {
  const headers = await csrfHeaders(request);
  const res = await request.patch(`${API_BASE}/settings`, {
    headers,
    data: {
      dialInEnabled: opts?.enabled ?? true,
      dialInPhoneNumber: opts?.phoneNumber ?? E2E_DIAL_IN_NUMBER,
      dialInConsentPrompt: opts?.consentPrompt ?? E2E_DIAL_IN_CONSENT,
      ...(opts?.telnyxApiKey !== undefined
        ? { telnyxApiKey: opts.telnyxApiKey }
        : {}),
      ...(opts?.telnyxPublicKey !== undefined
        ? { telnyxPublicKey: opts.telnyxPublicKey }
        : {}),
      ...(opts?.telnyxConnectionId !== undefined
        ? { telnyxConnectionId: opts.telnyxConnectionId }
        : {}),
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Dial-in settings patch failed: ${res.status()} ${text}`);
  }
}

export async function getSettingsDialIn(
  request: APIRequestContext,
): Promise<{
  dialInEnabled: boolean;
  dialInPhoneNumber: string;
  dialInConsentPrompt: string;
  telnyxApiKey: string;
  telnyxPublicKey: string;
  telnyxConnectionId: string;
}> {
  const res = await request.get(`${API_BASE}/settings`);
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`GET settings failed: ${res.status()} ${text}`);
  }
  const data = (await res.json()) as {
    dialInEnabled: boolean;
    dialInPhoneNumber: string;
    dialInConsentPrompt: string;
    telnyxApiKey: string;
    telnyxPublicKey: string;
    telnyxConnectionId: string;
  };
  return data;
}

export type FakeCallControlCommand = {
  type: string;
  callControlId: string;
  opts?: { payload?: string; [key: string]: unknown };
  at: number;
};

export type DialInLegSnapshot = {
  callControlId: string;
  from: string;
  to: string;
  pinAttempts: number;
  status: string;
  participantId?: string;
  dialInId?: string;
  sessionId?: string;
  displayName?: string;
};

export function telnyxWebhook(
  eventType: string,
  payload: Record<string, unknown>,
): {
  data: {
    record_type: string;
    event_type: string;
    id: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  };
} {
  return {
    data: {
      record_type: 'event',
      event_type: eventType,
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      occurred_at: new Date().toISOString(),
      payload,
    },
  };
}

export async function resetDialInIvr(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API_BASE}/call/dial-in/fake/ivr/reset`);
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`IVR reset failed: ${res.status()} ${text}`);
  }
}

export async function postDialInWebhook(
  request: APIRequestContext,
  body: ReturnType<typeof telnyxWebhook>,
): Promise<void> {
  const res = await request.post(`${API_BASE}/call/dial-in/webhook`, { data: body });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Dial-in webhook failed: ${res.status()} ${text}`);
  }
}

export async function getFakeCallControl(
  request: APIRequestContext,
): Promise<{ commands: FakeCallControlCommand[]; legs: DialInLegSnapshot[] }> {
  const res = await request.get(`${API_BASE}/call/dial-in/fake/call-control`);
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Call control inspect failed: ${res.status()} ${text}`);
  }
  return (await res.json()) as {
    commands: FakeCallControlCommand[];
    legs: DialInLegSnapshot[];
  };
}

export async function getDialInLeg(
  request: APIRequestContext,
  callControlId: string,
): Promise<DialInLegSnapshot> {
  const res = await request.get(
    `${API_BASE}/call/dial-in/fake/legs/${encodeURIComponent(callControlId)}`,
  );
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Leg lookup failed: ${res.status()} ${text}`);
  }
  const body = (await res.json()) as { leg: DialInLegSnapshot };
  return body.leg;
}

/** Simulate inbound call → answer → gather → DTMF digits. */
export async function ivrDialAndEnterCode(
  request: APIRequestContext,
  opts: {
    callControlId: string;
    joinCode: string;
    from?: string;
    to?: string;
  },
): Promise<void> {
  const from = opts.from ?? '+15555550100';
  const to = opts.to ?? '+15555550999';
  await postDialInWebhook(
    request,
    telnyxWebhook('call.initiated', {
      call_control_id: opts.callControlId,
      call_leg_id: opts.callControlId,
      call_session_id: `sess_${opts.callControlId}`,
      from,
      to,
      direction: 'incoming',
      state: 'parked',
    }),
  );
  await postDialInWebhook(
    request,
    telnyxWebhook('call.gather.ended', {
      call_control_id: opts.callControlId,
      call_leg_id: opts.callControlId,
      call_session_id: `sess_${opts.callControlId}`,
      from,
      to,
      digits: opts.joinCode,
      status: 'valid',
    }),
  );
}

export async function readJoinCodeFromHost(page: Page): Promise<string> {
  const el = page.getByTestId('call-join-code-value');
  await el.waitFor({ state: 'visible', timeout: 15000 });
  const code = (await el.textContent())?.trim() ?? '';
  if (!/^\d{4}$/.test(code)) throw new Error(`Invalid join code on host UI: ${code}`);
  return code;
}

export function expectPhoneSegmentFiles(
  podcastId: string,
  episodeId: string,
  segmentId: string,
  minPhoneTracks: number,
): { phoneTracks: number; totalTracks: number; manifestPath: string } {
  const recordingsBase = join(DATA_DIR, 'uploads', podcastId, episodeId, 'recordings');
  const mtDir = findMtDir(recordingsBase, segmentId);
  if (!mtDir) throw new Error(`No multitrack dir for segment ${segmentId}`);
  const manifestPath = join(mtDir, 'tracks_manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`Missing tracks_manifest.json in ${mtDir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    segments?: Array<{ source?: string; participantId?: string | null }>;
  };
  const segs = Array.isArray(manifest.segments) ? manifest.segments : [];
  const phoneTracks = segs.filter((s) => s.source === 'phone').length;
  if (phoneTracks < minPhoneTracks) {
    throw new Error(
      `Expected >= ${minPhoneTracks} phone tracks, got ${phoneTracks}. segments=${JSON.stringify(segs)}`,
    );
  }
  const files = readdirSync(mtDir);
  const mp3Files = files.filter((f) => f.startsWith('segment_') && f.endsWith('.mp3'));
  if (mp3Files.length < minPhoneTracks) {
    throw new Error(`Expected >= ${minPhoneTracks} mp3 segment files, got ${mp3Files.length}`);
  }
  return { phoneTracks, totalTracks: segs.length, manifestPath };
}
