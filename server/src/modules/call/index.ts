import type { FastifyInstance } from "fastify";
import { registerLifecycleRoutes } from "./routes.lifecycle.js";
import { registerInternalRoutes } from "./routes.internal.js";
import { registerWsRoutes } from "./routes.ws.js";
import { registerDialInRoutes } from "./routes.dialIn.js";
import { registerMeetingRoutes } from "./routes.meetings.js";

export async function callRoutes(app: FastifyInstance): Promise<void> {
  await app.register(registerLifecycleRoutes);
  await app.register(registerMeetingRoutes);
  await app.register(registerInternalRoutes);
  await app.register(registerWsRoutes);
  await app.register(registerDialInRoutes);
}
