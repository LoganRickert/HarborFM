import type { FastifyInstance } from "fastify";
import { readSettings } from "../settings/index.js";
import { getPodcastByHost } from "../../services/dns/custom-domain-resolver.js";
import { getWebRtcConfig } from "../../services/webrtcConfig.js";
import { WEBRTC_ENABLED } from "../../config.js";

export async function registerLegalRoutes(app: FastifyInstance) {
  app.get(
    "/public/legal",
    {
      schema: {
        tags: ["Public"],
        summary: "Get custom legal text",
        description:
          "Returns custom terms and privacy policy markdown if set. Used to decide whether to show custom or default on /terms and /privacy.",
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              terms: {
                type: ["string", "null"],
                description: "Custom terms markdown or null",
              },
              privacy: {
                type: ["string", "null"],
                description: "Custom privacy markdown or null",
              },
            },
          },
        },
      },
    },
    async () => {
      const settings = readSettings();
      const terms = (settings.custom_terms ?? "").trim() || null;
      const privacy = (settings.custom_privacy ?? "").trim() || null;
      return { terms, privacy };
    },
  );

  app.get(
    "/public/config",
    {
      schema: {
        tags: ["Public"],
        summary: "Get public config",
        description:
          "Returns whether public feeds are enabled. No authentication required.",
        security: [],
        response: {
          200: {
            description: "Config",
            type: "object",
            properties: {
              publicFeedsEnabled: { type: "boolean" },
              customFeedSlug: {
                type: "string",
                description:
                  "When request Host is a custom podcast domain (linkDomain, managedDomain, or managedSubDomain), the podcast slug to show at /.",
              },
              gdprConsentBannerEnabled: {
                type: "boolean",
                description:
                  "When true, show GDPR-style cookie/tracking consent banner on public pages.",
              },
              webrtcEnabled: {
                type: "boolean",
                description:
                  "When true, WebRTC group calls are configured ( Join Call on Dashboard).",
              },
            },
            required: ["publicFeedsEnabled"],
          },
        },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      const host =
        (request.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim() ||
        request.hostname ||
        "";
      const match = getPodcastByHost(host);
      const webrtcCfg = getWebRtcConfig();
      const webrtcConfigured = Boolean(webrtcCfg.serviceUrl && webrtcCfg.publicWsUrl);
      const payload: {
        publicFeedsEnabled: boolean;
        customFeedSlug?: string;
        gdprConsentBannerEnabled: boolean;
        webrtcEnabled?: boolean;
      } = {
        publicFeedsEnabled: Boolean(settings.public_feeds_enabled),
        gdprConsentBannerEnabled: Boolean(settings.gdpr_consent_banner_enabled),
        webrtcEnabled: webrtcConfigured && WEBRTC_ENABLED,
      };
      if (match) payload.customFeedSlug = match.slug;
      return reply.send(payload);
    },
  );
}
