import { z } from 'zod';

export const episodeAlertDestinationTypeSchema = z.enum([
  'builtin',
  'byo_email',
  'byo_sendgrid',
  'discord',
  'slack',
  'telegram',
  'mastodon',
  'matrix',
  'lemmy',
  'bluesky',
  'json_webhook',
]);

export const episodeAlertScopeSchema = z.enum(['all', 'premium']);
export const episodeAlertListSchema = z.enum(['general', 'subscribers']);

/** PATCH podcast-level episode alert settings */
export const episodeAlertsSettingsPatchSchema = z.object({
  episodeAlertsEnabled: z.boolean().optional(),
  episodeAlertsCheckoutList: episodeAlertListSchema.optional(),
  episodeAlertsMailingAddress: z.string().max(500).nullable().optional(),
});

const secretField = z.string().optional();

export const episodeAlertDestinationConfigSchema = z
  .object({
    // byo_email
    smtpHost: z.string().optional(),
    smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
    smtpUser: z.string().optional(),
    smtpPassword: secretField,
    smtpFrom: z.string().optional(),
    // byo_sendgrid
    sendgridApiKey: secretField,
    sendgridFrom: z.string().optional(),
    // discord / slack
    webhookUrl: z.string().optional(),
    messageTemplate: z.string().max(4000).optional(),
    // telegram
    botToken: secretField,
    chatId: z.string().optional(),
    // mastodon
    instanceUrl: z.string().optional(),
    accessToken: secretField,
    statusTemplate: z.string().max(500).optional(),
    // matrix
    homeserverUrl: z.string().optional(),
    roomId: z.string().optional(),
    // lemmy
    community: z.string().optional(),
    username: z.string().optional(),
    password: secretField,
    jwt: secretField,
    titleTemplate: z.string().max(200).optional(),
    bodyTemplate: z.string().max(20000).optional(),
    // bluesky
    handle: z.string().optional(),
    appPassword: secretField,
    postTemplate: z.string().max(300).optional(),
    // json_webhook
    url: z.string().optional(),
    method: z.enum(['POST', 'PUT', 'PATCH']).optional(),
    headersJson: z.string().max(4000).optional(),
  })
  .passthrough();

export const episodeAlertDestinationCreateSchema = z.object({
  name: z.string().trim().max(120).default(''),
  type: episodeAlertDestinationTypeSchema,
  enabled: z.boolean().optional().default(true),
  episodeScope: episodeAlertScopeSchema.optional().default('all'),
  config: episodeAlertDestinationConfigSchema.optional().default({}),
});

export const episodeAlertDestinationUpdateSchema = z.object({
  name: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
  episodeScope: episodeAlertScopeSchema.optional(),
  config: episodeAlertDestinationConfigSchema.optional(),
});

/** Public feed signup */
export const episodeAlertSignupSchema = z.object({
  email: z.string().trim().email().max(320),
  captchaToken: z.string().optional(),
});

export type EpisodeAlertDestinationType = z.infer<typeof episodeAlertDestinationTypeSchema>;
export type EpisodeAlertScope = z.infer<typeof episodeAlertScopeSchema>;
export type EpisodeAlertList = z.infer<typeof episodeAlertListSchema>;
export type EpisodeAlertsSettingsPatch = z.infer<typeof episodeAlertsSettingsPatchSchema>;
export type EpisodeAlertDestinationConfig = z.infer<typeof episodeAlertDestinationConfigSchema>;
export type EpisodeAlertDestinationCreate = z.infer<typeof episodeAlertDestinationCreateSchema>;
export type EpisodeAlertDestinationUpdate = z.infer<typeof episodeAlertDestinationUpdateSchema>;
export type EpisodeAlertSignup = z.infer<typeof episodeAlertSignupSchema>;
