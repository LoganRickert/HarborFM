import { apiGet, apiPost } from './client';

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

export interface CallJoinInfo {
  podcast: { title: string };
  episode: { id: string; title: string };
  hostName?: string;
  passwordRequired?: boolean;
  artworkUrl?: string | null;
  dialInEnabled?: boolean;
  dialInPhoneNumber?: string | null;
  joinCode?: string;
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

export function startCall(episodeId: string, password?: string | null): Promise<CallStartResponse> {
  return apiPost<CallStartResponse>('/call/start', { episodeId, password: password ?? undefined });
}

export function getJoinInfo(token: string): Promise<CallJoinInfo> {
  return apiGet<CallJoinInfo>(`/call/join-info/${encodeURIComponent(token)}`);
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
