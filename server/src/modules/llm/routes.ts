import type { FastifyInstance } from "fastify";
import { llmAskBodySchema } from "@harborfm/shared";
import { OPENAI_CHAT_COMPLETIONS_URL } from "../../config.js";
import { requireAuth } from "../../plugins/auth.js";
import { readSettings, redactError } from "../settings/index.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";

const OPENAI_DEFAULT_MODEL = "gpt5-mini";

export async function llmRoutes(app: FastifyInstance) {
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
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const transcript = parsed.data.transcript ?? "";
      const question = (parsed.data.question ?? "").trim();
      const segmentName = parsed.data.segment_name?.trim();
      const durationSec = parsed.data.duration_sec;
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

      function formatDuration(sec: number): string {
        if (!Number.isFinite(sec) || sec < 0) return "0:00";
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, "0")}`;
      }

      const contextParts: string[] = [];
      contextParts.push(
        "You are an AI assistant helping a podcast host or creator review an audio segment. " +
          "Your role is to give feedback on speaking patterns (pace, clarity, filler words, tone), " +
          "suggest follow-up questions or topics for future segments, and answer questions about the content. " +
          "Be constructive, specific, and actionable."
      );
      if (segmentName) {
        contextParts.push(`Segment name: "${segmentName}"`);
      }
      if (typeof durationSec === "number" && durationSec > 0) {
        contextParts.push(`Segment length: ${formatDuration(durationSec)}`);
      }
      if (markers.length > 0) {
        const markerLines = markers.map((m: { time: number; title?: string }) => {
          const label = m.title?.trim() || "marker";
          return `  ${formatDuration(m.time)} – ${label}`;
        });
        contextParts.push(`Markers (chapter/timeline points):\n${markerLines.join("\n")}`);
      }
      const contextBlock = contextParts.join("\n");
      const transcriptBlock = transcript
        ? `\n\n--- Transcript ---\n${transcript}\n--- End transcript ---`
        : "\n\nThe user has no transcript for this section.";
      const prompt = `${contextBlock}${transcriptBlock}\n\nUser question: ${question}`;

      if (provider === "ollama") {
        const base = (settings.ollama_url || "http://localhost:11434")
          .trim()
          .replace(/\/$/, "");
        const ollamaUrl = `${base}/api/generate`;
        try {
          const res = await fetch(ollamaUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt, stream: false }),
          });
          if (!res.ok) {
            const errText = await res.text();
            return reply
              .status(502)
              .send({
                error: redactError(errText || `Ollama returned ${res.status}`),
              });
          }
          const data = (await res.json()) as { response?: string };
          const response =
            typeof data?.response === "string" ? data.response.trim() : "";
          return reply.send({ response: response || "(No response)" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.status(502).send({ error: redactError(msg) });
        }
      }

      if (provider === "openai") {
        const apiKey = settings.openai_api_key?.trim();
        if (!apiKey) {
          return reply
            .status(400)
            .send({ error: "OpenAI API key is not set in Settings." });
        }
        try {
          const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user" as const, content: prompt }],
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const msg =
              (data as { error?: { message?: string } })?.error?.message ||
              (await res.text()) ||
              `OpenAI returned ${res.status}`;
            return reply.status(502).send({ error: redactError(msg) });
          }
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = data?.choices?.[0]?.message?.content;
          const response = typeof content === "string" ? content.trim() : "";
          return reply.send({ response: response || "(No response)" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.status(502).send({ error: redactError(msg) });
        }
      }

      return reply.status(400).send({ error: "No LLM provider configured." });
    },
  );
}
