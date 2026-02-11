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
  default_max_podcasts: number | null;
  default_storage_mb: number | null;
  default_max_episodes: number | null;
  default_max_collaborators: number | null;
  captcha_provider: 'none' | 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';
  captcha_site_key: string;
  captcha_secret_key: string;
  email_provider: 'none' | 'smtp' | 'sendgrid';
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
  sendgrid_api_key: string;
  sendgrid_from: string;
  welcome_banner: string;
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

export function testWhisperConnection(whisper_asr_url: string): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-whisper', {
    method: 'POST',
    json: { whisper_asr_url: whisper_asr_url.trim().replace(/\/+$/, '') },
  });
}

export function testSmtpConnection(settings: {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-smtp', {
    method: 'POST',
    json: settings,
  });
}

export function testSendGridConnection(settings: { sendgrid_api_key: string }): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-sendgrid', {
    method: 'POST',
    json: settings,
  });
}

