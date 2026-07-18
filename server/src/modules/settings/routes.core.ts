import type { FastifyInstance } from "fastify";
import { statfsSync } from "fs";
import { totalmem, freemem, cpus } from "os";
import { getDataDir } from "../../services/paths.js";
import { requireAdmin } from "../../plugins/auth.js";
import { normalizeHostname } from "../../utils/url.js";
import { encryptSecret } from "../../services/secrets.js";
import { writeSsoOidcProviders, writeSsoSamlProviders } from "../../services/ssoProviderSettings.js";
import { runGeoIPUpdate } from "../../services/geoipupdate.js";
import { syncPublicWsUrlForHostnameChange } from "../../services/webrtcConfig.js";
import { checkCommand } from "../../utils/commands.js";
import { DNS_SECRETS_AAD } from "../../config.js";
import { settingsPatchBodySchema } from "@harborfm/shared";
import * as repo from "./repo.js";
import {
  COMMANDS_WHITELIST,
  DEFAULTS,
  OPENAI_DEFAULT_MODEL,
  OPENAI_TRANSCRIPTION_DEFAULT_URL,
  TRANSCRIPTION_DEFAULT_MODEL,
  settingsToApiResponse,
  type AppSettings,
} from "./utils.js";

export async function registerCoreRoutes(app: FastifyInstance) {
  app.get(
    "/settings",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Get settings",
        description: "Returns app settings (secrets redacted). Admin only.",
        response: { 200: { description: "Settings object" } },
      },
    },
    async () => {
      const settings = repo.readSettings();
      return settingsToApiResponse(
        settings,
        repo.getSsoOidcProvidersForSettings(),
        repo.getSsoSamlProvidersForSettings(),
      );
    },
  );

  app.get(
    "/settings/commands",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Check required commands",
        description:
          "Returns whether each whitelisted command (ffmpeg, ffprobe, audiowaveform, geoipupdate, smbclient) is present. Admin only.",
        response: {
          200: {
            type: "object",
            properties: {
              commands: {
                type: "object",
                additionalProperties: { type: "boolean" },
              },
            },
            required: ["commands"],
          },
        },
      },
    },
    async (_request, reply) => {
      const commands: Record<string, boolean> = {};
      await Promise.all(
        Object.entries(COMMANDS_WHITELIST).map(
          async ([name, { path, args }]) => {
            commands[name] = await checkCommand(path, args);
          },
        ),
      );
      return reply.send({ commands });
    },
  );

  app.get(
    "/settings/system-stats",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Get system stats",
        description:
          "Returns system resource usage (memory, CPU count, disk for data dir). Admin only.",
        response: {
          200: {
            type: "object",
            properties: {
              memory: {
                type: "object",
                properties: {
                  usedBytes: { type: "number" },
                  totalBytes: { type: "number" },
                },
                required: ["usedBytes", "totalBytes"],
              },
              cpus: { type: "number" },
              disk: {
                type: "object",
                properties: {
                  usedBytes: { type: "number" },
                  totalBytes: { type: "number" },
                },
                required: ["usedBytes", "totalBytes"],
              },
            },
            required: ["memory", "cpus"],
          },
        },
      },
    },
    async (_request, reply) => {
      const totalBytes = totalmem();
      const freeBytes = freemem();
      const usedBytes = totalBytes - freeBytes;
      const memory = { usedBytes, totalBytes };
      const cpusCount = cpus().length;

      let disk: { usedBytes: number; totalBytes: number } | undefined;
      try {
        const dataDir = getDataDir();
        const stats = statfsSync(dataDir);
        const bsize = Number(stats.bsize ?? 4096);
        const totalBytesDisk = Number(stats.blocks) * bsize;
        const freeBytesDisk = Number(stats.bfree) * bsize;
        disk = {
          totalBytes: totalBytesDisk,
          usedBytes: totalBytesDisk - freeBytesDisk,
        };
      } catch {
        disk = undefined;
      }

      return reply.send({ memory, cpus: cpusCount, ...(disk && { disk }) });
    },
  );

  app.patch(
    "/settings",
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Update settings",
        description:
          "Update app settings. Admin only. Use (set) for existing secrets to leave unchanged.",
        body: { type: "object", description: "Partial settings" },
        response: {
          200: { description: "Updated settings (secrets redacted)" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsPatchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const body = parsed.data;
      const current = repo.readSettings();

      const currentOidc = repo.getSsoOidcProvidersForSettings();
      const currentSaml = repo.getSsoSamlProvidersForSettings();
      const resultingOidcCount =
        body.ssoOidcProviders !== undefined
          ? body.ssoOidcProviders.length
          : (currentOidc?.length ?? 0);
      const resultingSamlCount =
        body.ssoSamlProviders !== undefined
          ? body.ssoSamlProviders.length
          : (currentSaml?.length ?? 0);
      const totalSsoProviders = resultingOidcCount + resultingSamlCount;
      const requestedEmailSigninDisabled =
        body.emailSigninDisabled !== undefined
          ? Boolean(body.emailSigninDisabled)
          : current.email_signin_disabled;
      if (requestedEmailSigninDisabled && totalSsoProviders === 0) {
        return reply.status(400).send({
          error:
            "Cannot disable email sign-in when there are no SSO providers.",
        });
      }
      const email_signin_disabled =
        totalSsoProviders === 0 ? false : requestedEmailSigninDisabled;

      const whisper_asr_url =
        body.whisperAsrUrl !== undefined
          ? normalizeHostname(String(body.whisperAsrUrl))
          : current.whisper_asr_url;
      const transcription_provider =
        body.transcriptionProvider === "self_hosted"
          ? "self_hosted"
          : body.transcriptionProvider === "openai"
            ? "openai"
            : body.transcriptionProvider === "none"
              ? "none"
              : current.transcription_provider;
      const openai_transcription_url =
        body.openaiTranscriptionUrl !== undefined
          ? String(body.openaiTranscriptionUrl).trim() ||
            OPENAI_TRANSCRIPTION_DEFAULT_URL
          : current.openai_transcription_url;
      let openai_transcription_api_key = current.openai_transcription_api_key;
      if (body.openaiTranscriptionApiKey !== undefined) {
        const v = String(body.openaiTranscriptionApiKey).trim();
        openai_transcription_api_key =
          v === "(set)" ? current.openai_transcription_api_key : v;
      }
      let transcription_model =
        body.transcriptionModel !== undefined
          ? String(body.transcriptionModel).trim() ||
            TRANSCRIPTION_DEFAULT_MODEL
          : current.transcription_model;
      if (transcription_provider !== "openai") {
        openai_transcription_api_key = "";
        transcription_model = TRANSCRIPTION_DEFAULT_MODEL;
      }
      const default_can_transcribe =
        body.defaultCanTranscribe !== undefined
          ? Boolean(body.defaultCanTranscribe)
          : current.default_can_transcribe;
      const default_can_generate_video =
        body.defaultCanGenerateVideo !== undefined
          ? Boolean(body.defaultCanGenerateVideo)
          : current.default_can_generate_video;
      const default_can_stripe =
        body.defaultCanStripe !== undefined
          ? Boolean(body.defaultCanStripe)
          : current.default_can_stripe;
      const default_can_episode_alert =
        body.defaultCanEpisodeAlert !== undefined
          ? Boolean(body.defaultCanEpisodeAlert)
          : current.default_can_episode_alert;
      const default_can_upload_episode_files =
        body.defaultCanUploadEpisodeFiles !== undefined
          ? Boolean(body.defaultCanUploadEpisodeFiles)
          : current.default_can_upload_episode_files;
      const llm_provider =
        body.llmProvider === "openai"
          ? "openai"
          : body.llmProvider === "ollama"
            ? "ollama"
            : body.llmProvider !== undefined
              ? "none"
              : current.llm_provider;
      const ollama_url =
        body.ollamaUrl !== undefined
          ? String(body.ollamaUrl).trim()
          : current.ollama_url;
      let openai_api_key = current.openai_api_key;
      if (body.openaiApiKey !== undefined) {
        const v = String(body.openaiApiKey).trim();
        openai_api_key = v === "(set)" ? current.openai_api_key : v;
      }
      const model =
        body.model !== undefined
          ? String(body.model).trim()
          : llm_provider === "openai"
            ? OPENAI_DEFAULT_MODEL
            : llm_provider === "ollama"
              ? DEFAULTS.model
              : current.model;
      const registration_enabled =
        body.registrationEnabled !== undefined
          ? Boolean(body.registrationEnabled)
          : current.registration_enabled;
      const public_feeds_enabled =
        body.publicFeedsEnabled !== undefined
          ? Boolean(body.publicFeedsEnabled)
          : current.public_feeds_enabled;
      const websub_discovery_enabled =
        body.websubDiscoveryEnabled !== undefined
          ? Boolean(body.websubDiscoveryEnabled)
          : current.websub_discovery_enabled;
      const hostname =
        body.hostname !== undefined
          ? normalizeHostname(String(body.hostname))
          : current.hostname;
      const websub_hub =
        body.websubHub !== undefined
          ? String(body.websubHub).trim()
          : current.websub_hub;
      const final_bitrate_kbps =
        body.finalBitrateKbps !== undefined
          ? Math.min(
              320,
              Math.max(
                16,
                Number(body.finalBitrateKbps) || DEFAULTS.final_bitrate_kbps,
              ),
            )
          : current.final_bitrate_kbps;
      const final_channels =
        body.finalChannels === "stereo"
          ? "stereo"
          : body.finalChannels === "mono"
            ? "mono"
            : current.final_channels;
      const final_format =
        body.finalFormat === "m4a"
          ? "m4a"
          : body.finalFormat === "mp3"
            ? "mp3"
            : current.final_format;
      const parseLoudnessTarget = (v: unknown): number | null => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= -24 && n <= 0 ? n : null;
      };
      const loudness_target_lufs =
        body.loudnessTargetLufs !== undefined
          ? parseLoudnessTarget(body.loudnessTargetLufs)
          : current.loudness_target_lufs;
      const maxmind_account_id =
        body.maxmindAccountId !== undefined
          ? String(body.maxmindAccountId).trim()
          : current.maxmind_account_id;
      let maxmind_license_key = current.maxmind_license_key;
      if (body.maxmindLicenseKey !== undefined) {
        const v = String(body.maxmindLicenseKey).trim();
        maxmind_license_key = v === "(set)" ? current.maxmind_license_key : v;
      }
      const parseOptionalNum = (v: unknown): number | null => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const default_max_podcasts =
        body.defaultMaxPodcasts !== undefined
          ? parseOptionalNum(body.defaultMaxPodcasts)
          : current.default_max_podcasts;
      const default_storage_mb =
        body.defaultStorageMb !== undefined
          ? parseOptionalNum(body.defaultStorageMb)
          : current.default_storage_mb;
      const default_max_episodes =
        body.defaultMaxEpisodes !== undefined
          ? parseOptionalNum(body.defaultMaxEpisodes)
          : current.default_max_episodes;
      const default_max_collaborators =
        body.defaultMaxCollaborators !== undefined
          ? parseOptionalNum(body.defaultMaxCollaborators)
          : current.default_max_collaborators;
      const default_max_subscriber_tokens =
        body.defaultMaxSubscriberTokens !== undefined
          ? parseOptionalNum(body.defaultMaxSubscriberTokens)
          : current.default_max_subscriber_tokens;
      const captcha_provider =
        body.captchaProvider === "recaptcha_v2" ||
        body.captchaProvider === "recaptcha_v3" ||
        body.captchaProvider === "hcaptcha"
          ? body.captchaProvider
          : body.captchaProvider === "none"
            ? "none"
            : current.captcha_provider;
      let captcha_site_key =
        body.captchaSiteKey !== undefined
          ? String(body.captchaSiteKey).trim()
          : current.captcha_site_key;
      let captcha_secret_key = current.captcha_secret_key;
      if (body.captchaSecretKey !== undefined) {
        const v = String(body.captchaSecretKey).trim();
        captcha_secret_key = v === "(set)" ? current.captcha_secret_key : v;
      }
      if (captcha_provider === "none") {
        captcha_site_key = "";
        captcha_secret_key = "";
      }
      const email_provider =
        body.emailProvider === "smtp"
          ? "smtp"
          : body.emailProvider === "sendgrid"
            ? "sendgrid"
            : body.emailProvider === "webhook"
              ? "webhook"
              : body.emailProvider !== undefined
                ? "none"
                : current.email_provider;
      const email_webhook_url =
        body.emailWebhookUrl !== undefined
          ? String(body.emailWebhookUrl).trim()
          : current.email_webhook_url;
      const email_webhook_field_key =
        body.emailWebhookFieldKey !== undefined
          ? String(body.emailWebhookFieldKey).trim() || "content"
          : current.email_webhook_field_key;
      const smtp_host =
        body.smtpHost !== undefined
          ? String(body.smtpHost).trim()
          : current.smtp_host;
      const smtp_port =
        body.smtpPort !== undefined
          ? Math.min(
              65535,
              Math.max(1, Number(body.smtpPort) || DEFAULTS.smtp_port),
            )
          : current.smtp_port;
      const smtp_secure =
        body.smtpSecure !== undefined
          ? Boolean(body.smtpSecure)
          : current.smtp_secure;
      const smtp_user =
        body.smtpUser !== undefined
          ? String(body.smtpUser).trim()
          : current.smtp_user;
      let smtp_password = current.smtp_password;
      if (body.smtpPassword !== undefined) {
        const v = String(body.smtpPassword).trim();
        smtp_password = v === "(set)" ? current.smtp_password : v;
      }
      const smtp_from =
        body.smtpFrom !== undefined
          ? String(body.smtpFrom).trim()
          : current.smtp_from;
      let sendgrid_api_key = current.sendgrid_api_key;
      if (body.sendgridApiKey !== undefined) {
        const v = String(body.sendgridApiKey).trim();
        sendgrid_api_key = v === "(set)" ? current.sendgrid_api_key : v;
      }
      const sendgrid_from =
        body.sendgridFrom !== undefined
          ? String(body.sendgridFrom).trim()
          : current.sendgrid_from;
      const email_enable_registration_verification =
        body.emailEnableRegistrationVerification !== undefined
          ? Boolean(body.emailEnableRegistrationVerification)
          : current.email_enable_registration_verification;
      const email_enable_welcome_after_verify =
        body.emailEnableWelcomeAfterVerify !== undefined
          ? Boolean(body.emailEnableWelcomeAfterVerify)
          : current.email_enable_welcome_after_verify;
      const email_enable_password_reset =
        body.emailEnablePasswordReset !== undefined
          ? Boolean(body.emailEnablePasswordReset)
          : current.email_enable_password_reset;
      const email_enable_admin_welcome =
        body.emailEnableAdminWelcome !== undefined
          ? Boolean(body.emailEnableAdminWelcome)
          : current.email_enable_admin_welcome;
      const email_enable_new_show =
        body.emailEnableNewShow !== undefined
          ? Boolean(body.emailEnableNewShow)
          : current.email_enable_new_show;
      const email_enable_invite =
        body.emailEnableInvite !== undefined
          ? Boolean(body.emailEnableInvite)
          : current.email_enable_invite;
      const email_enable_contact =
        body.emailEnableContact !== undefined
          ? Boolean(body.emailEnableContact)
          : current.email_enable_contact;
      const email_enable_review_verification =
        body.emailEnableReviewVerification !== undefined
          ? Boolean(body.emailEnableReviewVerification)
          : (current as { email_enable_review_verification?: boolean }).email_enable_review_verification ?? true;
      const reviews_enabled =
        body.reviewsEnabled !== undefined
          ? Boolean(body.reviewsEnabled)
          : (current as { reviews_enabled?: boolean }).reviews_enabled ?? true;
      const reviews_publish_non_verified =
        body.reviewsPublishNonVerified !== undefined
          ? Boolean(body.reviewsPublishNonVerified)
          : (current as { reviews_publish_non_verified?: boolean }).reviews_publish_non_verified ?? false;
      const reviews_llm_spam_check =
        body.reviewsLlmSpamCheck !== undefined
          ? Boolean(body.reviewsLlmSpamCheck)
          : (current as { reviews_llm_spam_check?: boolean }).reviews_llm_spam_check ?? false;
      const welcome_banner =
        body.welcomeBanner !== undefined
          ? String(body.welcomeBanner)
          : current.welcome_banner;
      const white_label =
        body.whiteLabel !== undefined
          ? String(body.whiteLabel).trim()
          : (current as { white_label?: string }).white_label ?? "";
      const custom_terms =
        body.customTerms !== undefined
          ? String(body.customTerms)
          : current.custom_terms;
      const custom_privacy =
        body.customPrivacy !== undefined
          ? String(body.customPrivacy)
          : current.custom_privacy;

      const dns_provider =
        body.dnsProvider === "cloudflare"
          ? "cloudflare"
          : body.dnsProvider === "none"
            ? "none"
            : current.dns_provider;
      let dns_provider_api_token_enc = current.dns_provider_api_token_enc;
      if (body.dnsProviderApiToken !== undefined) {
        const v = String(body.dnsProviderApiToken).trim();
        if (v === "(set)") {
          dns_provider_api_token_enc = current.dns_provider_api_token_enc;
        } else if (v) {
          dns_provider_api_token_enc = encryptSecret(v, DNS_SECRETS_AAD);
        } else {
          dns_provider_api_token_enc = "";
        }
      }
      if (dns_provider === "cloudflare" && !dns_provider_api_token_enc) {
        return reply.status(400).send({
          error:
            "Provider API Token is required when DNS provider is Cloudflare.",
        });
      }
      if (dns_provider === "none") {
        dns_provider_api_token_enc = "";
      }
      const dns_use_cname =
        body.dnsUseCname !== undefined
          ? Boolean(body.dnsUseCname)
          : current.dns_use_cname;
      const dns_a_record_ip =
        body.dnsARecordIp !== undefined
          ? String(body.dnsARecordIp).trim()
          : current.dns_a_record_ip;
      const dns_allow_linking_domain =
        body.dnsAllowLinkingDomain !== undefined
          ? Boolean(body.dnsAllowLinkingDomain)
          : current.dns_allow_linking_domain;
      const dns_default_allow_domain =
        body.dnsDefaultAllowDomain !== undefined
          ? Boolean(body.dnsDefaultAllowDomain)
          : current.dns_default_allow_domain;
      const dns_default_allow_domains =
        body.dnsDefaultAllowDomains !== undefined
          ? JSON.stringify(
              Array.isArray(body.dnsDefaultAllowDomains)
                ? body.dnsDefaultAllowDomains.filter((s): s is string => typeof s === "string")
                : [],
            )
          : current.dns_default_allow_domains;
      const dns_default_allow_custom_key =
        body.dnsDefaultAllowCustomKey !== undefined
          ? Boolean(body.dnsDefaultAllowCustomKey)
          : current.dns_default_allow_custom_key;
      const dns_default_allow_sub_domain =
        body.dnsDefaultAllowSubDomain !== undefined
          ? Boolean(body.dnsDefaultAllowSubDomain)
          : current.dns_default_allow_sub_domain;
      const dns_default_domain =
        body.dnsDefaultDomain !== undefined
          ? String(body.dnsDefaultDomain).trim()
          : current.dns_default_domain;
      const dns_default_enable_cloudflare_proxy =
        body.dnsDefaultEnableCloudflareProxy !== undefined
          ? Boolean(body.dnsDefaultEnableCloudflareProxy)
          : current.dns_default_enable_cloudflare_proxy;
      const gdpr_consent_banner_enabled =
        body.gdprConsentBannerEnabled !== undefined
          ? Boolean(body.gdprConsentBannerEnabled)
          : current.gdpr_consent_banner_enabled;
      const webrtc_service_url =
        body.webrtcServiceUrl !== undefined
          ? String(body.webrtcServiceUrl).trim()
          : current.webrtc_service_url;
      let webrtc_public_ws_url =
        body.webrtcPublicWsUrl !== undefined
          ? String(body.webrtcPublicWsUrl).trim()
          : current.webrtc_public_ws_url;
      webrtc_public_ws_url = syncPublicWsUrlForHostnameChange(
        current.hostname,
        hostname,
        webrtc_public_ws_url,
      );
      let recording_callback_secret = current.recording_callback_secret;
      if (body.recordingCallbackSecret !== undefined) {
        const v = String(body.recordingCallbackSecret).trim();
        recording_callback_secret = v === "(set)" ? current.recording_callback_secret : v;
      }
      const two_factor_enabled =
        body.twoFactorEnabled !== undefined
          ? Boolean(body.twoFactorEnabled)
          : current.two_factor_enabled;
      const two_factor_methods =
        body.twoFactorMethods !== undefined
          ? String(body.twoFactorMethods).trim() || "totp"
          : current.two_factor_methods;
      const two_factor_enforced =
        body.twoFactorEnforced !== undefined
          ? Boolean(body.twoFactorEnforced)
          : current.two_factor_enforced;

      const next: AppSettings = {
        whisper_asr_url,
        transcription_provider,
        openai_transcription_url,
        openai_transcription_api_key,
        transcription_model,
        default_can_transcribe,
        default_can_generate_video,
        default_can_stripe,
        default_can_episode_alert,
        default_can_upload_episode_files,
        llm_provider,
        ollama_url,
        openai_api_key,
        model:
          model ||
          (llm_provider === "openai"
            ? OPENAI_DEFAULT_MODEL
            : llm_provider === "ollama"
              ? DEFAULTS.model
              : current.model),
        registration_enabled,
        public_feeds_enabled,
        websub_discovery_enabled,
        hostname,
        websub_hub,
        final_bitrate_kbps,
        final_channels,
        final_format,
        loudness_target_lufs,
        maxmind_account_id,
        maxmind_license_key,
        default_max_podcasts,
        default_storage_mb,
        default_max_episodes,
        default_max_collaborators,
        default_max_subscriber_tokens,
        captcha_provider,
        captcha_site_key,
        captcha_secret_key,
        email_provider,
        email_webhook_url,
        email_webhook_field_key,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_user,
        smtp_password,
        smtp_from,
        sendgrid_api_key,
        sendgrid_from,
        email_enable_registration_verification,
        email_enable_welcome_after_verify,
        email_enable_password_reset,
        email_enable_admin_welcome,
        email_enable_new_show,
        email_enable_invite,
        email_enable_contact,
        email_enable_review_verification,
        reviews_enabled,
        reviews_publish_non_verified,
        reviews_llm_spam_check,
        welcome_banner,
        white_label,
        custom_terms,
        custom_privacy,
        dns_provider,
        dns_provider_api_token_enc,
        dns_use_cname,
        dns_a_record_ip,
        dns_allow_linking_domain,
        dns_default_allow_domain,
        dns_default_allow_domains,
        dns_default_allow_custom_key,
        dns_default_allow_sub_domain,
        dns_default_domain,
        dns_default_enable_cloudflare_proxy,
        gdpr_consent_banner_enabled,
        webrtc_service_url,
        webrtc_public_ws_url,
        recording_callback_secret,
        two_factor_enabled,
        two_factor_methods,
        two_factor_enforced,
        email_signin_disabled,
      };
      const maxmindKeysChanged =
        next.maxmind_account_id !== current.maxmind_account_id ||
        next.maxmind_license_key !== current.maxmind_license_key;

      if (body.ssoOidcProviders !== undefined) {
        const result = writeSsoOidcProviders(body.ssoOidcProviders);
        if (!result.ok) {
          return reply.status(400).send({ error: result.error });
        }
      }
      if (body.ssoSamlProviders !== undefined) {
        const result = writeSsoSamlProviders(body.ssoSamlProviders);
        if (!result.ok) {
          return reply.status(400).send({ error: result.error });
        }
      }

      repo.writeSettings(next);

      if (
        maxmindKeysChanged &&
        next.maxmind_account_id &&
        next.maxmind_license_key
      ) {
        runGeoIPUpdate(next.maxmind_account_id, next.maxmind_license_key)
          .then((result) => {
            if (result.ok) {
              console.log(
                "GeoLite2 databases (Country, City) updated successfully in",
                getDataDir(),
              );
            } else {
              console.error("GeoLite2 update failed:", result.error);
            }
          })
          .catch((err) => console.error("GeoLite2 update error:", err));
      }

      return reply.send(
        settingsToApiResponse(
          next,
          repo.getSsoOidcProvidersForSettings(),
          repo.getSsoSamlProvidersForSettings(),
        ),
      );
    },
  );
}
