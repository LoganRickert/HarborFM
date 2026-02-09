import { api, apiGet, apiPatch } from './client';

export interface AppSettings {
  whisper_asr_url: string;
  llm_provider: 'none' | 'ollama' | 'openai';
  ollama_url: string;
  openai_api_key: string;
  model: string;
  registration_enabled: boolean;
  public_feeds_enabled: boolean;
  hostname: string;
  final_bitrate_kbps: number;
  final_channels: 'mono' | 'stereo';
  final_format: 'mp3' | 'm4a';
  maxmind_account_id: string;
  maxmind_license_key: string;
}

export function getSettings(): Promise<AppSettings> {
  return apiGet<AppSettings>('/settings');
}

export function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return apiPatch<AppSettings>('/settings', settings);
}

export function testLlmConnection(settings: {
  llm_provider: 'ollama' | 'openai';
  ollama_url?: string;
  openai_api_key?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-llm', {
    method: 'POST',
    json: settings,
  });
}

