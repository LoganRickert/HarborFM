import { api, apiGet, apiPatch } from './client';

export interface AppSettings {
  whisper_asr_url: string;
  transcription_provider: 'none' | 'self_hosted' | 'openai';
  openai_transcription_url: string;
  openai_transcription_api_key: string;
  transcription_model: string;
  default_can_transcribe: boolean;
  llm_provider: 'none' | 'ollama' | 'openai';
  ollama_url: string;
  openai_api_key: string;
  model: string;
  registration_enabled: boolean;
  public_feeds_enabled: boolean;
  websub_discovery_enabled: boolean;
  hostname: string;
  websub_hub: string;
  final_bitrate_kbps: number;
  final_channels: 'mono' | 'stereo';
  final_format: 'mp3' | 'm4a';
  maxmind_account_id: string;
  maxmind_license_key: string;
  default_max_podcasts: number | null;
  default_storage_mb: number | null;
  default_max_episodes: number | null;
  default_max_collaborators: number | null;
  default_max_subscriber_tokens: number | null;
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
  email_enable_registration_verification: boolean;
  email_enable_welcome_after_verify: boolean;
  email_enable_password_reset: boolean;
  email_enable_admin_welcome: boolean;
  email_enable_new_show: boolean;
  email_enable_invite: boolean;
  email_enable_contact: boolean;
  welcome_banner: string;
  custom_terms: string;
  custom_privacy: string;
  dns_provider: 'none' | 'cloudflare';
  /** Client-only: user input for API token; server returns dns_provider_api_token_set instead. */
  dns_provider_api_token?: string;
  dns_provider_api_token_set?: boolean;
  dns_use_cname: boolean;
  dns_a_record_ip: string;
  dns_allow_linking_domain: boolean;
  dns_default_allow_domain: boolean;
  dns_default_allow_domains: string;
  dns_default_allow_custom_key: boolean;
  dns_default_allow_sub_domain: boolean;
  dns_default_domain: string;
  dns_default_enable_cloudflare_proxy: boolean;
}

export function getSettings(): Promise<AppSettings> {
  return apiGet<AppSettings>('/settings');
}

/** Admin only. Returns whether each required command (ffmpeg, ffprobe, audiowaveform, geoipupdate) is present. */
export function getCommands(): Promise<{ commands: Record<string, boolean> }> {
  return apiGet<{ commands: Record<string, boolean> }>('/settings/commands');
}

/** Public endpoint: custom terms/privacy if set. No auth. Used by /terms and /privacy to choose custom vs default. */
export function getPublicLegal(): Promise<{ terms: string | null; privacy: string | null }> {
  return fetch('/api/public/legal', { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error('Failed to load');
    return r.json();
  });
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

export function testTranscriptionOpenAI(payload?: {
  openai_transcription_url?: string;
  openai_transcription_api_key?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/test-transcription-openai', {
    method: 'POST',
    json: payload ?? {},
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

export function geoliteTest(payload: {
  maxmind_account_id: string;
  maxmind_license_key?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/geolite/test', { method: 'POST', json: payload });
}

export function geoliteCheck(): Promise<{ city: boolean; country: boolean }> {
  return apiGet<{ city: boolean; country: boolean }>('/settings/geolite/check');
}

export function geoliteUpdate(payload: {
  maxmind_account_id: string;
  maxmind_license_key?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return api<{ ok: boolean; error?: string }>('/settings/geolite/update', { method: 'POST', json: payload });
}

