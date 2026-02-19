import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";

export async function messagesRoutes(app: FastifyInstance) {
  await app.register(registerCoreRoutes);
}

export type { ContactMessageRow } from "./utils.js";
