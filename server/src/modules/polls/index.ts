import type { FastifyInstance } from "fastify";
import { registerPollAuthRoutes } from "./routes.auth.js";
import { registerPollPublicRoutes } from "./routes.public.js";

export async function pollsRoutes(app: FastifyInstance) {
  await registerPollAuthRoutes(app);
  await registerPollPublicRoutes(app);
}

export * from "./repo.js";
