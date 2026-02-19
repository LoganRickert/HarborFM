import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";

export async function usersRoutes(app: FastifyInstance) {
  await registerCoreRoutes(app);
}

export type { User } from "./utils.js";
