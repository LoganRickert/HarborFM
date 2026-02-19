import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";
import { registerCompleteRoutes } from "./routes.complete.js";

export async function setupRoutes(app: FastifyInstance) {
  await registerCoreRoutes(app);
  await registerCompleteRoutes(app);
}
