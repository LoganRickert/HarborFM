import type { FastifyInstance } from "fastify";
import { llmGenerateChaptersBodySchema } from "@harborfm/shared";
import { requireAuth } from "../../plugins/auth.js";
import { readSettings, redactError } from "../settings/index.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { askOllama, askOpenai, OPENAI_DEFAULT_MODEL } from "./utils.js";
import {
  generateChaptersFromTranscript,
  resolveChapterLlmBudget,
} from "./chapters.js";

export async function registerChapterRoutes(app: FastifyInstance) {
  app.post(
    "/llm/generate-chapters",
    {
      preHandler: [
        requireAuth,
        userRateLimitPreHandler({ bucket: "llm", windowMs: 1000 }),
      ],
      schema: {
        tags: ["LLM"],
        summary: "Generate chapter markers from transcript",
        description:
          "Split a transcript into character-budget chunks and ask the configured LLM for chapter titles/timestamps.",
        body: {
          type: "object",
          properties: {
            transcript: { type: "string" },
            durationSec: { type: "number" },
          },
          required: ["transcript"],
        },
        response: {
          200: {
            description: "Proposed chapters",
            type: "object",
            properties: {
              chapters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    startSec: { type: "number" },
                    start: { type: "string" },
                    title: { type: "string" },
                  },
                  required: ["startSec", "start", "title"],
                },
              },
            },
            required: ["chapters"],
          },
          400: { description: "Transcript required or no provider" },
          502: { description: "Provider error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = llmGenerateChaptersBodySchema.safeParse(request.body);
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

      try {
        if (provider === "ollama") {
          const base = (settings.ollama_url || "http://localhost:11434")
            .trim()
            .replace(/\/$/, "");
          const budget = await resolveChapterLlmBudget({
            provider: "ollama",
            model,
            ollamaUrl: base,
          });
          const chapters = await generateChaptersFromTranscript(
            transcript,
            budget,
            (prompt) => askOllama(base, model, prompt, { json: true }),
          );
          return reply.send({ chapters });
        }
        if (provider === "openai") {
          const apiKey = settings.openai_api_key?.trim();
          if (!apiKey) {
            return reply
              .status(400)
              .send({ error: "OpenAI API key is not set in Settings." });
          }
          const budget = await resolveChapterLlmBudget({
            provider: "openai",
            model,
          });
          const chapters = await generateChaptersFromTranscript(
            transcript,
            budget,
            (prompt) => askOpenai(apiKey, model, prompt, { json: true }),
          );
          return reply.send({ chapters });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: redactError(msg) });
      }

      return reply.status(400).send({ error: "No LLM provider configured." });
    },
  );
}
