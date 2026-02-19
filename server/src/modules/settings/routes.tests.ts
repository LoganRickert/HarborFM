import type { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { requireAdmin } from "../../plugins/auth.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { normalizeHostname } from "../../utils/url.js";
import { OPENAI_MODELS_URL, SENDGRID_SCOPES_URL } from "../../config.js";
import {
  settingsTestLlmBodySchema,
  settingsTestWhisperBodySchema,
  settingsTestTranscriptionOpenaiBodySchema,
  settingsTestSmtpBodySchema,
  settingsTestSendgridBodySchema,
} from "@harborfm/shared";
import * as repo from "./repo.js";
import {
  OPENAI_TRANSCRIPTION_DEFAULT_URL,
  redactError,
  validateOllamaBaseUrl,
} from "./utils.js";

const SMTP_TEST_TIMEOUT_MS = 15_000;

async function verifySmtpCredentials(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { host, port, secure, user, password } = options;
  if (!host?.trim() || !user?.trim() || !password) {
    return { ok: false, error: "Host, username, and password are required" };
  }

  const transporter = nodemailer.createTransport({
    host: host.trim(),
    port,
    secure: port === 465 ? secure : false,
    auth: { user: user.trim(), pass: password },
    connectionTimeout: SMTP_TEST_TIMEOUT_MS,
    greetingTimeout: SMTP_TEST_TIMEOUT_MS,
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function registerTestsRoutes(app: FastifyInstance) {
  app.post(
    "/settings/test-llm",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "llm", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test LLM connection",
        description:
          "Verify LLM provider (Ollama/OpenAI) is reachable. Admin only.",
        body: {
          type: "object",
          properties: {
            llmProvider: { type: "string" },
            ollamaUrl: { type: "string" },
            openaiApiKey: { type: "string" },
          },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestLlmBodySchema.safeParse(request.body);
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
      const provider = body.llmProvider ?? current.llm_provider;

      if (provider === "none") {
        return reply.send({ ok: false, error: "No LLM provider selected" });
      }

      if (provider === "ollama") {
        let ollama_url: string;
        try {
          ollama_url = validateOllamaBaseUrl(
            body.ollamaUrl ?? current.ollama_url,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid Ollama URL";
          return reply.send({ ok: false, error: msg });
        }
        try {
          const base = validateOllamaBaseUrl(ollama_url);
          const res = await fetch(`${base}/api/tags`, { method: "GET" });
          if (!res.ok) {
            const text = await res.text();
            return reply.send({
              ok: false,
              error: text || `Ollama returned ${res.status}`,
            });
          }
          return reply.send({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.send({ ok: false, error: msg });
        }
      }

      if (provider === "openai") {
        const openai_api_key =
          body.openaiApiKey !== undefined && body.openaiApiKey !== "(set)"
            ? String(body.openaiApiKey).trim()
            : current.openai_api_key;
        if (!openai_api_key) {
          return reply.send({ ok: false, error: "OpenAI API key is not set" });
        }
        try {
          const res = await fetch(OPENAI_MODELS_URL, {
            method: "GET",
            headers: { Authorization: `Bearer ${openai_api_key}` },
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const msg =
              (data as { error?: { message?: string } })?.error?.message ||
              (await res.text()) ||
              `OpenAI returned ${res.status}`;
            return reply.send({ ok: false, error: redactError(msg) });
          }
          return reply.send({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.send({ ok: false, error: redactError(msg) });
        }
      }

      return reply.send({ ok: false, error: "Invalid provider" });
    },
  );

  app.post(
    "/settings/test-whisper",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "whisper", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test Whisper ASR",
        description: "Verify Whisper ASR URL is reachable. Admin only.",
        body: {
          type: "object",
          properties: { whisperAsrUrl: { type: "string" } },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestWhisperBodySchema.safeParse(request.body);
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
      const raw = normalizeHostname(
        body.whisperAsrUrl ?? current.whisper_asr_url ?? "",
      );
      if (!raw) {
        return reply.send({ ok: false, error: "Whisper ASR URL is not set" });
      }
      let openapiUrl: string;
      try {
        const u = new URL(raw);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return reply.send({
            ok: false,
            error: "Whisper ASR URL must use http or https",
          });
        }
        const path = normalizeHostname(u.pathname || "");
        u.pathname = path ? `${path}/openapi.json` : "/openapi.json";
        openapiUrl = u.toString();
      } catch {
        return reply.send({ ok: false, error: "Invalid Whisper ASR URL" });
      }
      try {
        const res = await fetch(openapiUrl, { method: "HEAD" });
        if (res.ok) {
          return reply.send({ ok: true });
        }
        return reply.send({
          ok: false,
          error: `openapi.json returned ${res.status}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg });
      }
    },
  );

  app.post(
    "/settings/test-transcription-openai",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "whisper", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test OpenAI transcription",
        description: "Verify OpenAI API key for transcription. Admin only.",
        body: {
          type: "object",
          properties: {
            openaiTranscriptionUrl: { type: "string" },
            openaiTranscriptionApiKey: { type: "string" },
          },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestTranscriptionOpenaiBodySchema.safeParse(
        request.body,
      );
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
      const urlRaw =
        body.openaiTranscriptionUrl ?? current.openai_transcription_url;
      const baseUrl = (
        urlRaw?.trim() || OPENAI_TRANSCRIPTION_DEFAULT_URL
      ).replace(/\/audio\/transcriptions\/?$/, "");
      const apiKey =
        body.openaiTranscriptionApiKey !== undefined &&
        body.openaiTranscriptionApiKey !== "(set)"
          ? String(body.openaiTranscriptionApiKey).trim()
          : current.openai_transcription_api_key;
      if (!apiKey) {
        return reply.send({
          ok: false,
          error: "OpenAI API key for transcription is not set",
        });
      }
      let modelsUrl: string;
      try {
        const parsedUrl = new URL(
          baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`,
        );
        modelsUrl = `${parsedUrl.origin}/v1/models`;
      } catch {
        modelsUrl = `${baseUrl}/v1/models`;
      }
      try {
        const res = await fetch(modelsUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.status === 401) {
          return reply.send({ ok: false, error: "Invalid API key" });
        }
        if (!res.ok) {
          const bodyText = await res.text();
          let msg = `OpenAI returned ${res.status}`;
          try {
            const data = JSON.parse(bodyText) as {
              error?: { message?: string };
            };
            if (data?.error?.message) msg = data.error.message;
          } catch {
            if (bodyText.trim()) msg = bodyText;
          }
          return reply.send({ ok: false, error: redactError(msg) });
        }
        return reply.send({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: redactError(msg) });
      }
    },
  );

  app.post(
    "/settings/test-smtp",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "smtp", windowMs: 2000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test SMTP",
        description: "Verify SMTP credentials. Admin only.",
        body: {
          type: "object",
          properties: {
            smtpHost: { type: "string" },
            smtpPort: { type: "number" },
            smtpUser: { type: "string" },
            smtpPassword: { type: "string" },
          },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestSmtpBodySchema.safeParse(request.body);
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
      const host =
        (body.smtpHost !== undefined
          ? String(body.smtpHost).trim()
          : current.smtp_host) || "";
      const port =
        body.smtpPort !== undefined
          ? Math.min(65535, Math.max(1, Number(body.smtpPort) || 587))
          : current.smtp_port;
      const secure =
        body.smtpSecure !== undefined
          ? Boolean(body.smtpSecure)
          : current.smtp_secure;
      const user =
        (body.smtpUser !== undefined
          ? String(body.smtpUser).trim()
          : current.smtp_user) || "";
      let password = current.smtp_password ?? "";
      if (body.smtpPassword !== undefined && body.smtpPassword !== "(set)") {
        const v = String(body.smtpPassword).trim();
        if (v) password = v;
      }
      if (!host || !user || !password) {
        return reply.send({
          ok: false,
          error: "Host, username, and password are required",
        });
      }
      const result = await verifySmtpCredentials({
        host,
        port,
        secure,
        user,
        password,
      });
      return reply.send(result);
    },
  );

  app.post(
    "/settings/test-sendgrid",
    {
      preHandler: [
        requireAdmin,
        userRateLimitPreHandler({ bucket: "sendgrid", windowMs: 2000 }),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Test SendGrid",
        description: "Verify SendGrid API key. Admin only.",
        body: {
          type: "object",
          properties: { sendgridApiKey: { type: "string" } },
        },
        response: {
          200: { description: "ok and optional error" },
          400: { description: "Validation failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = settingsTestSendgridBodySchema.safeParse(request.body);
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
      let apiKey = current.sendgrid_api_key ?? "";
      if (
        body.sendgridApiKey !== undefined &&
        body.sendgridApiKey !== "(set)"
      ) {
        const v = String(body.sendgridApiKey).trim();
        if (v) apiKey = v;
      }
      if (!apiKey) {
        return reply.send({ ok: false, error: "SendGrid API key is required" });
      }
      try {
        const res = await fetch(SENDGRID_SCOPES_URL, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          return reply.send({ ok: true });
        }
        const data = await res.json().catch(() => ({}));
        const msg =
          (data as { errors?: Array<{ message?: string }> })?.errors?.[0]
            ?.message ??
          res.statusText ??
          `SendGrid returned ${res.status}`;
        return reply.send({ ok: false, error: msg });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg });
      }
    },
  );
}
