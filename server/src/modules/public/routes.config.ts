import type { FastifyInstance } from "fastify";
import { readSettings } from "../settings/index.js";
import { getPodcastByHost } from "../../services/dns/custom-domain-resolver.js";
import { getWebRtcConfig } from "../../services/webrtcConfig.js";
import { WEBRTC_ENABLED } from "../../config.js";

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get(
    "/public/config",
    {
      schema: {
        tags: ["Public"],
        summary: "Get public config",
        description:
          "Returns public site configuration (feeds, branding, feature flags). No authentication required.",
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
              reviewsEnabled: {
                type: "boolean",
                description:
                  "When true, public feed pages show a Reviews card and accept new reviews (subject to podcast-level settings).",
              },
              whiteLabel: {
                type: "string",
                description:
                  "When set, replaces HarborFM on public feed headers and embeds.",
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
        reviewsEnabled?: boolean;
        whiteLabel?: string;
      } = {
        publicFeedsEnabled: Boolean(settings.public_feeds_enabled),
        gdprConsentBannerEnabled: Boolean(settings.gdpr_consent_banner_enabled),
        webrtcEnabled: webrtcConfigured && WEBRTC_ENABLED,
        reviewsEnabled: Boolean((settings as { reviews_enabled?: boolean }).reviews_enabled ?? true),
      };
      const whiteLabel = String((settings as { white_label?: string }).white_label ?? "").trim();
      if (whiteLabel) payload.whiteLabel = whiteLabel;
      if (match) payload.customFeedSlug = match.slug;
      return reply.send(payload);
    },
  );
}
