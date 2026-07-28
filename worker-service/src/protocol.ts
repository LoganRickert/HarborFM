export type ComputeJobKind = "video_generate" | "transcribe" | "episode_render";

/** Per-job CPU/memory samples from this worker (not host-global). */
export type JobResourceStatsPayload = {
  avgCpuPercent: number | null;
  peakCpuPercent: number | null;
  avgMemoryBytes: number | null;
  peakMemoryBytes: number | null;
  sampleCount: number;
  source?: "cgroup" | "proc" | null;
};

export type ServerMessage =
  | { type: "auth_ok"; workerId: string }
  | { type: "auth_error"; error: string }
  | { type: "ping" }
  | { type: "pong" }
  | {
      type: "job";
      jobId: string;
      kind: ComputeJobKind;
      token: string;
      apiBase: string;
      inputs: Array<{ name: string; filename?: string }>;
      outputs: Array<{ name: string }>;
      params: Record<string, unknown>;
    }
  | { type: "cancel"; jobId: string };

export type ClientMessage =
  | { type: "auth"; secret: string; name?: string }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "accepted"; jobId: string }
  | { type: "rejected"; jobId: string; reason?: string }
  | { type: "progress"; jobId: string; message?: string }
  | {
      type: "completed";
      jobId: string;
      resourceStats?: JobResourceStatsPayload;
    }
  | {
      type: "failed";
      jobId: string;
      error: string;
      resourceStats?: JobResourceStatsPayload;
    };
