import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";
import { registerAdminRoutes } from "./routes.admin.js";
import { registerImportRoutes } from "./routes.import.js";

export async function libraryRoutes(app: FastifyInstance) {
  await app.register(registerCoreRoutes);
  await app.register(registerAdminRoutes);
  await app.register(registerImportRoutes);
}
