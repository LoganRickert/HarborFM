import type { FastifyInstance } from "fastify";
import { registerCoreRoutes } from "./routes.core.js";
import { registerTestsRoutes } from "./routes.tests.js";
import { registerGeoliteRoutes } from "./routes.geolite.js";

export async function settingsRoutes(app: FastifyInstance) {
  await registerCoreRoutes(app);
  await registerTestsRoutes(app);
  await registerGeoliteRoutes(app);
}

export { readSettings, migrateSettingsFromFile, migrateWebRtcFromEnv } from "./repo.js";
export {
  isEmailProviderConfigured,
  isTranscriptionProviderConfigured,
  redactError,
} from "./utils.js";
export type { AppSettings } from "./utils.js";
