import type { FastifyInstance } from "fastify";
import { registerImportRoutes } from "./routes.import.js";
import { registerStatusRoutes } from "./routes.status.js";

export async function importRoutes(app: FastifyInstance) {
  await app.register(registerImportRoutes);
  await app.register(registerStatusRoutes);
}

export type { ImportStatusState } from "./utils.js";
