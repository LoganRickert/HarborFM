import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { readSettings } from "../settings/index.js";

export async function registerAvailableRoutes(app: FastifyInstance) {
  app.get(
    "/llm/available",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["LLM"],
        summary: "LLM availability",
        description: "Check if an LLM provider is configured and available.",
        response: { 200: { description: "available: boolean" } },
      },
    },
    async () => {
      const settings = readSettings();
      const available =
        settings.llm_provider === "ollama" ||
        (settings.llm_provider === "openai" &&
          !!settings.openai_api_key?.trim());
      return { available: !!available };
    },
  );
}
