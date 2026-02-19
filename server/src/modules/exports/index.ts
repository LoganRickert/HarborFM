import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";
import { registerDeployRoutes } from "./routes.deploy.js";
import { registerRunsRoutes } from "./routes.runs.js";

export async function exportRoutes(app: FastifyInstance) {
  await app.register(registerCoreRoutes);
  await app.register(registerDeployRoutes);
  await app.register(registerRunsRoutes);
}
