import type { FastifyInstance } from "fastify";
import { requireAuth, requireAdmin } from "../../plugins/auth.js";
import * as settingsRepo from "../settings/repo.js";
import {
  invalidateAllWorkerSessions,
} from "./dispatch.js";
import { workerStatusSummary } from "./registry.js";
import { registerWorkerFileRoutes } from "./routes.files.js";
import {
  generateWorkerSecrets,
  registerWorkerWsRoutes,
} from "./routes.ws.js";
import { listWorkerJobStats } from "./statsRepo.js";

export { dispatchComputeJob } from "./dispatch.js";
export { workerApiBaseFromRequest } from "./apiBase.js";
export { generateWorkerSecrets } from "./routes.ws.js";
export { workerStatusSummary } from "./registry.js";
export { invalidateAllWorkerSessions } from "./dispatch.js";

export async function workerRoutes(app: FastifyInstance): Promise<void> {
  await registerWorkerWsRoutes(app);
  await registerWorkerFileRoutes(app);

  app.get(
    "/settings/workers-status",
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (_request, reply) => {
      return reply.send(workerStatusSummary());
    },
  );

  app.get(
    "/settings/workers-job-stats",
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "List recent compute worker job stats",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as { limit?: number | string };
      const limit =
        typeof q.limit === "number"
          ? q.limit
          : typeof q.limit === "string"
            ? Number(q.limit)
            : 50;
      return reply.send({ jobs: listWorkerJobStats(limit) });
    },
  );

  app.post(
    "/settings/workers-regenerate-secrets",
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Regenerate worker path and secret",
        description:
          "Issues a new WebSocket path and shared secret, saves settings, and disconnects all connected workers.",
        response: {
          200: {
            description: "New credentials",
            type: "object",
            properties: {
              workersWsPath: { type: "string" },
              workersSharedSecret: { type: "string" },
              disconnected: { type: "number" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const current = settingsRepo.readSettings();
      const generated = generateWorkerSecrets();
      const next = {
        ...current,
        workers_ws_path: generated.path,
        workers_shared_secret: generated.secret,
      };
      settingsRepo.writeSettings(next);
      const disconnected = invalidateAllWorkerSessions(
        "Worker credentials regenerated",
      );
      return reply.send({
        workersWsPath: generated.path,
        workersSharedSecret: generated.secret,
        disconnected,
      });
    },
  );
}
