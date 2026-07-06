import type { FastifyInstance } from "fastify";
import { readSettings } from "../settings/index.js";

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
}
