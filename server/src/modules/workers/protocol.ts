/** Extensible compute job kinds. Add new kinds without changing the wire shape. */
export type ComputeJobKind = "video_generate" | "transcribe";

/** Per-job CPU/memory from the worker (cgroup or process tree; not host-global). */
export type WorkerJobResourceStats = {
  avgCpuPercent: number | null;
  peakCpuPercent: number | null;
  avgMemoryBytes: number | null;
  peakMemoryBytes: number | null;
  sampleCount: number;
  source?: "cgroup" | "proc" | null;
};

export type WorkerWsClientMessage =
  | { type: "auth"; secret: string; name?: string }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "accepted"; jobId: string }
  | { type: "rejected"; jobId: string; reason?: string }
  | { type: "progress"; jobId: string; message?: string }
  | {
      type: "completed";
      jobId: string;
      resourceStats?: WorkerJobResourceStats;
    }
  | {
      type: "failed";
      jobId: string;
      error: string;
      resourceStats?: WorkerJobResourceStats;
    };

export type WorkerWsServerMessage =
  | { type: "auth_ok"; workerId: string }
  | { type: "auth_error"; error: string }
  | { type: "ping" }
  | { type: "pong" }
  | {
      type: "job";
      jobId: string;
      kind: ComputeJobKind;
      token: string;
      /** Absolute API base including /api, e.g. https://host/api */
      apiBase: string;
      inputs: Array<{ name: string; filename?: string }>;
      outputs: Array<{ name: string }>;
      params: Record<string, unknown>;
    };

export {
  WORKER_FILE_BODY_LIMIT,
  WORKER_UPLOAD_CHUNK_BYTES,
  WORKER_UPLOAD_CHUNK_BODY_LIMIT,
  WORKER_ACCEPT_TIMEOUT_MS,
  WORKER_JOB_TIMEOUT_MS,
  WORKER_RECONNECT_GRACE_MS,
  WORKER_WS_HEARTBEAT_MS,
} from "../../config.js";
