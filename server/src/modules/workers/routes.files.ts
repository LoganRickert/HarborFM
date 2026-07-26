import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Readable } from "stream";
import { basename } from "path";
import {
  addJobBytesDownloaded,
  addJobBytesUploaded,
  getJobByToken,
  openInputReadStream,
  writeStagingOutputChunk,
  writeStagingOutputFromStream,
} from "./jobs.js";
import {
  WORKER_FILE_BODY_LIMIT,
  WORKER_UPLOAD_CHUNK_BODY_LIMIT,
} from "./protocol.js";

function tokenFromRequest(req: FastifyRequest): string {
  const q = (req.query as { token?: string }).token;
  if (typeof q === "string" && q) return q;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const h = req.headers["x-worker-job-token"];
  if (typeof h === "string" && h) return h;
  return "";
}

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export async function registerWorkerFileRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Pass the raw payload stream through without buffering into memory.
  app.addContentTypeParser(
    "application/octet-stream",
    function (_request, payload, done) {
      done(null, payload);
    },
  );

  app.get(
    "/workers/jobs/:jobId/files/:name",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { jobId, name } = request.params as {
        jobId: string;
        name: string;
      };
      const token = tokenFromRequest(request);
      const job = getJobByToken(jobId, token);
      if (!job) {
        return reply.status(404).send({ error: "Job not found" });
      }
      const opened = openInputReadStream(job, name);
      if (!opened) {
        return reply.status(404).send({ error: "File not found" });
      }
      addJobBytesDownloaded(job, opened.size);
      const downloadName = basename(opened.path).replace(/"/g, "") || name;
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Length", String(opened.size));
      reply.header(
        "Content-Disposition",
        `attachment; filename="${downloadName}"`,
      );
      return reply.send(opened.stream);
    },
  );

  /** Chunked upload (preferred): PUT ~50MiB parts so reverse proxies do not 413. */
  app.put<{
    Params: { jobId: string; name: string; chunkIndex: string };
    Querystring: { totalChunks?: string; totalBytes?: string; token?: string };
    Body: Readable;
  }>(
    "/workers/jobs/:jobId/files/:name/chunks/:chunkIndex",
    {
      bodyLimit: WORKER_UPLOAD_CHUNK_BODY_LIMIT,
    },
    async (request, reply) => {
      const { jobId, name, chunkIndex: chunkIndexRaw } = request.params;
      const token = tokenFromRequest(request);
      const job = getJobByToken(jobId, token);
      if (!job) {
        return reply.status(404).send({ error: "Job not found" });
      }
      if (!job.outputs.some((o) => o.name === name)) {
        return reply.status(400).send({ error: "Unknown output name" });
      }

      const chunkIndex = parsePositiveInt(chunkIndexRaw);
      const totalChunks = parsePositiveInt(request.query.totalChunks);
      const totalBytes = parsePositiveInt(request.query.totalBytes);
      if (chunkIndex == null || totalChunks == null || totalBytes == null) {
        return reply.status(400).send({
          error: "chunkIndex, totalChunks, and totalBytes are required",
        });
      }

      const lenHeader = request.headers["content-length"];
      const chunkLength =
        typeof lenHeader === "string" && Number.isFinite(Number(lenHeader))
          ? Number(lenHeader)
          : undefined;

      const stream = request.body as Readable;
      if (!stream || typeof (stream as Readable).pipe !== "function") {
        return reply
          .status(400)
          .send({ error: "Expected application/octet-stream body" });
      }

      try {
        const result = await writeStagingOutputChunk(job, name, {
          chunkIndex,
          totalChunks,
          totalBytes,
          body: stream,
          chunkLength,
        });
        addJobBytesUploaded(job, result.bytes);
        return reply.status(200).send({
          ok: true,
          bytes: result.bytes,
          receivedBytes: result.receivedBytes,
          complete: result.complete,
        });
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Chunk upload failed",
        });
      }
    },
  );

  /** Legacy single-shot upload (may 413 behind nginx). Prefer chunked route. */
  app.put<{
    Params: { jobId: string; name: string };
    Body: Readable;
  }>(
    "/workers/jobs/:jobId/files/:name",
    {
      bodyLimit: WORKER_FILE_BODY_LIMIT,
    },
    async (request, reply) => {
      const { jobId, name } = request.params;
      const token = tokenFromRequest(request);
      const job = getJobByToken(jobId, token);
      if (!job) {
        return reply.status(404).send({ error: "Job not found" });
      }
      if (!job.outputs.some((o) => o.name === name)) {
        return reply.status(400).send({ error: "Unknown output name" });
      }

      const lenHeader = request.headers["content-length"];
      const expected =
        typeof lenHeader === "string" && Number.isFinite(Number(lenHeader))
          ? Number(lenHeader)
          : undefined;

      const stream = request.body as Readable;
      if (!stream || typeof (stream as Readable).pipe !== "function") {
        return reply
          .status(400)
          .send({ error: "Expected application/octet-stream body" });
      }

      try {
        const result = await writeStagingOutputFromStream(
          job,
          name,
          stream,
          expected,
        );
        addJobBytesUploaded(job, result.bytes);
        return reply.status(200).send({ ok: true, bytes: result.bytes });
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
  );
}
