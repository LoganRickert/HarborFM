import type { FastifyInstance } from "fastify";
import { requireAuth, requireAdmin } from "../../plugins/auth.js";
import * as settingsRepo from "../settings/repo.js";
import {
  invalidateAllWorkerSessions,
  cancelComputeJob,
} from "./dispatch.js";
import { workerStatusSummary } from "./registry.js";
import { getJob } from "./jobs.js";
import { registerWorkerFileRoutes } from "./routes.files.js";
import {
  generateWorkerSecrets,
  registerWorkerWsRoutes,
} from "./routes.ws.js";
import { listWorkerJobStats } from "./statsRepo.js";

export { dispatchComputeJob, cancelComputeJob } from "./dispatch.js";
export {
  workerApiBaseFromRequest,
  workerApiBaseFromSettings,
} from "./apiBase.js";
export { generateWorkerSecrets } from "./routes.ws.js";
export { workerStatusSummary } from "./registry.js";
export { invalidateAllWorkerSessions } from "./dispatch.js";
export { resolveWorkerJobSubject } from "./subject.js";
export type { WorkerJobSubject } from "./subject.js";

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
    "/settings/workers-jobs/:jobId/cancel",
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: ["Settings"],
        summary: "Cancel an in-flight compute worker job",
        params: {
          type: "object",
          properties: { jobId: { type: "string" } },
          required: ["jobId"],
        },
        response: {
          200: {
            description: "Cancel requested",
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
          404: { description: "Job not found or already finished" },
        },
      },
    },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      if (!jobId?.trim() || !getJob(jobId)) {
        return reply.status(404).send({ error: "Job not found" });
      }
      const ok = cancelComputeJob(jobId);
      if (!ok) {
        return reply.status(404).send({ error: "Job not found" });
      }
      return reply.send({ ok: true });
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
