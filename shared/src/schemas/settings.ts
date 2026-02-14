import { z } from 'zod';

const optionalLimitField = z.preprocess(
  (v) => (v === '' || v == null ? undefined : v),
  z.number().int().min(0).nullable().optional()
);

/** Body for PATCH /api/settings. All fields optional. */
export const settingsPatchBodySchema = z.object({
  whisper_asr_url: z.string().optional(),
  transcription_provider: z.enum(['none', 'self_hosted', 'openai']).optional(),
  openai_transcription_url: z.string().optional(),
  openai_transcription_api_key: z.string().optional(),
  transcription_model: z.string().optional(),
  default_can_transcribe: z.boolean().optional(),
  llm_provider: z.enum(['none', 'ollama', 'openai']).optional(),
  ollama_url: z.string().optional(),
  openai_api_key: z.string().optional(),
  model: z.string().optional(),
  registration_enabled: z.boolean().optional(),
  public_feeds_enabled: z.boolean().optional(),
  websub_discovery_enabled: z.boolean().optional(),
  hostname: z.string().optional(),
  websub_hub: z.string().optional(),
  final_bitrate_kbps: z.coerce.number().int().min(16).max(320).optional(),
  final_channels: z.enum(['mono', 'stereo']).optional(),
  final_format: z.enum(['mp3', 'm4a']).optional(),
  maxmind_account_id: z.string().optional(),
  maxmind_license_key: z.string().optional(),
  default_max_podcasts: optionalLimitField,
  default_storage_mb: optionalLimitField,
  default_max_episodes: optionalLimitField,
  default_max_collaborators: optionalLimitField,
  default_max_subscriber_tokens: optionalLimitField,
  captcha_provider: z.enum(['none', 'recaptcha_v2', 'recaptcha_v3', 'hcaptcha']).optional(),
  captcha_site_key: z.string().optional(),
  captcha_secret_key: z.string().optional(),
  email_provider: z.enum(['none', 'smtp', 'sendgrid']).optional(),
  smtp_host: z.string().optional(),
  smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
  smtp_secure: z.boolean().optional(),
  smtp_user: z.string().optional(),
  smtp_password: z.string().optional(),
  smtp_from: z.string().optional(),
  sendgrid_api_key: z.string().optional(),
  sendgrid_from: z.string().optional(),
  email_enable_registration_verification: z.boolean().optional(),
  email_enable_welcome_after_verify: z.boolean().optional(),
  email_enable_password_reset: z.boolean().optional(),
  email_enable_admin_welcome: z.boolean().optional(),
  email_enable_new_show: z.boolean().optional(),
  email_enable_invite: z.boolean().optional(),
  email_enable_contact: z.boolean().optional(),
  welcome_banner: z.string().optional(),
  custom_terms: z.string().optional(),
  custom_privacy: z.string().optional(),
  // DNS configuration
  dns_provider: z.enum(['none', 'cloudflare']).optional(),
  dns_provider_api_token: z.string().optional(),
  dns_use_cname: z.boolean().optional(),
  dns_a_record_ip: z.string().optional(),
  dns_allow_linking_domain: z.boolean().optional(),
  dns_default_allow_domain: z.boolean().optional(),
  dns_default_allow_domains: z.array(z.string()).optional(),
  dns_default_allow_custom_key: z.boolean().optional(),
  dns_default_allow_sub_domain: z.boolean().optional(),
  dns_default_domain: z.string().optional(),
  dns_default_enable_cloudflare_proxy: z.boolean().optional(),
  gdpr_consent_banner_enabled: z.boolean().optional(),
  // WebRTC group call
  webrtc_service_url: z.string().optional(),
  webrtc_public_ws_url: z.string().optional(),
  recording_callback_secret: z.string().optional(),
});

export type SettingsPatchBody = z.infer<typeof settingsPatchBodySchema>;

/** Body for POST /api/settings/test-llm. All fields optional; server falls back to saved settings. */
export const settingsTestLlmBodySchema = z.object({
  llm_provider: z.enum(['none', 'ollama', 'openai']).optional(),
  ollama_url: z.string().optional(),
  openai_api_key: z.string().optional(),
});

/** Body for POST /api/settings/test-whisper. Optional; server falls back to saved settings. */
export const settingsTestWhisperBodySchema = z.object({
  whisper_asr_url: z.string().optional(),
});

/** Body for POST /api/settings/test-transcription-openai. Optional; server falls back to saved settings. */
export const settingsTestTranscriptionOpenaiBodySchema = z.object({
  openai_transcription_url: z.string().optional(),
  openai_transcription_api_key: z.string().optional(),
});

/** Body for POST /api/settings/test-smtp. All fields optional; server falls back to saved settings. */
export const settingsTestSmtpBodySchema = z.object({
  smtp_host: z.string().optional(),
  smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
  smtp_secure: z.boolean().optional(),
  smtp_user: z.string().optional(),
  smtp_password: z.string().optional(),
});

/** Body for POST /api/settings/test-sendgrid. Optional; server falls back to saved settings. */
export const settingsTestSendgridBodySchema = z.object({
  sendgrid_api_key: z.string().optional(),
});

/** Body for POST /api/settings/geolite/test and geolite/update. Both optional; server falls back to saved. */
export const settingsGeoliteTestBodySchema = z.object({
  maxmind_account_id: z.string().optional(),
  maxmind_license_key: z.string().optional(),
});

export type SettingsTestLlmBody = z.infer<typeof settingsTestLlmBodySchema>;
export type SettingsTestWhisperBody = z.infer<typeof settingsTestWhisperBodySchema>;
export type SettingsTestTranscriptionOpenaiBody = z.infer<typeof settingsTestTranscriptionOpenaiBodySchema>;
export type SettingsTestSmtpBody = z.infer<typeof settingsTestSmtpBodySchema>;
export type SettingsTestSendgridBody = z.infer<typeof settingsTestSendgridBodySchema>;
export type SettingsGeoliteTestBody = z.infer<typeof settingsGeoliteTestBodySchema>;
