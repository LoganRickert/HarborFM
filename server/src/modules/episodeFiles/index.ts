import type { FastifyInstance } from "fastify";
import { registerEpisodeFilesAuthRoutes } from "./routes.auth.js";
import { registerEpisodeFilesPublicRoutes } from "./routes.public.js";

export { getUserCanUploadEpisodeFiles } from "./canUploadEpisodeFiles.js";

export async function episodeFilesRoutes(app: FastifyInstance): Promise<void> {
  await registerEpisodeFilesAuthRoutes(app);
  await registerEpisodeFilesPublicRoutes(app);
}
