import type { SettingsResponse } from '@harborfm/shared';
import { api, apiGet, apiPatch } from './client';

export type { SettingsResponse as AppSettings };

/** PATCH payload: like Partial<SettingsResponse> but dnsDefaultAllowDomains is string[] (server accepts array). */
export type SettingsUpdatePayload = Omit<Partial<SettingsResponse>, 'dnsDefaultAllowDomains'> & {
  dnsDefaultAllowDomains?: string[];
};

export function getSettings(): Promise<SettingsResponse> {
  return apiGet<SettingsResponse>('/settings');
}

/** Admin only. Returns whether each required command (ffmpeg, ffprobe, audiowaveform, geoipupdate) is present. */
export function getCommands(): Promise<{ commands: Record<string, boolean> }> {
  return apiGet<{ commands: Record<string, boolean> }>('/settings/commands');
}

export interface SystemStatsResponse {
  memory: { usedBytes: number; totalBytes: number };
  cpus: number;
  disk?: { usedBytes: number; totalBytes: number };
}

/** Admin only. Returns system resource usage (memory, CPU count, optional disk for data dir). */
export function getSystemStats(): Promise<SystemStatsResponse> {
  return apiGet<SystemStatsResponse>('/settings/system-stats');
}

/** Public endpoint: custom terms/privacy if set. No auth. Used by /terms and /privacy to choose custom vs default. */
export function getPublicLegal(): Promise<{ terms: string | null; privacy: string | null }> {
  return fetch('/api/public/legal', { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error('Failed to load');
    return r.json();
  });
}

export function updateSettings(settings: SettingsUpdatePayload): Promise<SettingsResponse> {
  return apiPatch<SettingsResponse>('/settings', settings as Record<string, unknown>);
}

export function testLlmConnection(settings: {
  llmProvider: 'ollama' | 'openai';
  ollamaUrl?: string;
  openaiApiKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-llm', {
    method: 'POST',
    json: settings,
  });
}

export function testWhisperConnection(whisperAsrUrl: string): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-whisper', {
    method: 'POST',
    json: { whisperAsrUrl: whisperAsrUrl.trim().replace(/\/+$/, '') },
  });
}

export function testTranscriptionOpenAI(payload?: {
  openaiTranscriptionUrl?: string;
  openaiTranscriptionApiKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-transcription-openai', {
    method: 'POST',
    json: payload ?? {},
  });
}

export function testSmtpConnection(settings: {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-smtp', {
    method: 'POST',
    json: settings,
  });
}

export function testSendGridConnection(settings: { sendgridApiKey: string }): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-sendgrid', {
    method: 'POST',
    json: settings,
  });
}

export function geoliteTest(payload: {
  maxmindAccountId: string;
  maxmindLicenseKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/geolite/test', { method: 'POST', json: payload });
}

export function geoliteCheck(): Promise<{ city: boolean; country: boolean }> {
  return apiGet<{ city: boolean; country: boolean }>('/settings/geolite/check');
}

export function geoliteUpdate(payload: {
  maxmindAccountId: string;
  maxmindLicenseKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/geolite/update', { method: 'POST', json: payload });
}
