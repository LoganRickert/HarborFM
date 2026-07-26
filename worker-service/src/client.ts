import WebSocket from "ws";
import { mkdirSync, rmSync, existsSync } from "fs";
import { extname, join } from "path";
import { nanoid } from "nanoid";
import {
  WORKER_NAME,
  WORKER_SECRET,
  WORK_DIR,
  WORKER_WS_HEARTBEAT_MS,
  workerWsUrl,
} from "./config.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { downloadJobFile, uploadJobFile } from "./transfer.js";
import { ensureInputHasExtension } from "./ensureInputExt.js";
import { runTranscribeJob } from "./jobs/transcribe.js";
import { runVideoJob } from "./jobs/videoGenerationCore.js";

function localInputPath(
  workDir: string,
  input: { name: string; filename?: string },
): string {
  const base = `in_${input.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const fromName = input.filename ? extname(input.filename) : "";
  return join(workDir, fromName ? `${base}${fromName}` : base);
}

function send(ws: WebSocket, msg: ClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Current live socket (updated on each successful reconnect). */
let currentSocket: WebSocket | null = null;
/** True while a job is running locally (survives brief WS drops). */
let busy = false;
let reconnectDelayMs = 2000;
/** Terminal job message to send once the socket is back. */
let pendingTerminal: Extract<
  ClientMessage,
  { type: "completed" | "failed" }
> | null = null;

export function startWorkerClient(): void {
  connect();
}

function connect(): void {
  const url = workerWsUrl();
  console.log(`[worker] connecting ${url}`);
  const ws = new WebSocket(url);
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // App-level ping (resets most reverse-proxy idle timers) + WS control ping.
      send(ws, { type: "ping" });
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, WORKER_WS_HEARTBEAT_MS);
  };

  ws.on("open", () => {
    reconnectDelayMs = 2000;
    startHeartbeat();
    send(ws, { type: "auth", secret: WORKER_SECRET, name: WORKER_NAME });
  });

  ws.on("message", (data) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data.toString()) as ServerMessage;
    } catch {
      return;
    }
    void handleMessage(ws, msg);
  });

  ws.on("close", (code, reason) => {
    stopHeartbeat();
    console.warn(
      `[worker] disconnected code=${code} reason=${reason.toString()}`,
    );
    if (currentSocket === ws) currentSocket = null;
    // Keep busy=true if a job is still running so we can finish + upload after reconnect.
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[worker] socket error", err.message);
  });
}

function scheduleReconnect(): void {
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(60_000, reconnectDelayMs * 1.5);
  console.log(`[worker] reconnecting in ${Math.round(delay)}ms`);
  setTimeout(connect, delay);
}

function sendReliable(msg: ClientMessage): void {
  if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
    send(currentSocket, msg);
    return;
  }
  if (msg.type === "completed" || msg.type === "failed") {
    pendingTerminal = msg;
  }
}

async function handleMessage(ws: WebSocket, msg: ServerMessage): Promise<void> {
  if (msg.type === "auth_ok") {
    currentSocket = ws;
    console.log(`[worker] authenticated as ${msg.workerId}`);
    if (pendingTerminal) {
      send(ws, pendingTerminal);
      pendingTerminal = null;
    }
    return;
  }
  if (msg.type === "auth_error") {
    console.error(`[worker] auth failed: ${msg.error}`);
    ws.close();
    return;
  }
  if (msg.type === "ping") {
    send(ws, { type: "pong" });
    return;
  }
  if (msg.type === "pong") {
    return;
  }
  if (msg.type !== "job") return;

  if (busy) {
    send(ws, { type: "rejected", jobId: msg.jobId, reason: "busy" });
    return;
  }

  busy = true;
  currentSocket = ws;
  sendReliable({ type: "accepted", jobId: msg.jobId });
  const workDir = join(WORK_DIR, msg.jobId || nanoid());
  mkdirSync(workDir, { recursive: true });

  try {
    sendReliable({
      type: "progress",
      jobId: msg.jobId,
      message: "Downloading inputs",
    });

    const inputPaths = new Map<string, string>();
    for (const input of msg.inputs) {
      let dest = localInputPath(workDir, input);
      await downloadJobFile({
        apiBase: msg.apiBase,
        jobId: msg.jobId,
        name: input.name,
        token: msg.token,
        destPath: dest,
      });
      dest = await ensureInputHasExtension(dest);
      inputPaths.set(input.name, dest);
    }

    sendReliable({
      type: "progress",
      jobId: msg.jobId,
      message: `Running ${msg.kind}`,
    });

    const outputPaths = new Map<string, string>();
    if (msg.kind === "transcribe") {
      const audio = inputPaths.get("audio");
      if (!audio) throw new Error("Missing audio input");
      const out = join(workDir, "transcript.srt");
      await runTranscribeJob(audio, out);
      outputPaths.set("transcript.srt", out);
    } else if (msg.kind === "video_generate") {
      const audio = inputPaths.get("audio");
      const image = inputPaths.get("image");
      if (!audio || !image) throw new Error("Missing audio or image input");
      const out = join(workDir, "video.mp4");
      await runVideoJob({
        workDir,
        audioPath: audio,
        imagePath: image,
        outPath: out,
        params: msg.params,
      });
      outputPaths.set("video.mp4", out);
    } else {
      throw new Error(`Unsupported job kind: ${(msg as { kind: string }).kind}`);
    }

    sendReliable({
      type: "progress",
      jobId: msg.jobId,
      message: "Uploading outputs",
    });
    for (const output of msg.outputs) {
      const src = outputPaths.get(output.name);
      if (!src || !existsSync(src)) {
        throw new Error(`Missing output ${output.name}`);
      }
      await uploadJobFile({
        apiBase: msg.apiBase,
        jobId: msg.jobId,
        name: output.name,
        token: msg.token,
        srcPath: src,
      });
    }

    sendReliable({ type: "completed", jobId: msg.jobId });
    console.log(`[worker] job ${msg.jobId} completed`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${msg.jobId} failed:`, error);
    sendReliable({ type: "failed", jobId: msg.jobId, error });
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    busy = false;
  }
}
