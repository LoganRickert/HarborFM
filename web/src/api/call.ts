import { apiGet, apiPost } from './client';

export interface CallStartResponse {
  token: string;
  sessionId: string;
  joinUrl: string;
  joinCode?: string;
  webrtcUrl?: string;
  roomId?: string;
  /** True when WebRTC was requested but room creation failed (e.g. service down). */
  webrtcUnavailable?: boolean;
}

export interface CallJoinInfo {
  podcast: { title: string };
  episode: { id: string; title: string };
  hostName?: string;
  passwordRequired?: boolean;
  artworkUrl?: string | null;
}

export interface CallSessionResponse {
  sessionId: string;
  token: string;
  joinUrl: string;
  joinCode?: string;
  webrtcUrl?: string;
  roomId?: string;
  webrtcUnavailable?: boolean;
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
}

export function getCallByCode(code: string): Promise<CallByCodeResponse> {
  return apiGet<CallByCodeResponse>(`/call/by-code/${encodeURIComponent(code)}`);
}

export function callWebSocketUrl(): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/call/ws`;
}
