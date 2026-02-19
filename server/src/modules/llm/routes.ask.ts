import type { FastifyInstance } from "fastify";
import { llmAskBodySchema } from "@harborfm/shared";
import { requireAuth } from "../../plugins/auth.js";
import { readSettings, redactError } from "../settings/index.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { buildLlmPrompt, askOllama, askOpenai, OPENAI_DEFAULT_MODEL } from "./utils.js";

export async function registerAskRoutes(app: FastifyInstance) {
  app.post(
    "/llm/ask",
    {
      preHandler: [
        requireAuth,
        userRateLimitPreHandler({ bucket: "llm", windowMs: 1000 }),
      ],
      schema: {
        tags: ["LLM"],
        summary: "Ask LLM",
        description:
          "Send a question (and optional transcript) to the configured LLM.",
        body: {
          type: "object",
          properties: {
            transcript: { type: "string" },
            question: { type: "string" },
            segment_name: { type: "string" },
            duration_sec: { type: "number" },
            markers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  time: { type: "number" },
                  title: { type: "string" },
                  color: { type: "string" },
                  marker_type: { type: "string" },
                },
              },
            },
          },
          required: ["question"],
        },
        response: {
          200: { description: "response text" },
          400: { description: "Question required or no provider" },
          502: { description: "Provider error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = llmAskBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              parsed.error.issues[0]?.message ?? "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const transcript = parsed.data.transcript ?? "";
      const question = (parsed.data.question ?? "").trim();
      const segmentName = parsed.data.segmentName?.trim();
      const durationSec = parsed.data.durationSec;
      const markers = parsed.data.markers ?? [];
      if (!question) {
        return reply.status(400).send({ error: "Question is required." });
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

      const prompt = buildLlmPrompt({
        segmentName,
        durationSec,
        markers: markers as Array<{ time: number; title?: string }>,
        transcript,
        question,
      });

      try {
        if (provider === "ollama") {
          const base = (settings.ollama_url || "http://localhost:11434")
            .trim()
            .replace(/\/$/, "");
          const response = await askOllama(base, model, prompt);
          return reply.send({ response });
        }
        if (provider === "openai") {
          const apiKey = settings.openai_api_key?.trim();
          if (!apiKey) {
            return reply
              .status(400)
              .send({ error: "OpenAI API key is not set in Settings." });
          }
          const response = await askOpenai(apiKey, model, prompt);
          return reply.send({ response });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: redactError(msg) });
      }

      return reply.status(400).send({ error: "No LLM provider configured." });
    },
  );
}
