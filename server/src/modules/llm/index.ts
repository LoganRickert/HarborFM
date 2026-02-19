import type { FastifyInstance } from "fastify";
import { registerAvailableRoutes } from "./routes.available.js";
import { registerAskRoutes } from "./routes.ask.js";

export async function llmRoutes(app: FastifyInstance) {
  await app.register(registerAvailableRoutes);
  await app.register(registerAskRoutes);
}
