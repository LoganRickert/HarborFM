import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { readSettings, isTranscriptionProviderConfigured } from "../settings/index.js";
import * as repo from "./repo.js";

export async function registerAsrRoutes(app: FastifyInstance) {
  app.get(
    "/asr/available",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "ASR available",
        description: "Whether Whisper ASR is configured for transcripts.",
        response: { 200: { description: "available: boolean" } },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      const providerConfigured = isTranscriptionProviderConfigured(settings);
      const canTranscribe = repo.getUserCanTranscribe(request.userId);
      const available = providerConfigured && canTranscribe;
      return reply.send({ available });
    },
  );
}
