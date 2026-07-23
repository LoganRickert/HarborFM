import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface CallStartResponse {
  token: string;
  sessionId: string;
  joinUrl: string;
  joinCode?: string;
  dialInEnabled?: boolean;
  dialInPhoneNumber?: string | null;
  webrtcUrl?: string;
  roomId?: string;
  /** Host token for host-only WebRTC actions (soundboard). Only for host. */
  hostToken?: string;
  /** True when WebRTC was requested but room creation failed (e.g. service down). */
  webrtcUnavailable?: boolean;
}

export type CallMeetingStatus =
  | 'too_early'
  | 'waiting_for_host'
  | 'live'
  | 'ended'
  | 'expired'
  | 'cancelled';

export interface CallJoinInfo {
  podcast: { title: string };
  episode: { id: string; title: string };
  hostName?: string;
  passwordRequired?: boolean;
  artworkUrl?: string | null;
  dialInEnabled?: boolean;
  dialInPhoneNumber?: string | null;
  joinCode?: string;
  meetingStatus?: CallMeetingStatus;
  scheduledStartAt?: string;
  joinOpensAt?: string;
  joinExpiresAt?: string;
  inviteDisplayName?: string | null;
}

export interface CallSessionResponse {
  sessionId: string;
  token: string;
  joinUrl: string;
  joinCode?: string;
  dialInEnabled?: boolean;
  dialInPhoneNumber?: string | null;
  webrtcUrl?: string;
  roomId?: string;
  hostToken?: string;
  webrtcUnavailable?: boolean;
  /** Current participants (host only). */
  participants?: Array<{
    id: string;
    name: string;
    isHost: boolean;
    joinedAt: number;
    muted?: boolean;
    mutedByHost?: boolean;
    disconnected?: boolean;
  }>;
  /** Segment IDs being processed (recording stopped, not yet added). Host only. */
  pendingSegmentIds?: string[];
  /** True when recording is actively in progress (host has started, not yet stopped). */
  recordingInProgress?: boolean;
}

export interface CallMeetingInvite {
  id: string;
  email: string | null;
  displayName: string | null;
  inviteToken: string;
  joinUrl: string;
  createdAt: string;
  lastSentAt: string | null;
  emailSent?: boolean;
  emailError?: string;
}

export interface CallMeeting {
  id: string;
  episodeId: string;
  podcastId: string;
  createdByUserId: string;
  scheduledStartAt: string;
  token: string;
  joinCode: string;
  status: string;
  liveSessionId: string | null;
  joinUrl: string;
  joinOpensAt: string;
  joinExpiresAt: string;
  withinJoinWindow: boolean;
  invites: CallMeetingInvite[];
  dialInEnabled?: boolean;
  dialInPhoneNumber?: string | null;
}

export interface CallMeetingResponse {
  meeting: CallMeeting | null;
  activeMeetingCountForCreator: number;
  maxActiveMeetingsPerUser: number;
  atMeetingCap: boolean;
}

export function startCall(episodeId: string, password?: string | null): Promise<CallStartResponse> {
  return apiPost<CallStartResponse>('/call/start', { episodeId, password: password ?? undefined });
}

export function getJoinInfo(token: string, inviteToken?: string | null): Promise<CallJoinInfo> {
  const q = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : '';
  return apiGet<CallJoinInfo>(`/call/join-info/${encodeURIComponent(token)}${q}`);
}

export function getActiveSession(episodeId: string): Promise<CallSessionResponse | null> {
  return apiGet<CallSessionResponse | null>(`/call/session?episodeId=${encodeURIComponent(episodeId)}`);
}

export interface CallByCodeResponse {
  token: string;
  /** True when the requester is the host and already in the call. */
  alreadyConnected?: boolean;
  /** Episode ID when alreadyConnected, for redirect. */
  episodeId?: string;
}

export function getCallByCode(code: string): Promise<CallByCodeResponse> {
  return apiGet<CallByCodeResponse>(`/call/by-code/${encodeURIComponent(code)}`);
}

export function callWebSocketUrl(): string {
  if (typeof window === 'undefined') return '';
  const { hostname, port, protocol, host } = window.location;
  // Vite dev server (5173): WS proxy is flaky; connect straight to the API port.
  const isViteDev = import.meta.env.DEV && port === '5173';
  if (isViteDev) {
    const apiPort = import.meta.env.VITE_API_PORT || '3001';
    return `ws://${hostname}:${apiPort}/api/call/ws`;
  }
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/api/call/ws`;
}

export function getEpisodeMeeting(episodeId: string): Promise<CallMeetingResponse> {
  return apiGet<CallMeetingResponse>(`/call/meetings?episodeId=${encodeURIComponent(episodeId)}`);
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function createEpisodeMeeting(
  episodeId: string,
  scheduledStartAt: string,
): Promise<{ meeting: CallMeeting }> {
  return apiPost<{ meeting: CallMeeting }>('/call/meetings', {
    episodeId,
    scheduledStartAt,
    timeZone: browserTimeZone(),
  });
}

export function rescheduleEpisodeMeeting(
  meetingId: string,
  scheduledStartAt: string,
): Promise<{ meeting: CallMeeting }> {
  return apiPatch<{ meeting: CallMeeting }>(`/call/meetings/${encodeURIComponent(meetingId)}`, {
    scheduledStartAt,
    timeZone: browserTimeZone(),
  });
}

export function cancelEpisodeMeeting(meetingId: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/call/meetings/${encodeURIComponent(meetingId)}/cancel`, {});
}

export function startEpisodeMeeting(meetingId: string): Promise<CallStartResponse> {
  return apiPost<CallStartResponse>(`/call/meetings/${encodeURIComponent(meetingId)}/start`, {});
}

export function createMeetingInvite(
  meetingId: string,
  body: { name?: string | null; email?: string | null },
): Promise<{
  joinUrl: string;
  invite: CallMeetingInvite | null;
}> {
  return apiPost(`/call/meetings/${encodeURIComponent(meetingId)}/invites`, {
    ...body,
    timeZone: browserTimeZone(),
  });
}

export function deleteMeetingInvite(meetingId: string, inviteId: string): Promise<void> {
  return apiDelete(`/call/meetings/${encodeURIComponent(meetingId)}/invites/${encodeURIComponent(inviteId)}`);
}
