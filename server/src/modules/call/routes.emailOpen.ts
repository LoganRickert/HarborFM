import type { FastifyInstance } from "fastify";
import { readSettings } from "../settings/index.js";
import { recordMeetingEmailOpen } from "./meetings.js";

/** 1x1 transparent GIF */
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function registerMeetingEmailOpenRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/public/meeting-email-open/:token.gif",
    {
      schema: {
        tags: ["Public"],
        summary: "Meeting email open tracking pixel",
        description:
          "Returns a 1x1 GIF. When Email Event Tracking is enabled, records the first open for the matching invite or reminder token.",
        security: [],
        params: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
        response: {
          200: { description: "1x1 GIF" },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const settings = readSettings();
      const trackingEnabled =
        (settings as { email_event_tracking_enabled?: boolean })
          .email_event_tracking_enabled ?? true;
      if (trackingEnabled && token?.trim()) {
        try {
          recordMeetingEmailOpen(token);
        } catch {
          // Ignore DB errors; still return the pixel.
        }
      }
      return reply
        .header("Content-Type", "image/gif")
        .header("Cache-Control", "no-store, no-cache, must-revalidate, private")
        .header("Pragma", "no-cache")
        .send(PIXEL_GIF);
    },
  );
}
