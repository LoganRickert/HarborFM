import type { FastifyInstance } from "fastify";
import type { WebsocketHandler } from "@fastify/websocket";
import { DIAL_IN_FAKE, WEBRTC_SERVICE_SECRET } from "../config.js";
import {
  joinFakeDialIn,
  leaveFakeDialIn,
  leaveFakeDialInByParticipant,
  leaveAllFakeDialInsInRoom,
  setFakeDialInMuted,
} from "../dialIn/fakeDialIn.js";
import {
  attachLiveDialInMedia,
  leaveLiveDialIn,
  leaveLiveDialInByParticipant,
  leaveAllLiveDialInsInRoom,
  setLiveDialInMuted,
} from "../dialIn/liveDialIn.js";
import { verifyDialInMediaToken } from "../dialIn/mediaToken.js";
import { assertSafeId } from "../validation.js";

export async function registerDialInRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      roomId?: string;
      participantId?: string;
      participantName?: string;
      audioPath?: string;
      toneHz?: number;
    };
  }>("/dial-in/fake/join", async (request, reply) => {
    if (!DIAL_IN_FAKE) {
      return reply.status(404).send({ error: "Fake dial-in disabled" });
    }
    const body = request.body ?? {};
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    const participantId = typeof body.participantId === "string" ? body.participantId.trim() : "";
    const participantName =
      typeof body.participantName === "string" ? body.participantName : "Phone Guest";
    if (!roomId || !participantId) {
      return reply.status(400).send({ error: "roomId and participantId are required" });
    }
    try {
      assertSafeId(roomId, "roomId");
      assertSafeId(participantId, "participantId");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid id";
      return reply.status(400).send({ error: msg });
    }
    try {
      const result = await joinFakeDialIn({
        roomId,
        participantId,
        participantName,
        audioPath: typeof body.audioPath === "string" ? body.audioPath : undefined,
        toneHz: typeof body.toneHz === "number" ? body.toneHz : undefined,
      });
      return reply.send(result);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      const message = err instanceof Error ? err.message : "Fake dial-in failed";
      request.log.warn({ err }, "fake dial-in join failed");
      return reply.status(status).send({ error: message });
    }
  });

  app.post<{
    Body: {
      dialInId?: string;
      participantId?: string;
      roomId?: string;
      allInRoom?: boolean;
    };
  }>("/dial-in/fake/leave", async (request, reply) => {
    if (!DIAL_IN_FAKE) {
      return reply.status(404).send({ error: "Fake dial-in disabled" });
    }
    const body = request.body ?? {};
    if (body.allInRoom && typeof body.roomId === "string") {
      const n = leaveAllFakeDialInsInRoom(body.roomId.trim());
      return reply.send({ ok: true, left: n });
    }
    if (typeof body.dialInId === "string" && body.dialInId.trim()) {
      const ok = leaveFakeDialIn(body.dialInId.trim());
      return reply.send({ ok, left: ok ? 1 : 0 });
    }
    if (typeof body.participantId === "string" && body.participantId.trim()) {
      const ok = leaveFakeDialInByParticipant(body.participantId.trim());
      return reply.send({ ok, left: ok ? 1 : 0 });
    }
    return reply.status(400).send({ error: "dialInId, participantId, or roomId+allInRoom required" });
  });

  app.post<{
    Body: {
      participantId?: string;
      muted?: boolean;
    };
  }>("/dial-in/fake/mute", async (request, reply) => {
    if (!DIAL_IN_FAKE) {
      return reply.status(404).send({ error: "Fake dial-in disabled" });
    }
    const body = request.body ?? {};
    const participantId =
      typeof body.participantId === "string" ? body.participantId.trim() : "";
    if (!participantId) {
      return reply.status(400).send({ error: "participantId is required" });
    }
    const muted = body.muted === true;
    const ok = setFakeDialInMuted(participantId, muted);
    if (!ok) {
      return reply.status(404).send({ error: "Phone dial-in not found" });
    }
    return reply.send({ ok: true, muted });
  });

  app.post<{
    Body: {
      dialInId?: string;
      participantId?: string;
      roomId?: string;
      allInRoom?: boolean;
    };
  }>("/dial-in/live/leave", async (request, reply) => {
    const body = request.body ?? {};
    if (body.allInRoom && typeof body.roomId === "string") {
      const n = leaveAllLiveDialInsInRoom(body.roomId.trim());
      return reply.send({ ok: true, left: n });
    }
    if (typeof body.dialInId === "string" && body.dialInId.trim()) {
      const ok = leaveLiveDialIn(body.dialInId.trim());
      return reply.send({ ok, left: ok ? 1 : 0 });
    }
    if (typeof body.participantId === "string" && body.participantId.trim()) {
      const ok = leaveLiveDialInByParticipant(body.participantId.trim());
      return reply.send({ ok, left: ok ? 1 : 0 });
    }
    return reply.status(400).send({ error: "dialInId, participantId, or roomId+allInRoom required" });
  });

  app.post<{
    Body: {
      participantId?: string;
      muted?: boolean;
    };
  }>("/dial-in/live/mute", async (request, reply) => {
    const body = request.body ?? {};
    const participantId =
      typeof body.participantId === "string" ? body.participantId.trim() : "";
    if (!participantId) {
      return reply.status(400).send({ error: "participantId is required" });
    }
    const muted = body.muted === true;
    const ok = setLiveDialInMuted(participantId, muted);
    if (!ok) {
      return reply.status(404).send({ error: "Phone dial-in not found" });
    }
    return reply.send({ ok: true, muted });
  });

  const mediaWsHandler: WebsocketHandler = async (socket, req) => {
    if (typeof socket.on !== "function") return;
    const url = typeof req.url === "string" ? req.url : "";
    let token = "";
    try {
      const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
      token = new URLSearchParams(q).get("token")?.trim() ?? "";
    } catch {
      token = "";
    }
    const payload = verifyDialInMediaToken(token, WEBRTC_SERVICE_SECRET);
    if (!payload) {
      try {
        socket.close(1008, "Invalid or expired media token");
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await attachLiveDialInMedia(socket, payload);
    } catch (err) {
      req.log.warn({ err }, "live dial-in media attach failed");
      try {
        socket.close(1011, "Dial-in media failed");
      } catch {
        /* ignore */
      }
    }
  };

  // Direct webrtc path and nginx/vite stripped /webrtc-ws/ → /
  app.get("/dial-in/media", { websocket: true }, mediaWsHandler);
  app.get("/webrtc-ws/dial-in/media", { websocket: true }, mediaWsHandler);
}
