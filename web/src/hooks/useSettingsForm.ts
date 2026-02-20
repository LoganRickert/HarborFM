import { useState, useEffect, useCallback } from 'react';
import type { SettingsResponse } from '@harborfm/shared';

const OLLAMA_DEFAULT_MODEL = 'llama3.2:latest';
const OPENAI_DEFAULT_MODEL = 'gpt-5-mini';

const DEFAULT_FORM_STATE: SettingsResponse = {
  whisperAsrUrl: 'http://whisper:9000',
  transcriptionProvider: 'none',
  openaiTranscriptionUrl: 'https://api.openai.com/v1/audio/transcriptions',
  openaiTranscriptionApiKey: '',
  transcriptionModel: 'whisper-1',
  defaultCanTranscribe: true,
  defaultCanGenerateVideo: true,
  llmProvider: 'none',
  ollamaUrl: 'http://localhost:11434',
  openaiApiKey: '',
  model: OLLAMA_DEFAULT_MODEL,
  registrationEnabled: true,
  publicFeedsEnabled: true,
  websubDiscoveryEnabled: false,
  hostname: '',
  websubHub: '',
  finalBitrateKbps: 128,
  finalChannels: 'mono',
  finalFormat: 'mp3',
  maxmindAccountId: '',
  maxmindLicenseKey: '',
  defaultMaxPodcasts: null,
  defaultStorageMb: null,
  defaultMaxEpisodes: null,
  defaultMaxCollaborators: null,
  defaultMaxSubscriberTokens: null,
  captchaProvider: 'none',
  captchaSiteKey: '',
  captchaSecretKey: '',
  emailProvider: 'none',
  emailWebhookUrl: '',
  emailWebhookFieldKey: 'content',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  sendgridApiKey: '',
  sendgridFrom: '',
  emailEnableRegistrationVerification: true,
  emailEnableWelcomeAfterVerify: true,
  emailEnablePasswordReset: true,
  emailEnableAdminWelcome: true,
  emailEnableNewShow: true,
  emailEnableInvite: true,
  emailEnableContact: true,
  welcomeBanner: '',
  customTerms: '',
  customPrivacy: '',
  dnsProvider: 'none',
  dnsUseCname: true,
  dnsARecordIp: '',
  dnsAllowLinkingDomain: false,
  dnsDefaultAllowDomain: false,
  dnsDefaultAllowDomains: '[]',
  dnsDefaultAllowCustomKey: false,
  dnsDefaultAllowSubDomain: false,
  dnsDefaultDomain: '',
  dnsDefaultEnableCloudflareProxy: false,
  gdprConsentBannerEnabled: false,
  webrtcServiceUrl: '',
  webrtcPublicWsUrl: '',
  recordingCallbackSecret: '',
  twoFactorEnabled: false,
  twoFactorMethods: 'totp',
  twoFactorEnforced: false,
  emailSigninDisabled: false,
  ssoOidcProviders: [],
  ssoSamlProviders: [],
};

export function useSettingsForm(initialSettings?: SettingsResponse) {
  const [form, setForm] = useState<SettingsResponse>(DEFAULT_FORM_STATE);

  // Sync with fetched settings
  useEffect(() => {
    if (initialSettings) {
      setForm(initialSettings);
    }
  }, [initialSettings]);

  // Generic change handler
  const updateForm = useCallback((updates: Partial<SettingsResponse>) => {
    setForm((f: SettingsResponse) => ({ ...f, ...updates }));
  }, []);

  return { form, updateForm, setForm };
}

export { OLLAMA_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL };
