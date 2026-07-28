import type { WebSocket } from "ws";
import { getJob } from "./jobs.js";
import type { WorkerJobSubject } from "./subject.js";

export type WorkerState = "idle" | "busy";

export type ConnectedWorker = {
  id: string;
  socket: WebSocket;
  name: string;
  state: WorkerState;
  remoteIp: string | null;
  connectedAt: number;
  lastSeen: number;
  currentJobId: string | null;
  lastJobKind: string | null;
  lastJobStatus: string | null;
  lastJobFinishedAt: number | null;
};

const workers = new Map<string, ConnectedWorker>();
let rrIndex = 0;

export function registerWorker(
  id: string,
  socket: WebSocket,
  name: string,
  remoteIp: string | null = null,
): ConnectedWorker {
  const w: ConnectedWorker = {
    id,
    socket,
    name,
    state: "idle",
    remoteIp: remoteIp?.trim() || null,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    currentJobId: null,
    lastJobKind: null,
    lastJobStatus: null,
    lastJobFinishedAt: null,
  };
  workers.set(id, w);
  return w;
}

export function unregisterWorker(id: string): ConnectedWorker | undefined {
  const w = workers.get(id);
  workers.delete(id);
  return w;
}

export function getWorker(id: string): ConnectedWorker | undefined {
  return workers.get(id);
}

export function touchWorker(id: string): void {
  const w = workers.get(id);
  if (w) w.lastSeen = Date.now();
}

export function setWorkerIdle(id: string): void {
  const w = workers.get(id);
  if (!w) return;
  w.state = "idle";
  w.currentJobId = null;
  w.lastSeen = Date.now();
}

export function setWorkerBusy(id: string, jobId: string): void {
  const w = workers.get(id);
  if (!w) return;
  w.state = "busy";
  w.currentJobId = jobId;
  w.lastSeen = Date.now();
}

export function recordWorkerJobFinished(
  workerId: string | null | undefined,
  opts: {
    kind: string;
    status: string;
    finishedAt: number;
  },
): void {
  if (!workerId) return;
  const w = workers.get(workerId);
  if (!w) return;
  w.lastJobKind = opts.kind;
  w.lastJobStatus = opts.status;
  w.lastJobFinishedAt = opts.finishedAt;
  w.lastSeen = Date.now();
}

export function listWorkers(): ConnectedWorker[] {
  return [...workers.values()];
}

export function listIdleWorkers(): ConnectedWorker[] {
  return [...workers.values()].filter((w) => w.state === "idle");
}

/** Round-robin order of current idle workers. */
export function takeIdleWorkersRoundRobin(): ConnectedWorker[] {
  const idle = listIdleWorkers();
  if (idle.length === 0) return [];
  const start = rrIndex % idle.length;
  rrIndex = (rrIndex + 1) % Math.max(1, idle.length);
  return [...idle.slice(start), ...idle.slice(0, start)];
}

export type WorkerStatusCurrentJob = {
  id: string;
  kind: string;
  startedAt: string | null;
  podcastId: string | null;
  episodeId: string | null;
  segmentId: string | null;
  podcastTitle: string | null;
  episodeTitle: string | null;
};

export type WorkerStatusEntry = {
  id: string;
  name: string;
  state: WorkerState;
  remoteIp: string | null;
  connectedAt: string;
  lastSeenAt: string;
  currentJob: WorkerStatusCurrentJob | null;
  lastJob: {
    kind: string | null;
    status: string | null;
    finishedAt: string | null;
  } | null;
};

export function workerStatusSummary(): {
  connected: number;
  idle: number;
  busy: number;
  workers: WorkerStatusEntry[];
} {
  const all = listWorkers();
  return {
    connected: all.length,
    idle: all.filter((w) => w.state === "idle").length,
    busy: all.filter((w) => w.state === "busy").length,
    workers: all.map((w) => {
      let currentJob: WorkerStatusCurrentJob | null = null;
      if (w.currentJobId) {
        const job = getJob(w.currentJobId);
        if (job) {
          const subject: WorkerJobSubject | null = job.subject;
          currentJob = {
            id: job.id,
            kind: job.kind,
            startedAt: job.acceptedAt
              ? new Date(job.acceptedAt).toISOString()
              : new Date(job.createdAt).toISOString(),
            podcastId: subject?.podcastId ?? null,
            episodeId: subject?.episodeId ?? null,
            segmentId: subject?.segmentId ?? null,
            podcastTitle: subject?.podcastTitle ?? null,
            episodeTitle: subject?.episodeTitle ?? null,
          };
        }
      }
      const lastJob =
        w.lastJobFinishedAt != null
          ? {
              kind: w.lastJobKind,
              status: w.lastJobStatus,
              finishedAt: new Date(w.lastJobFinishedAt).toISOString(),
            }
          : null;
      return {
        id: w.id,
        name: w.name,
        state: w.state,
        remoteIp: w.remoteIp,
        connectedAt: new Date(w.connectedAt).toISOString(),
        lastSeenAt: new Date(w.lastSeen).toISOString(),
        currentJob,
        lastJob,
      };
    }),
  };
}

/**
 * Close every worker socket and clear the registry.
 * Call after path/secret rotation so old sessions cannot keep working.
 */
export function disconnectAllWorkers(reason = "Credentials rotated"): number {
  const all = [...workers.values()];
  for (const w of all) {
    try {
      w.socket.close(4001, reason.slice(0, 120));
    } catch {
      /* ignore */
    }
    workers.delete(w.id);
  }
  rrIndex = 0;
  return all.length;
}
