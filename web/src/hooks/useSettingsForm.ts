import { useState, useEffect, useCallback } from 'react';
import { AppSettings } from '../api/settings';

const OLLAMA_DEFAULT_MODEL = 'llama3.2:latest';
const OPENAI_DEFAULT_MODEL = 'gpt-5-mini';

const DEFAULT_FORM_STATE: AppSettings = {
  whisper_asr_url: 'http://whisper:9000',
  transcription_provider: 'none',
  openai_transcription_url: 'https://api.openai.com/v1/audio/transcriptions',
  openai_transcription_api_key: '',
  transcription_model: 'whisper-1',
  default_can_transcribe: true,
  llm_provider: 'none',
  ollama_url: 'http://localhost:11434',
  openai_api_key: '',
  model: OLLAMA_DEFAULT_MODEL,
  registration_enabled: true,
  public_feeds_enabled: true,
  websub_discovery_enabled: false,
  hostname: '',
  websub_hub: '',
  final_bitrate_kbps: 128,
  final_channels: 'mono',
  final_format: 'mp3',
  maxmind_account_id: '',
  maxmind_license_key: '',
  default_max_podcasts: null,
  default_storage_mb: null,
  default_max_episodes: null,
  default_max_collaborators: null,
  default_max_subscriber_tokens: null,
  captcha_provider: 'none',
  captcha_site_key: '',
  captcha_secret_key: '',
  email_provider: 'none',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: true,
  smtp_user: '',
  smtp_password: '',
  smtp_from: '',
  sendgrid_api_key: '',
  sendgrid_from: '',
  email_enable_registration_verification: true,
  email_enable_welcome_after_verify: true,
  email_enable_password_reset: true,
  email_enable_admin_welcome: true,
  email_enable_new_show: true,
  email_enable_invite: true,
  email_enable_contact: true,
  welcome_banner: '',
  custom_terms: '',
  custom_privacy: '',
  dns_provider: 'none',
  dns_use_cname: true,
  dns_a_record_ip: '',
  dns_allow_linking_domain: false,
  dns_default_allow_domain: false,
  dns_default_allow_domains: '[]',
  dns_default_allow_custom_key: false,
  dns_default_allow_sub_domain: false,
  dns_default_domain: '',
  dns_default_enable_cloudflare_proxy: false,
};

export function useSettingsForm(initialSettings?: AppSettings) {
  const [form, setForm] = useState<AppSettings>(DEFAULT_FORM_STATE);

  // Sync with fetched settings
  useEffect(() => {
    if (initialSettings) {
      setForm(initialSettings);
    }
  }, [initialSettings]);

  // Generic change handler
  const updateForm = useCallback((updates: Partial<AppSettings>) => {
    setForm((f) => ({ ...f, ...updates }));
  }, []);

  return { form, updateForm, setForm };
}

export { OLLAMA_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL };
