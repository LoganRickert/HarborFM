import type { FastifyInstance } from "fastify";
import { registerReviewPublicRoutes } from "./routes.public.js";
import { registerReviewAdminRoutes } from "./routes.admin.js";

export async function reviewsRoutes(app: FastifyInstance) {
  await app.register(registerReviewPublicRoutes);
  await app.register(registerReviewAdminRoutes);
}

export * from "./repo.js";
