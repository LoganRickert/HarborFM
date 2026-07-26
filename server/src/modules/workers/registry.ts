import type { WebSocket } from "ws";

export type WorkerState = "idle" | "busy";

export type ConnectedWorker = {
  id: string;
  socket: WebSocket;
  name: string;
  state: WorkerState;
  connectedAt: number;
  lastSeen: number;
  currentJobId: string | null;
};

const workers = new Map<string, ConnectedWorker>();
let rrIndex = 0;

export function registerWorker(
  id: string,
  socket: WebSocket,
  name: string,
): ConnectedWorker {
  const w: ConnectedWorker = {
    id,
    socket,
    name,
    state: "idle",
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    currentJobId: null,
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

export function workerStatusSummary(): {
  connected: number;
  idle: number;
  busy: number;
  workers: Array<{ id: string; name: string; state: WorkerState }>;
} {
  const all = listWorkers();
  return {
    connected: all.length,
    idle: all.filter((w) => w.state === "idle").length,
    busy: all.filter((w) => w.state === "busy").length,
    workers: all.map((w) => ({ id: w.id, name: w.name, state: w.state })),
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
