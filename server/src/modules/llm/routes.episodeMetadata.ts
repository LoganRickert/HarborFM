import type { FastifyInstance } from "fastify";
import { llmGenerateEpisodeFieldBodySchema } from "@harborfm/shared";
import { requireAuth } from "../../plugins/auth.js";
import { readSettings, redactError } from "../settings/index.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { askOllama, askOpenai, OPENAI_DEFAULT_MODEL } from "./utils.js";
import { generateEpisodeFieldFromTranscript } from "./episodeMetadata.js";

export async function registerEpisodeMetadataRoutes(app: FastifyInstance) {
  app.post(
    "/llm/generate-episode-field",
    {
      preHandler: [
        requireAuth,
        userRateLimitPreHandler({ bucket: "llm", windowMs: 1000 }),
      ],
      schema: {
        tags: ["LLM"],
        summary: "Generate episode description, subtitle, or summary",
        description:
          "Ask the configured LLM to draft one episode metadata field from a transcript.",
        body: {
          type: "object",
          properties: {
            transcript: { type: "string" },
            field: {
              type: "string",
              enum: ["description", "subtitle", "summary"],
            },
            episodeTitle: { type: "string" },
            existingDescription: { type: "string" },
            existingSubtitle: { type: "string" },
            existingSummary: { type: "string" },
          },
          required: ["transcript", "field"],
        },
        response: {
          200: {
            description: "Generated text",
            type: "object",
            properties: {
              text: { type: "string" },
            },
            required: ["text"],
          },
          400: { description: "Transcript required or no provider" },
          502: { description: "Provider error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = llmGenerateEpisodeFieldBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const transcript = parsed.data.transcript.trim();
      if (!transcript) {
        return reply.status(400).send({ error: "Transcript is required." });
      }

      const settings = readSettings();
      const provider = settings.llm_provider;
      const model =
        (settings.model || "").trim() ||
        (provider === "openai" ? OPENAI_DEFAULT_MODEL : "llama3.2:latest");

      if (provider === "none") {
        return reply
          .status(400)
          .send({ error: "No LLM provider configured. Set one in Settings." });
      }

      const context = {
        episodeTitle: parsed.data.episodeTitle,
        existingDescription: parsed.data.existingDescription,
        existingSubtitle: parsed.data.existingSubtitle,
        existingSummary: parsed.data.existingSummary,
      };

      try {
        if (provider === "ollama") {
          const base = (settings.ollama_url || "http://localhost:11434")
            .trim()
            .replace(/\/$/, "");
          const text = await generateEpisodeFieldFromTranscript(
            parsed.data.field,
            transcript,
            (prompt) => askOllama(base, model, prompt, { json: true }),
            context,
          );
          return reply.send({ text });
        }
        if (provider === "openai") {
          const apiKey = settings.openai_api_key?.trim();
          if (!apiKey) {
            return reply
              .status(400)
              .send({ error: "OpenAI API key is not set in Settings." });
          }
          const text = await generateEpisodeFieldFromTranscript(
            parsed.data.field,
            transcript,
            (prompt) => askOpenai(apiKey, model, prompt, { json: true }),
            context,
          );
          return reply.send({ text });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: redactError(msg) });
      }

      return reply.status(400).send({ error: "No LLM provider configured." });
    },
  );
}
