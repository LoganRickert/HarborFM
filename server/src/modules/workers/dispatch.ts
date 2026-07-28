import type { WebSocket } from "ws";
import { basename } from "path";
import { readSettings } from "../settings/repo.js";
import {
  clearJobDisconnectGrace,
  createJob,
  getJob,
  listJobs,
  listJobsForWorker,
  promoteJobOutputs,
  removeJob,
  type ActiveJob,
  type JobFileRef,
} from "./jobs.js";
import { insertWorkerJobStat } from "./statsRepo.js";
import {
  WORKER_ACCEPT_TIMEOUT_MS,
  WORKER_JOB_TIMEOUT_MS,
  WORKER_RECONNECT_GRACE_MS,
  type ComputeJobKind,
  type WorkerWsServerMessage,
} from "./protocol.js";
import {
  disconnectAllWorkers,
  getWorker,
  listWorkers,
  recordWorkerJobFinished,
  setWorkerBusy,
  setWorkerIdle,
  takeIdleWorkersRoundRobin,
  type ConnectedWorker,
} from "./registry.js";
import type { WorkerJobSubject } from "./subject.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function send(socket: WebSocket, msg: WorkerWsServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

/** Worker accepted the job, then failed or disconnected during execution. */
export class WorkerExecutionError extends Error {
  readonly executionFailed = true;
  constructor(message: string) {
    super(message);
    this.name = "WorkerExecutionError";
  }
}

function isCapacityError(err: unknown): boolean {
  if (err instanceof WorkerExecutionError) return false;
  return true;
}

export type DispatchComputeJobOpts = {
  kind: ComputeJobKind;
  inputs: JobFileRef[];
  outputs: JobFileRef[];
  params: Record<string, unknown>;
  /** Public API base including /api (no trailing slash), used by workers for file URLs. */
  apiBase: string;
  runLocal: () => Promise<void>;
  /** Optional podcast/episode context for Settings → Workers status. */
  subject?: WorkerJobSubject | null;
};

/**
 * Offer job to remote workers (round-robin), with retry/wait when none are idle.
 * Capacity issues (no idle workers / reject) retry and may fall back to runLocal.
 * Once a worker accepts and then fails, the error is surfaced immediately (no silent
 * local fallback) so callers can mark the job failed.
 */
export async function dispatchComputeJob(
  opts: DispatchComputeJobOpts,
): Promise<"worker" | "local"> {
  const settings = readSettings();
  if (!settings.workers_enabled) {
    await opts.runLocal();
    return "local";
  }

  const attempts = Math.max(1, Number(settings.workers_dispatch_attempts) || 3);
  const retrySec = Math.max(1, Number(settings.workers_dispatch_retry_sec) || 60);
  const fallbackLocal = settings.workers_fallback_local !== false;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const idle = takeIdleWorkersRoundRobin();
    if (idle.length === 0) {
      lastError = new Error("No idle compute workers connected");
      if (attempt < attempts) await sleep(retrySec * 1000);
      continue;
    }

    for (const worker of idle) {
      try {
        await offerAndAwaitWorker(worker, opts);
        return "worker";
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Job ran on a worker and failed: do not retry/fallback as if capacity was missing.
        if (!isCapacityError(err)) throw lastError;
      }
    }

    if (attempt < attempts) await sleep(retrySec * 1000);
  }

  if (fallbackLocal) {
    await opts.runLocal();
    return "local";
  }

  throw lastError ?? new Error("No compute worker available");
}

async function offerAndAwaitWorker(
  worker: ConnectedWorker,
  opts: DispatchComputeJobOpts,
): Promise<void> {
  const job = createJob({
    kind: opts.kind,
    inputs: opts.inputs,
    outputs: opts.outputs,
    params: opts.params,
    subject: opts.subject ?? null,
  });

  const accepted = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      job.acceptResolve = null;
      resolve(false);
    }, WORKER_ACCEPT_TIMEOUT_MS);

    job.acceptResolve = (ok) => {
      clearTimeout(timer);
      job.acceptResolve = null;
      resolve(ok);
    };

    job.workerId = worker.id;
    job.workerName = worker.name;
    setWorkerBusy(worker.id, job.id);
    send(worker.socket, {
      type: "job",
      jobId: job.id,
      kind: job.kind,
      token: job.token,
      apiBase: opts.apiBase.replace(/\/+$/, ""),
      inputs: job.inputs.map((i) => ({
        name: i.name,
        filename: basename(i.absolutePath) || i.name,
      })),
      outputs: job.outputs.map((o) => ({ name: o.name })),
      params: job.params,
    });
  });

  if (!accepted) {
    setWorkerIdle(worker.id);
    removeJob(job.id);
    throw new Error("Worker did not accept the job");
  }

  job.acceptedAt = Date.now();
  let outcome: { status: "completed" | "failed"; error?: string } = {
    status: "failed",
    error: "Worker job ended unexpectedly",
  };

  try {
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          job.doneResolve = null;
          job.doneReject = null;
          reject(new WorkerExecutionError("Worker job timed out"));
        }, WORKER_JOB_TIMEOUT_MS);

        job.doneResolve = () => {
          clearTimeout(timer);
          job.doneResolve = null;
          job.doneReject = null;
          resolve();
        };
        job.doneReject = (err) => {
          clearTimeout(timer);
          job.doneResolve = null;
          job.doneReject = null;
          const message = err instanceof Error ? err.message : String(err);
          reject(
            err instanceof WorkerExecutionError
              ? err
              : new WorkerExecutionError(message),
          );
        };

        if (job.cancelRequested) {
          job.doneReject(new WorkerExecutionError("Job cancelled by admin"));
        }
      });

      promoteJobOutputs(job);
      outcome = { status: "completed" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = { status: "failed", error: message };
      if (err instanceof WorkerExecutionError) throw err;
      throw new WorkerExecutionError(message);
    }
  } finally {
    persistWorkerJobStat(job, outcome);
    clearJobDisconnectGrace(job);
    // Prefer the current owner (may have reconnected under a new worker id).
    if (job.workerId) setWorkerIdle(job.workerId);
    else setWorkerIdle(worker.id);
    removeJob(job.id);
  }
}

function normalizeResourceStats(
  raw: unknown,
): ActiveJob["resourceStats"] {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const numOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const sampleCount = Math.max(0, Math.trunc(Number(o.sampleCount) || 0));
  const source =
    o.source === "cgroup" || o.source === "proc" ? o.source : null;
  return {
    avgCpuPercent: numOrNull(o.avgCpuPercent),
    peakCpuPercent: numOrNull(o.peakCpuPercent),
    avgMemoryBytes: numOrNull(o.avgMemoryBytes),
    peakMemoryBytes: numOrNull(o.peakMemoryBytes),
    sampleCount,
    source,
  };
}

function persistWorkerJobStat(
  job: ActiveJob,
  outcome: { status: "completed" | "failed"; error?: string },
): void {
  const finishedMs = Date.now();
  const startedMs = job.acceptedAt ?? job.createdAt;
  const rs = job.resourceStats;
  try {
    insertWorkerJobStat({
      id: job.id,
      workerId: job.workerId,
      workerName: job.workerName,
      kind: job.kind,
      status: outcome.status,
      error: outcome.status === "failed" ? outcome.error ?? null : null,
      bytesDownloaded: job.bytesDownloaded,
      bytesUploaded: job.bytesUploaded,
      durationMs: Math.max(0, finishedMs - startedMs),
      avgCpuPercent: rs?.avgCpuPercent ?? null,
      peakCpuPercent: rs?.peakCpuPercent ?? null,
      avgMemoryBytes: rs?.avgMemoryBytes ?? null,
      peakMemoryBytes: rs?.peakMemoryBytes ?? null,
      resourceSampleCount: rs?.sampleCount ?? null,
      resourceSource: rs?.source ?? null,
      podcastId: job.subject?.podcastId ?? null,
      episodeId: job.subject?.episodeId ?? null,
      segmentId: job.subject?.segmentId ?? null,
      podcastTitle: job.subject?.podcastTitle ?? null,
      episodeTitle: job.subject?.episodeTitle ?? null,
      userId: job.subject?.userId ?? null,
      userEmail: job.subject?.userEmail ?? null,
      userUsername: job.subject?.userUsername ?? null,
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: new Date(finishedMs).toISOString(),
    });
    recordWorkerJobFinished(job.workerId, {
      kind: job.kind,
      status: outcome.status,
      finishedAt: finishedMs,
    });
  } catch {
    /* stats must not break job cleanup */
  }
}

/** Fail an accepted in-flight job and ask the worker to stop. Returns false if unknown. */
export function cancelComputeJob(jobId: string): boolean {
  const job = getJob(jobId);
  if (!job) return false;

  job.cancelRequested = true;

  if (job.workerId) {
    const worker = getWorker(job.workerId);
    if (worker?.socket) {
      send(worker.socket, { type: "cancel", jobId });
    }
  }

  clearJobDisconnectGrace(job);
  if (job.acceptResolve) {
    job.acceptResolve(false);
    return true;
  }
  if (job.doneReject) {
    job.doneReject(new WorkerExecutionError("Job cancelled by admin"));
    return true;
  }
  // Waiters not wired yet; dispatch will reject once doneReject is set.
  return true;
}

/** Called from WS handlers when a worker replies about a job. */
export function handleWorkerJobMessage(
  workerId: string,
  msg: {
    type: "accepted" | "rejected" | "completed" | "failed";
    jobId: string;
    error?: string;
    reason?: string;
    resourceStats?: unknown;
  },
): void {
  const job = getJob(msg.jobId);
  if (!job) return;
  if (job.workerId && job.workerId !== workerId) return;

  if (msg.type === "accepted") {
    clearJobDisconnectGrace(job);
    if (job.acceptedAt == null) job.acceptedAt = Date.now();
    job.acceptResolve?.(true);
    return;
  }
  if (msg.type === "rejected") {
    clearJobDisconnectGrace(job);
    job.acceptResolve?.(false);
    setWorkerIdle(workerId);
    return;
  }
  if (msg.type === "completed") {
    clearJobDisconnectGrace(job);
    job.resourceStats = normalizeResourceStats(msg.resourceStats);
    job.doneResolve?.();
    return;
  }
  if (msg.type === "failed") {
    clearJobDisconnectGrace(job);
    job.resourceStats = normalizeResourceStats(msg.resourceStats);
    job.doneReject?.(
      new WorkerExecutionError(msg.error || msg.reason || "Worker job failed"),
    );
  }
}

/**
 * Rebind accepted in-flight jobs from a dropped socket to a reconnecting worker
 * with the same name (within the grace window). Returns how many jobs were claimed.
 */
export function reclaimJobsForWorkerName(
  workerName: string,
  newWorkerId: string,
): number {
  const name = workerName.trim();
  if (!name) return 0;
  let claimed = 0;
  for (const job of listJobs()) {
    if (job.workerName !== name) continue;
    // Only reclaim jobs that were accepted and are still awaiting completion.
    if (job.acceptResolve || !job.doneResolve) continue;
    const ownerGone = !job.workerId || !getWorker(job.workerId);
    if (!ownerGone && !job.disconnectGraceTimer) continue;
    clearJobDisconnectGrace(job);
    job.workerId = newWorkerId;
    setWorkerBusy(newWorkerId, job.id);
    claimed += 1;
  }
  return claimed;
}

/**
 * On socket close: reject jobs still awaiting accept immediately; keep accepted
 * jobs alive briefly so the worker can reconnect and finish HTTP uploads.
 */
export function failJobsOnWorkerDisconnect(workerId: string): void {
  const disconnected = getWorker(workerId);
  const workerName = disconnected?.name ?? null;

  for (const job of listJobsForWorker(workerId)) {
    if (job.acceptResolve) {
      clearJobDisconnectGrace(job);
      job.acceptResolve(false);
      continue;
    }
    if (!job.doneResolve && !job.doneReject) continue;
    if (job.disconnectGraceTimer) continue;

    // If the same worker name already reconnected, hand the job over now.
    if (workerName) {
      const replacement = listWorkers().find(
        (w) => w.id !== workerId && w.name === workerName,
      );
      if (replacement) {
        clearJobDisconnectGrace(job);
        job.workerId = replacement.id;
        setWorkerBusy(replacement.id, job.id);
        continue;
      }
    }

    job.disconnectGraceTimer = setTimeout(() => {
      job.disconnectGraceTimer = null;
      job.doneReject?.(new WorkerExecutionError("Worker disconnected"));
    }, WORKER_RECONNECT_GRACE_MS);
  }
  setWorkerIdle(workerId);
}

/** Fail in-flight jobs and drop every connected worker (e.g. after credential rotation). */
export function invalidateAllWorkerSessions(
  reason = "Credentials rotated",
): number {
  for (const job of listJobs()) {
    clearJobDisconnectGrace(job);
    if (job.acceptResolve) {
      job.acceptResolve(false);
    } else {
      job.doneReject?.(new WorkerExecutionError(reason));
    }
  }
  for (const w of listWorkers()) {
    setWorkerIdle(w.id);
  }
  return disconnectAllWorkers(reason);
}
