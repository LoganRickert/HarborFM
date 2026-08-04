import type { FastifyInstance } from "fastify";
import { registerLifecycleRoutes } from "./routes.lifecycle.js";
import { registerInternalRoutes } from "./routes.internal.js";
import { registerWsRoutes } from "./routes.ws.js";
import { registerDialInRoutes } from "./routes.dialIn.js";
import { registerMeetingRoutes } from "./routes.meetings.js";
import { registerMeetingTopicsRoutes } from "./routes.meetingTopics.js";
import { registerMeetingEmailOpenRoutes } from "./routes.emailOpen.js";
import { registerCallChatImageRoutes } from "./routes.chatImages.js";

export { startMeetingReminderPoller } from "./meetingReminderPoller.js";

export async function callRoutes(app: FastifyInstance): Promise<void> {
  await app.register(registerLifecycleRoutes);
  await app.register(registerMeetingRoutes);
  await app.register(registerMeetingTopicsRoutes);
  await app.register(registerMeetingEmailOpenRoutes);
  await app.register(registerCallChatImageRoutes);
  await app.register(registerInternalRoutes);
  await app.register(registerWsRoutes);
  await app.register(registerDialInRoutes);
}
