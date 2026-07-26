export type ComputeJobKind = "video_generate" | "transcribe";

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
    };

export type ClientMessage =
  | { type: "auth"; secret: string; name?: string }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "accepted"; jobId: string }
  | { type: "rejected"; jobId: string; reason?: string }
  | { type: "progress"; jobId: string; message?: string }
  | { type: "completed"; jobId: string }
  | { type: "failed"; jobId: string; error: string };
