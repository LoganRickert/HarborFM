import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  getEpisodePodcastId,
  getPodcastForJoinInfo,
  getEpisodeForJoinInfo,
  buildCallJoinUrl,
} from "./repo.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import { assertSafeId } from "../../services/paths.js";
import { nanoid } from "nanoid";
import {
  createSession,
  getSessionByCode,
  getSessionForJoinInfo,
  ensureSessionJoinCode,
  getActiveSessionForEpisode,
  getAnyActiveSessionForEpisode,
  getActiveSessionCount,
  setSessionRoomId,
  setSessionHostToken,
  endSession,
} from "../../services/callSession.js";
import { getWebRtcConfig, webrtcRequestHeaders } from "../../services/webrtcConfig.js";
import {
  getClientIp,
  getIpBan,
  recordFailureAndMaybeBan,
} from "../../services/loginAttempts.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { getRequestOrigin, getPublicWsUrl, broadcastToSession, CALL_JOIN_CONTEXT, sessionSockets } from "./shared.js";
import { WEBRTC_ENABLED } from "../../config.js";
import {
  callStartBodySchema,
  callSessionCodeParamSchema,
  callSessionTokenParamSchema,
  callSessionQuerySchema,
} from "@harborfm/shared";

export async function registerLifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/call/start",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Call"],
        summary: "Start group call",
        description:
          "Create a call session for an episode. Returns token and join URL.",
        body: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            password: { type: "string", nullable: true },
          },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Session created",
            type: "object",
            properties: {
              token: { type: "string" },
              sessionId: { type: "string" },
              joinUrl: { type: "string" },
              joinCode: { type: "string", description: "4-digit code for quick join from Dashboard" },
              webrtcUrl: { type: "string", nullable: true },
              roomId: { type: "string", nullable: true },
              hostToken: { type: "string", nullable: true },
              webrtcUnavailable: { type: "boolean", nullable: true },
            },
          },
          403: { description: "No permission" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = callStartBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId } = parsed.data;
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });

      const existing = getActiveSessionForEpisode(episodeId, request.userId);
      const anyExisting = getAnyActiveSessionForEpisode(episodeId);
      if (anyExisting && anyExisting.hostUserId !== request.userId) {
        return reply.status(409).send({
          error: "A call is already in progress for this episode.",
        });
      }
      if (existing) {
        ensureSessionJoinCode(existing);
        const origin = getRequestOrigin(
          request.headers["origin"] as string | undefined,
          request.headers["referer"] as string | undefined
        );
        const joinUrl = buildCallJoinUrl(existing.podcastId, existing.token, origin);
        const payload: Record<string, unknown> = {
          token: existing.token,
          sessionId: existing.sessionId,
          joinUrl,
          joinCode: existing.joinCode,
        };
        const webrtcCfg = getWebRtcConfig();
        if (WEBRTC_ENABLED && existing.roomId && webrtcCfg.publicWsUrl) {
          payload.webrtcUrl =
            webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
          payload.roomId = existing.roomId;
          if (existing.hostToken) payload.hostToken = existing.hostToken;
        }
        return reply.send(payload);
      }

      const episodeRow = getEpisodePodcastId(episodeId);
      if (!episodeRow)
        return reply.status(404).send({ error: "Episode not found" });
      const podcastId = episodeRow.podcastId;

      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined
      );
      const session = createSession(
        episodeId,
        podcastId,
        request.userId,
        origin,
        parsed.data.password ?? null,
        async (endedSession) => {
          if (
            endedSession.roomId &&
            endedSession.recordingInProgress === true
          ) {
            const webrtcCfg = getWebRtcConfig();
            if (webrtcCfg?.serviceUrl) {
              try {
                await fetch(
                  `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/stop-recording`,
                  {
                    method: "POST",
                    headers: webrtcRequestHeaders(webrtcCfg),
                    body: JSON.stringify({ roomId: endedSession.roomId }),
                  },
                );
              } catch (err) {
                request.log.warn(
                  { err, roomId: endedSession.roomId },
                  "WebRTC stop-recording failed on host-away call end",
                );
              }
            }
          }
          broadcastToSession(endedSession.sessionId, { type: "callEnded" });
          broadcastToEpisode(endedSession.episodeId, { type: "callEnded" });
          sessionSockets.delete(endedSession.sessionId);
        },
      );
      let webrtcUrl: string | null = null;
      let roomId: string | null = null;
      let webrtcUnavailable = false;
      const webrtcCfg = getWebRtcConfig();
      const publicWsBase = getPublicWsUrl(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined
      );
      if (WEBRTC_ENABLED && webrtcCfg.serviceUrl) {
        const hostToken = nanoid(24);
        const roomUrl = `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/room`;
        const roomBody = JSON.stringify({
          roomId: session.sessionId,
          hostToken,
        });
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const roomRes = await fetch(roomUrl, {
              method: "POST",
              headers: webrtcRequestHeaders(webrtcCfg),
              body: roomBody,
            });
            if (roomRes.ok && publicWsBase) {
              const roomData = (await roomRes.json()) as { roomId: string };
              roomId = roomData.roomId;
              setSessionRoomId(session.sessionId, roomId);
              setSessionHostToken(session.sessionId, hostToken);
              webrtcUrl = publicWsBase;
              request.log.debug({ sessionId: session.sessionId, attempt }, "[call] room created ok");
              break;
            }
            request.log.debug({ sessionId: session.sessionId, attempt, status: roomRes.status }, "[call] room POST not ok");
            if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
          } catch (err) {
            request.log.debug({ sessionId: session.sessionId, attempt, err: String(err) }, "[call] room POST failed");
            if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
          }
        }
        if (!roomId) webrtcUnavailable = true;
      }
      if (webrtcUnavailable) {
        endSession(session.sessionId);
        return reply.status(503).send({
          error: "WebRTC service is unavailable. Please ensure the webrtc container is running and try again.",
          webrtcUnavailable: true,
        });
      }
      const joinUrl = buildCallJoinUrl(podcastId, session.token, origin);
      const payload: Record<string, unknown> = {
        token: session.token,
        sessionId: session.sessionId,
        joinUrl,
        joinCode: session.joinCode,
      };
      if (webrtcUrl && roomId) {
        payload.webrtcUrl = webrtcUrl;
        payload.roomId = roomId;
        if (session.hostToken) payload.hostToken = session.hostToken;
      }
      broadcastToEpisode(episodeId, {
        type: "callStarted",
        sessionId: session.sessionId,
        joinUrl: payload.joinUrl,
        joinCode: session.joinCode,
        webrtcUrl: payload.webrtcUrl,
        roomId: payload.roomId,
        hostToken: payload.hostToken,
      });
      return reply.send(payload);
    },
  );

  app.get(
    "/call/by-code/:code",
    {
      schema: {
        tags: ["Call"],
        summary: "Look up call by 4-digit code",
        description:
          "Returns the join token if a call exists with the given 4-digit code. No auth required.",
        params: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
        },
        response: {
          200: {
            description: "Token for joining, or alreadyConnected if requester is the host",
            type: "object",
            properties: {
              token: { type: "string" },
              alreadyConnected: { type: "boolean", description: "True when requester is the host and already in the call" },
              episodeId: { type: "string", description: "Episode ID when alreadyConnected, for redirect" },
            },
            required: ["token"],
          },
          404: { description: "No call found for this code" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const codeParsed = callSessionCodeParamSchema.safeParse(request.params);
      if (!codeParsed.success) {
        return reply
          .status(400)
          .send({ error: codeParsed.error.issues[0]?.message ?? "Validation failed", details: codeParsed.error.flatten() });
      }
      const { code } = codeParsed.data;
      const ip = getClientIp(request);
      const ban = getIpBan(ip, CALL_JOIN_CONTEXT);
      if (ban.banned) {
        return reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({ error: "Too many failed attempts", retryAfterSec: ban.retryAfterSec });
      }
      const session = getSessionByCode(code);
      if (!session) {
        const normalized = String(code ?? "").trim();
        request.log.info(
          {
            code: normalized,
            formatOk: normalized.length === 4 && /^\d{4}$/.test(normalized),
            activeSessionCount: getActiveSessionCount(),
          },
          "call by-code: no session found",
        );
        recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
          userAgent: request.headers["user-agent"],
        });
        return reply.status(404).send({ error: "No call found for this code" });
      }
      let alreadyConnected = false;
      try {
        await request.jwtVerify();
        const payload = request.user as { sub?: string };
        if (payload?.sub && session.hostUserId === payload.sub) {
          alreadyConnected = true;
        }
      } catch {
        /* not authenticated - guest flow */
      }
      const body: { token: string; alreadyConnected?: boolean; episodeId?: string } = {
        token: session.token,
      };
      if (alreadyConnected) {
        body.alreadyConnected = true;
        body.episodeId = session.episodeId;
      }
      return reply.send(body);
    },
  );

  app.get(
    "/call/join-info/:token",
    {
      schema: {
        tags: ["Call"],
        summary: "Get join info (public)",
        description:
          "Returns podcast and episode info for the join page. No auth required.",
        params: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
        response: {
          200: {
            description: "Join info",
            type: "object",
            properties: {
              podcast: { type: "object", properties: { title: { type: "string" } } },
              episode: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  id: { type: "string" },
                },
              },
              hostName: { type: "string", description: "Current host display name" },
              passwordRequired: { type: "boolean", description: "True when host set a password" },
              artworkUrl: { type: "string", nullable: true, description: "Podcast or episode cover URL" },
            },
          },
          404: { description: "Invalid or ended session" },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tokenParsed = callSessionTokenParamSchema.safeParse(request.params);
      if (!tokenParsed.success) {
        return reply
          .status(400)
          .send({ error: tokenParsed.error.issues[0]?.message ?? "Validation failed", details: tokenParsed.error.flatten() });
      }
      const { token } = tokenParsed.data;
      const ip = getClientIp(request);
      const ban = getIpBan(ip, CALL_JOIN_CONTEXT);
      if (ban.banned) {
        return reply
          .status(429)
          .header("Retry-After", String(ban.retryAfterSec))
          .send({ error: "Too many failed attempts", retryAfterSec: ban.retryAfterSec });
      }
      const session = getSessionForJoinInfo(token);
      if (!session) {
        recordFailureAndMaybeBan(ip, CALL_JOIN_CONTEXT, {
          userAgent: request.headers["user-agent"],
        });
        return reply.status(404).send({ error: "Invalid or expired link" });
      }

      const podcast = getPodcastForJoinInfo(session.podcastId);
      const episode = getEpisodeForJoinInfo(session.episodeId, session.podcastId);
      if (!podcast || !episode)
        return reply.status(404).send({ error: "Show or episode not found" });

      const hostP = session.participants.find((p) => p.isHost);
      const hostName = hostP?.name ?? "Host";
      const passwordRequired = Boolean(session.password && session.password.trim());

      let artworkUrl: string | null = null;
      if (episode.artworkUrl) {
        artworkUrl = episode.artworkUrl;
      } else if (episode.artworkPath) {
        const fn = episode.artworkPath.split(/[/\\]/).pop();
        if (fn) artworkUrl = `/api/public/artwork/${session.podcastId}/episodes/${episode.id}/${encodeURIComponent(fn)}`;
      }
      if (!artworkUrl && podcast.artworkUrl) artworkUrl = podcast.artworkUrl;
      if (!artworkUrl && podcast.artworkPath) {
        const fn = podcast.artworkPath.split(/[/\\]/).pop();
        if (fn) artworkUrl = `/api/public/artwork/${session.podcastId}/${encodeURIComponent(fn)}`;
      }

      return reply.send({
        podcast: { title: podcast.title },
        episode: { id: episode.id, title: episode.title },
        hostName,
        passwordRequired,
        artworkUrl,
      });
    },
  );

  app.get(
    "/call/session",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Call"],
        summary: "Get active session for episode",
        description:
          "If the user has an active call for this episode, return session info.",
        querystring: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Session if active",
            type: "object",
            nullable: true,
            properties: {
              sessionId: { type: "string" },
              token: { type: "string" },
              joinUrl: { type: "string" },
              joinCode: { type: "string", description: "4-digit code for quick join from Dashboard" },
              webrtcUrl: { type: "string", nullable: true },
              roomId: { type: "string", nullable: true },
              hostToken: { type: "string", nullable: true },
              webrtcUnavailable: { type: "boolean", nullable: true },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryParsed = callSessionQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply
          .status(400)
          .send({ error: queryParsed.error.issues[0]?.message ?? "Validation failed", details: queryParsed.error.flatten() });
      }
      const { episodeId } = queryParsed.data;
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      let session = getActiveSessionForEpisode(episodeId, request.userId);
      const isHost = !!session;
      if (!session) {
        session = getAnyActiveSessionForEpisode(episodeId);
        if (!session) return reply.send(null);
        const access = canAccessEpisode(request.userId, episodeId);
        if (!access) return reply.send(null);
      }
      ensureSessionJoinCode(session);
      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined
      );
      const joinUrl = buildCallJoinUrl(session.podcastId, session.token, origin);
      const payload: Record<string, unknown> = {
        sessionId: session.sessionId,
        token: session.token,
        joinUrl,
        joinCode: session.joinCode,
      };
      const publicWs = getPublicWsUrl(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined
      );
      if (session.roomId && publicWs) {
        payload.webrtcUrl = publicWs;
        payload.roomId = session.roomId;
        if (isHost && session.hostToken) payload.hostToken = session.hostToken;
      }
      payload.pendingSegmentIds = session.pendingSegmentIds ?? [];
      if (session.recordingInProgress === true) {
        payload.recordingInProgress = true;
      }
      if (isHost) {
        payload.participants = [...session.participants];
      }
      return reply.send(payload);
    },
  );
}
