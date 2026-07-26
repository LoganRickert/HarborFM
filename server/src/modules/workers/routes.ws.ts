import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { timingSafeEqual, randomBytes } from "crypto";
import { nanoid } from "nanoid";
import { readSettings } from "../settings/repo.js";
import {
  clearFailures,
  getClientIp,
  getIpBan,
  getUserAgent,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import {
  failJobsOnWorkerDisconnect,
  handleWorkerJobMessage,
  reclaimJobsForWorkerName,
} from "./dispatch.js";
import {
  WORKER_WS_HEARTBEAT_MS,
  type WorkerWsClientMessage,
} from "./protocol.js";
import {
  registerWorker,
  unregisterWorker,
  touchWorker,
} from "./registry.js";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function registerWorkerWsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/workers/ws/:pathToken",
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      const ip = getClientIp(req);
      const userAgent = getUserAgent(req);
      const ban = getIpBan(ip, "worker_ws");
      if (ban.banned) {
        socket.close(1008, "Too many failed attempts");
        return;
      }

      const { pathToken } = req.params as { pathToken: string };
      const settings = readSettings();
      if (
        !settings.workers_enabled ||
        !settings.workers_ws_path ||
        !safeEqual(pathToken, settings.workers_ws_path)
      ) {
        recordFailureAndMaybeBan(ip, "worker_ws", { userAgent });
        socket.close(1008, "Unauthorized");
        return;
      }

      let workerId: string | null = null;
      let authed = false;
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
          if (socket.readyState !== socket.OPEN) return;
          try {
            socket.send(JSON.stringify({ type: "ping" }));
            socket.ping();
          } catch {
            /* ignore */
          }
        }, WORKER_WS_HEARTBEAT_MS);
      };

      const authTimer = setTimeout(() => {
        if (!authed) socket.close(1008, "Auth timeout");
      }, 15_000);

      socket.on("pong", () => {
        if (workerId) touchWorker(workerId);
      });

      socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const data = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayBuffer);
        let msg: WorkerWsClientMessage;
        try {
          msg = JSON.parse(data.toString("utf8")) as WorkerWsClientMessage;
        } catch {
          return;
        }

        if (!authed) {
          if (msg.type !== "auth") {
            recordFailureAndMaybeBan(ip, "worker_ws", { userAgent });
            socket.send(
              JSON.stringify({ type: "auth_error", error: "Expected auth" }),
            );
            socket.close(1008, "Expected auth");
            return;
          }
          if (!safeEqual(msg.secret || "", settings.workers_shared_secret || "")) {
            recordFailureAndMaybeBan(ip, "worker_ws", { userAgent });
            socket.send(
              JSON.stringify({ type: "auth_error", error: "Invalid secret" }),
            );
            socket.close(1008, "Invalid secret");
            return;
          }
          clearTimeout(authTimer);
          clearFailures(ip, "worker_ws");
          authed = true;
          workerId = nanoid();
          const name =
            typeof msg.name === "string" && msg.name.trim()
              ? msg.name.trim().slice(0, 64)
              : `worker-${workerId.slice(0, 6)}`;
          registerWorker(workerId, socket, name);
          const reclaimed = reclaimJobsForWorkerName(name, workerId);
          socket.send(
            JSON.stringify({ type: "auth_ok", workerId }),
          );
          startHeartbeat();
          if (reclaimed > 0) {
            req.log.info(
              { workerId, name, reclaimed },
              "Reclaimed in-flight worker jobs after reconnect",
            );
          }
          return;
        }

        if (!workerId) return;
        touchWorker(workerId);

        if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (msg.type === "pong") {
          return;
        }

        if (
          msg.type === "accepted" ||
          msg.type === "rejected" ||
          msg.type === "completed" ||
          msg.type === "failed"
        ) {
          handleWorkerJobMessage(workerId, msg);
        }
      });

      socket.on("close", () => {
        clearTimeout(authTimer);
        stopHeartbeat();
        if (workerId) {
          failJobsOnWorkerDisconnect(workerId);
          unregisterWorker(workerId);
        }
      });
    },
  );
}

/** Generate opaque path/secret tokens for first-time enable. */
export function generateWorkerSecrets(): { path: string; secret: string } {
  return {
    path: randomBytes(24).toString("base64url"),
    secret: randomBytes(32).toString("base64url"),
  };
}
