import type { SettingsResponse } from '@harborfm/shared';
import { api, apiGet, apiPatch } from './client';

/** Raw GET /settings response (server sends snake_case). */
interface RawSettings {
  whisper_asr_url?: string;
  transcription_provider?: 'none' | 'self_hosted' | 'openai';
  openai_transcription_url?: string;
  openai_transcription_api_key?: string;
  transcription_model?: string;
  default_can_transcribe?: boolean;
  llm_provider?: 'none' | 'ollama' | 'openai';
  ollama_url?: string;
  openai_api_key?: string;
  model?: string;
  registration_enabled?: boolean;
  public_feeds_enabled?: boolean;
  websub_discovery_enabled?: boolean;
  hostname?: string;
  websub_hub?: string;
  final_bitrate_kbps?: number;
  final_channels?: 'mono' | 'stereo';
  final_format?: 'mp3' | 'm4a';
  maxmind_account_id?: string;
  maxmind_license_key?: string;
  default_max_podcasts?: number | null;
  default_storage_mb?: number | null;
  default_max_episodes?: number | null;
  default_max_collaborators?: number | null;
  default_max_subscriber_tokens?: number | null;
  captcha_provider?: 'none' | 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';
  captcha_site_key?: string;
  captcha_secret_key?: string;
  email_provider?: 'none' | 'smtp' | 'sendgrid' | 'webhook';
  email_webhook_url?: string;
  email_webhook_field_key?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_password?: string;
  smtp_from?: string;
  sendgrid_api_key?: string;
  sendgrid_from?: string;
  email_enable_registration_verification?: boolean;
  email_enable_welcome_after_verify?: boolean;
  email_enable_password_reset?: boolean;
  email_enable_admin_welcome?: boolean;
  email_enable_new_show?: boolean;
  email_enable_invite?: boolean;
  email_enable_contact?: boolean;
  welcome_banner?: string;
  custom_terms?: string;
  custom_privacy?: string;
  dns_provider?: 'none' | 'cloudflare';
  dns_provider_api_token?: string;
  dns_provider_api_token_set?: boolean;
  dns_use_cname?: boolean;
  dns_a_record_ip?: string;
  dns_allow_linking_domain?: boolean;
  dns_default_allow_domain?: boolean;
  dns_default_allow_domains?: string;
  dns_default_allow_custom_key?: boolean;
  dns_default_allow_sub_domain?: boolean;
  dns_default_domain?: string;
  dns_default_enable_cloudflare_proxy?: boolean;
  gdpr_consent_banner_enabled?: boolean;
  webrtc_service_url?: string;
  webrtc_public_ws_url?: string;
  recording_callback_secret?: string;
  two_factor_enabled?: boolean;
  two_factor_methods?: string;
  two_factor_enforced?: boolean;
  sso_oidc_providers?: Array<Record<string, unknown>>;
  sso_saml_providers?: Array<Record<string, unknown>>;
}

function snakeToCamelSettings(raw: RawSettings): SettingsResponse {
  return {
    whisperAsrUrl: raw.whisper_asr_url ?? '',
    transcriptionProvider: raw.transcription_provider ?? 'none',
    openaiTranscriptionUrl: raw.openai_transcription_url ?? '',
    openaiTranscriptionApiKey: raw.openai_transcription_api_key ?? '',
    transcriptionModel: raw.transcription_model ?? '',
    defaultCanTranscribe: raw.default_can_transcribe ?? false,
    llmProvider: raw.llm_provider ?? 'none',
    ollamaUrl: raw.ollama_url ?? '',
    openaiApiKey: raw.openai_api_key ?? '',
    model: raw.model ?? '',
    registrationEnabled: raw.registration_enabled ?? false,
    publicFeedsEnabled: raw.public_feeds_enabled ?? false,
    websubDiscoveryEnabled: raw.websub_discovery_enabled ?? false,
    hostname: raw.hostname ?? '',
    websubHub: raw.websub_hub ?? '',
    finalBitrateKbps: raw.final_bitrate_kbps ?? 128,
    finalChannels: (raw.final_channels as 'mono' | 'stereo') ?? 'stereo',
    finalFormat: (raw.final_format as 'mp3' | 'm4a') ?? 'mp3',
    maxmindAccountId: raw.maxmind_account_id ?? '',
    maxmindLicenseKey: raw.maxmind_license_key ?? '',
    defaultMaxPodcasts: raw.default_max_podcasts ?? null,
    defaultStorageMb: raw.default_storage_mb ?? null,
    defaultMaxEpisodes: raw.default_max_episodes ?? null,
    defaultMaxCollaborators: raw.default_max_collaborators ?? null,
    defaultMaxSubscriberTokens: raw.default_max_subscriber_tokens ?? null,
    captchaProvider: raw.captcha_provider ?? 'none',
    captchaSiteKey: raw.captcha_site_key ?? '',
    captchaSecretKey: raw.captcha_secret_key ?? '',
    emailProvider: raw.email_provider ?? 'none',
    emailWebhookUrl: raw.email_webhook_url ?? '',
    emailWebhookFieldKey: raw.email_webhook_field_key ?? '',
    smtpHost: raw.smtp_host ?? '',
    smtpPort: raw.smtp_port ?? 587,
    smtpSecure: raw.smtp_secure ?? false,
    smtpUser: raw.smtp_user ?? '',
    smtpPassword: raw.smtp_password ?? '',
    smtpFrom: raw.smtp_from ?? '',
    sendgridApiKey: raw.sendgrid_api_key ?? '',
    sendgridFrom: raw.sendgrid_from ?? '',
    emailEnableRegistrationVerification: raw.email_enable_registration_verification ?? false,
    emailEnableWelcomeAfterVerify: raw.email_enable_welcome_after_verify ?? false,
    emailEnablePasswordReset: raw.email_enable_password_reset ?? false,
    emailEnableAdminWelcome: raw.email_enable_admin_welcome ?? false,
    emailEnableNewShow: raw.email_enable_new_show ?? false,
    emailEnableInvite: raw.email_enable_invite ?? false,
    emailEnableContact: raw.email_enable_contact ?? false,
    welcomeBanner: raw.welcome_banner ?? '',
    customTerms: raw.custom_terms ?? '',
    customPrivacy: raw.custom_privacy ?? '',
    dnsProvider: raw.dns_provider ?? 'none',
    dnsProviderApiToken: raw.dns_provider_api_token,
    dnsProviderApiTokenSet: raw.dns_provider_api_token_set,
    dnsUseCname: raw.dns_use_cname ?? false,
    dnsARecordIp: raw.dns_a_record_ip ?? '',
    dnsAllowLinkingDomain: raw.dns_allow_linking_domain ?? false,
    dnsDefaultAllowDomain: raw.dns_default_allow_domain ?? false,
    dnsDefaultAllowDomains: raw.dns_default_allow_domains ?? '',
    dnsDefaultAllowCustomKey: raw.dns_default_allow_custom_key ?? false,
    dnsDefaultAllowSubDomain: raw.dns_default_allow_sub_domain ?? false,
    dnsDefaultDomain: raw.dns_default_domain ?? '',
    dnsDefaultEnableCloudflareProxy: raw.dns_default_enable_cloudflare_proxy ?? false,
    gdprConsentBannerEnabled: raw.gdpr_consent_banner_enabled ?? false,
    webrtcServiceUrl: raw.webrtc_service_url ?? '',
    webrtcPublicWsUrl: raw.webrtc_public_ws_url ?? '',
    recordingCallbackSecret: raw.recording_callback_secret ?? '',
    twoFactorEnabled: raw.two_factor_enabled ?? false,
    twoFactorMethods: raw.two_factor_methods ?? '',
    twoFactorEnforced: raw.two_factor_enforced ?? false,
    ssoOidcProviders: raw.sso_oidc_providers,
    ssoSamlProviders: raw.sso_saml_providers,
  };
}

export type { SettingsResponse as AppSettings };

export function getSettings(): Promise<SettingsResponse> {
  return apiGet<RawSettings>('/settings').then(snakeToCamelSettings);
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

export function updateSettings(settings: Partial<SettingsResponse>): Promise<SettingsResponse> {
  return apiPatch<RawSettings>('/settings', settings as Record<string, unknown>).then(snakeToCamelSettings);
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
