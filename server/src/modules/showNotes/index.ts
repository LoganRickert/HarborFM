import type { FastifyInstance } from "fastify";
import { registerShowNotesRoutes } from "./routes.js";

export async function showNotesRoutes(app: FastifyInstance): Promise<void> {
  await registerShowNotesRoutes(app);
}
