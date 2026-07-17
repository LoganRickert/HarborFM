import type { FastifyInstance } from "fastify";
import { registerAvailableRoutes } from "./routes.available.js";
import { registerAskRoutes } from "./routes.ask.js";
import { registerChapterRoutes } from "./routes.chapters.js";

export async function llmRoutes(app: FastifyInstance) {
  await app.register(registerAvailableRoutes);
  await app.register(registerAskRoutes);
  await app.register(registerChapterRoutes);
}
