import { z } from 'zod';

const optionalLimitField = z.preprocess(
  (v) => (v === '' || v == null ? undefined : v),
  z.number().int().min(0).nullable().optional()
);

/** Coerce null/undefined to empty string so omitted keys still parse as string. */
const stringOrEmpty = z.preprocess((v) => (v == null ? '' : v), z.string());

/** OIDC provider config for SSO settings. */
const ssoOidcProviderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    discoveryUrl: z.string().optional(),
    issuer: z.string().optional(),
    authorizationEndpoint: z.string().optional(),
    tokenEndpoint: z.string().optional(),
    userinfoEndpoint: z.string().optional(),
    clientId: stringOrEmpty,
    clientSecret: z.string().optional(),
    scopes: z.string().optional(),
    trustEmail: z.boolean().optional(),
    /** Simple Icons slug for button (e.g. google, microsoft, keycloak). See simpleicons.org */
    iconSlug: z.string().optional(),
    /** Background color for login button (hex, rgb, or CSS color) */
    buttonBgColor: z.string().optional(),
    /** Text color for login button (hex, rgb, or CSS color) */
    buttonTextColor: z.string().optional(),
  })
  .passthrough();

/** SAML provider config for SSO settings. */
const ssoSamlProviderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    entryPoint: z.string(),
    issuer: stringOrEmpty,
    callbackUrl: stringOrEmpty,
    cert: stringOrEmpty,
    idpCert: z.string(),
    subjectAttribute: stringOrEmpty,
    emailAttribute: stringOrEmpty,
    trustEmail: z.boolean().optional(),
    /** When true, require the IdP to sign the assertion (validate with IdP cert). Default false for compatibility. */
    wantAssertionsSigned: z.boolean().optional(),
    /** Simple Icons slug for button (e.g. google, microsoft, keycloak). See simpleicons.org */
    iconSlug: z.string().optional(),
    /** Background color for login button (hex, rgb, or CSS color) */
    buttonBgColor: z.string().optional(),
    /** Text color for login button (hex, rgb, or CSS color) */
    buttonTextColor: z.string().optional(),
  })
  .passthrough();

/** Body for PATCH /api/settings. All fields optional. */
export const settingsPatchBodySchema = z.object({
  whisperAsrUrl: z.string().optional(),
  transcriptionProvider: z.enum(['none', 'self_hosted', 'openai']).optional(),
  openaiTranscriptionUrl: z.string().optional(),
  openaiTranscriptionApiKey: z.string().optional(),
  transcriptionModel: z.string().optional(),
  defaultCanTranscribe: z.boolean().optional(),
  defaultCanGenerateVideo: z.boolean().optional(),
  defaultCanStripe: z.boolean().optional(),
  defaultCanEpisodeAlert: z.boolean().optional(),
  defaultCanUploadEpisodeFiles: z.boolean().optional(),
  llmProvider: z.enum(['none', 'ollama', 'openai']).optional(),
  ollamaUrl: z.string().optional(),
  openaiApiKey: z.string().optional(),
  model: z.string().optional(),
  registrationEnabled: z.boolean().optional(),
  publicFeedsEnabled: z.boolean().optional(),
  websubDiscoveryEnabled: z.boolean().optional(),
  hostname: z.string().optional(),
  websubHub: z.string().optional(),
  finalBitrateKbps: z.coerce.number().int().min(16).max(320).optional(),
  finalChannels: z.enum(['mono', 'stereo']).optional(),
  finalFormat: z.enum(['mp3', 'm4a']).optional(),
  loudnessTargetLufs: z.union([z.number(), z.literal(null)]).optional(),
  maxmindAccountId: z.string().optional(),
  maxmindLicenseKey: z.string().optional(),
  defaultMaxPodcasts: optionalLimitField,
  defaultStorageMb: optionalLimitField,
  defaultMaxEpisodes: optionalLimitField,
  defaultMaxCollaborators: optionalLimitField,
  defaultMaxSubscriberTokens: optionalLimitField,
  captchaProvider: z.enum(['none', 'recaptcha_v2', 'recaptcha_v3', 'hcaptcha']).optional(),
  captchaSiteKey: z.string().optional(),
  captchaSecretKey: z.string().optional(),
  emailProvider: z.enum(['none', 'smtp', 'sendgrid', 'webhook']).optional(),
  emailWebhookUrl: z.string().optional(),
  emailWebhookFieldKey: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFrom: z.string().optional(),
  sendgridApiKey: z.string().optional(),
  sendgridFrom: z.string().optional(),
  emailEnableRegistrationVerification: z.boolean().optional(),
  emailEnableWelcomeAfterVerify: z.boolean().optional(),
  emailEnablePasswordReset: z.boolean().optional(),
  emailEnableAdminWelcome: z.boolean().optional(),
  emailEnableNewShow: z.boolean().optional(),
  emailEnableInvite: z.boolean().optional(),
  emailEnableContact: z.boolean().optional(),
  emailEnableReviewVerification: z.boolean().optional(),
  reviewsEnabled: z.boolean().optional(),
  reviewsPublishNonVerified: z.boolean().optional(),
  reviewsLlmSpamCheck: z.boolean().optional(),
  welcomeBanner: z.string().optional(),
  whiteLabel: z.string().optional(),
  customTerms: z.string().optional(),
  customPrivacy: z.string().optional(),
  // DNS configuration
  dnsProvider: z.enum(['none', 'cloudflare']).optional(),
  dnsProviderApiToken: z.string().optional(),
  dnsUseCname: z.boolean().optional(),
  dnsARecordIp: z.string().optional(),
  dnsAllowLinkingDomain: z.boolean().optional(),
  dnsDefaultAllowDomain: z.boolean().optional(),
  dnsDefaultAllowDomains: z.array(z.string()).optional(),
  dnsDefaultAllowCustomKey: z.boolean().optional(),
  dnsDefaultAllowSubDomain: z.boolean().optional(),
  dnsDefaultDomain: z.string().optional(),
  dnsDefaultEnableCloudflareProxy: z.boolean().optional(),
  gdprConsentBannerEnabled: z.boolean().optional(),
  // WebRTC group call
  webrtcServiceUrl: z.string().optional(),
  webrtcPublicWsUrl: z.string().optional(),
  recordingCallbackSecret: z.string().optional(),
  // 2FA
  twoFactorEnabled: z.boolean().optional(),
  twoFactorMethods: z.string().optional(),
  twoFactorEnforced: z.boolean().optional(),
  // SSO providers
  ssoOidcProviders: z.array(ssoOidcProviderSchema).optional(),
  ssoSamlProviders: z.array(ssoSamlProviderSchema).optional(),
  /** When true, email/password sign-in is disabled (SSO only). */
  emailSigninDisabled: z.boolean().optional(),
});

export type SettingsPatchBody = z.infer<typeof settingsPatchBodySchema>;

/** GET /api/settings response (camelCase). Client uses this; map from server snake_case in API layer if needed. */
export const settingsResponseSchema = z.object({
  whisperAsrUrl: z.string(),
  transcriptionProvider: z.enum(['none', 'self_hosted', 'openai']),
  openaiTranscriptionUrl: z.string(),
  openaiTranscriptionApiKey: z.string(),
  transcriptionModel: z.string(),
  defaultCanTranscribe: z.boolean(),
  defaultCanGenerateVideo: z.boolean(),
  defaultCanStripe: z.boolean(),
  defaultCanEpisodeAlert: z.boolean(),
  defaultCanUploadEpisodeFiles: z.boolean(),
  llmProvider: z.enum(['none', 'ollama', 'openai']),
  ollamaUrl: z.string(),
  openaiApiKey: z.string(),
  model: z.string(),
  registrationEnabled: z.boolean(),
  publicFeedsEnabled: z.boolean(),
  websubDiscoveryEnabled: z.boolean(),
  hostname: z.string(),
  websubHub: z.string(),
  finalBitrateKbps: z.number(),
  finalChannels: z.enum(['mono', 'stereo']),
  finalFormat: z.enum(['mp3', 'm4a']),
  loudnessTargetLufs: z.number().nullable(),
  maxmindAccountId: z.string(),
  maxmindLicenseKey: z.string(),
  defaultMaxPodcasts: z.number().nullable(),
  defaultStorageMb: z.number().nullable(),
  defaultMaxEpisodes: z.number().nullable(),
  defaultMaxCollaborators: z.number().nullable(),
  defaultMaxSubscriberTokens: z.number().nullable(),
  captchaProvider: z.enum(['none', 'recaptcha_v2', 'recaptcha_v3', 'hcaptcha']),
  captchaSiteKey: z.string(),
  captchaSecretKey: z.string(),
  emailProvider: z.enum(['none', 'smtp', 'sendgrid', 'webhook']),
  emailWebhookUrl: z.string(),
  emailWebhookFieldKey: z.string(),
  smtpHost: z.string(),
  smtpPort: z.number(),
  smtpSecure: z.boolean(),
  smtpUser: z.string(),
  smtpPassword: z.string(),
  smtpFrom: z.string(),
  sendgridApiKey: z.string(),
  sendgridFrom: z.string(),
  emailEnableRegistrationVerification: z.boolean(),
  emailEnableWelcomeAfterVerify: z.boolean(),
  emailEnablePasswordReset: z.boolean(),
  emailEnableAdminWelcome: z.boolean(),
  emailEnableNewShow: z.boolean(),
  emailEnableInvite: z.boolean(),
  emailEnableContact: z.boolean(),
  emailEnableReviewVerification: z.boolean(),
  reviewsEnabled: z.boolean(),
  reviewsPublishNonVerified: z.boolean(),
  reviewsLlmSpamCheck: z.boolean(),
  welcomeBanner: z.string(),
  whiteLabel: z.string(),
  customTerms: z.string(),
  customPrivacy: z.string(),
  dnsProvider: z.enum(['none', 'cloudflare']),
  dnsProviderApiToken: z.string().optional(),
  dnsProviderApiTokenSet: z.boolean().optional(),
  dnsUseCname: z.boolean(),
  dnsARecordIp: z.string(),
  dnsAllowLinkingDomain: z.boolean(),
  dnsDefaultAllowDomain: z.boolean(),
  dnsDefaultAllowDomains: z.string(),
  dnsDefaultAllowCustomKey: z.boolean(),
  dnsDefaultAllowSubDomain: z.boolean(),
  dnsDefaultDomain: z.string(),
  dnsDefaultEnableCloudflareProxy: z.boolean(),
  gdprConsentBannerEnabled: z.boolean(),
  webrtcServiceUrl: z.string(),
  webrtcPublicWsUrl: z.string(),
  recordingCallbackSecret: z.string(),
  twoFactorEnabled: z.boolean(),
  twoFactorMethods: z.string(),
  twoFactorEnforced: z.boolean(),
  emailSigninDisabled: z.boolean(),
  ssoOidcProviders: z.array(z.record(z.string(), z.unknown())).optional(),
  ssoSamlProviders: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/** Body for POST /api/settings/test-llm. All fields optional; server falls back to saved settings. */
export const settingsTestLlmBodySchema = z.object({
  llmProvider: z.enum(['none', 'ollama', 'openai']).optional(),
  ollamaUrl: z.string().optional(),
  openaiApiKey: z.string().optional(),
});

/** Body for POST /api/settings/test-whisper. Optional; server falls back to saved settings. */
export const settingsTestWhisperBodySchema = z.object({
  whisperAsrUrl: z.string().optional(),
});

/** Body for POST /api/settings/test-transcription-openai. Optional; server falls back to saved settings. */
export const settingsTestTranscriptionOpenaiBodySchema = z.object({
  openaiTranscriptionUrl: z.string().optional(),
  openaiTranscriptionApiKey: z.string().optional(),
});

/** Body for POST /api/settings/test-smtp. All fields optional; server falls back to saved settings. */
export const settingsTestSmtpBodySchema = z.object({
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
});

/** Body for POST /api/settings/test-sendgrid. Optional; server falls back to saved settings. */
export const settingsTestSendgridBodySchema = z.object({
  sendgridApiKey: z.string().optional(),
});

/** Body for POST /api/settings/geolite/test and geolite/update. Both optional; server falls back to saved. */
export const settingsGeoliteTestBodySchema = z.object({
  maxmindAccountId: z.string().optional(),
  maxmindLicenseKey: z.string().optional(),
});

export type SettingsTestLlmBody = z.infer<typeof settingsTestLlmBodySchema>;
export type SettingsTestWhisperBody = z.infer<typeof settingsTestWhisperBodySchema>;
export type SettingsTestTranscriptionOpenaiBody = z.infer<typeof settingsTestTranscriptionOpenaiBodySchema>;
export type SettingsTestSmtpBody = z.infer<typeof settingsTestSmtpBodySchema>;
export type SettingsTestSendgridBody = z.infer<typeof settingsTestSendgridBodySchema>;
export type SettingsGeoliteTestBody = z.infer<typeof settingsGeoliteTestBodySchema>;
