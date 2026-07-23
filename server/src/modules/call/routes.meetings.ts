import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { nanoid } from "nanoid";
import {
  callMeetingCreateBodySchema,
  callMeetingIdParamSchema,
  callMeetingInviteBodySchema,
  callMeetingInviteIdParamSchema,
  callMeetingPatchBodySchema,
  callMeetingQuerySchema,
} from "@harborfm/shared";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import { assertSafeId } from "../../services/paths.js";
import {
  createSession,
  endSession,
  getAnyActiveSessionForEpisode,
  getSessionByToken,
  setSessionHostToken,
  setSessionRoomId,
} from "../../services/callSession.js";
import { getWebRtcConfig, webrtcRequestHeaders } from "../../services/webrtcConfig.js";
import { broadcastToEpisode } from "../../services/episodeBroadcast.js";
import { WEBRTC_ENABLED, MEETING_INVITE_RATE_LIMIT_MAX, MEETING_INVITE_RATE_LIMIT_WINDOW_MS } from "../../config.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import {
  getEpisodePodcastId,
  buildCallJoinUrl,
} from "./repo.js";
import { getDialInPublicConfig } from "./dialIn/config.js";
import {
  getRequestOrigin,
  getPublicWsUrl,
  broadcastToSession,
  sessionSockets,
} from "./shared.js";
import { hangUpFakeDialInsForRoom } from "./routes.dialIn.js";
import {
  MAX_ACTIVE_MEETINGS_PER_USER,
  MEETING_JOIN_EXPIRES_AFTER_MS,
  MEETING_JOIN_OPENS_BEFORE_MS,
  cancelMeeting,
  countActiveMeetingsForUser,
  createInvite,
  createMeeting,
  deleteInvite,
  ensureMeetingHostTimeZone,
  formatMeetingDurationMs,
  getActiveMeetingForEpisode,
  getInviteById,
  getMeetingById,
  isActiveMeetingRow,
  isWithinJoinWindow,
  joinExpiresAtMs,
  joinOpensAtMs,
  listInvites,
  markMeetingLive,
  updateMeetingSchedule,
  validateScheduledStartAt,
} from "./meetings.js";
import {
  inviteJoinUrl,
  absoluteOrigin,
  notifyEmailedInvitesCancelled,
  notifyEmailedInvitesRescheduled,
  sendMeetingCreatorConfirmation,
  sendMeetingInviteEmail,
} from "./meetingMail.js";

function dialInPayloadFields(): {
  dialInEnabled: boolean;
  dialInPhoneNumber: string | null;
} {
  const cfg = getDialInPublicConfig();
  return {
    dialInEnabled: cfg.enabled,
    dialInPhoneNumber: cfg.enabled ? cfg.phoneNumber : null,
  };
}

function serializeMeeting(
  meeting: NonNullable<ReturnType<typeof getMeetingById>>,
  origin: string,
) {
  const absOrigin = absoluteOrigin(origin);
  const invites = listInvites(meeting.id).map((inv) => ({
    id: inv.id,
    email: inv.email,
    displayName: inv.displayName,
    inviteToken: inv.inviteToken,
    joinUrl: inviteJoinUrl(meeting, absOrigin, inv),
    createdAt: inv.createdAt,
    lastSentAt: inv.lastSentAt,
  }));
  const joinUrl = inviteJoinUrl(meeting, absOrigin, null);
  const startMs = new Date(meeting.scheduledStartAt).getTime();
  return {
    id: meeting.id,
    episodeId: meeting.episodeId,
    podcastId: meeting.podcastId,
    createdByUserId: meeting.createdByUserId,
    scheduledStartAt: meeting.scheduledStartAt,
    token: meeting.token,
    joinCode: meeting.joinCode,
    status: meeting.status,
    liveSessionId: meeting.liveSessionId,
    joinUrl,
    joinOpensAt: new Date(joinOpensAtMs(meeting.scheduledStartAt)).toISOString(),
    joinExpiresAt: new Date(joinExpiresAtMs(meeting.scheduledStartAt)).toISOString(),
    withinJoinWindow: isWithinJoinWindow(meeting.scheduledStartAt),
    scheduledStartAtMs: startMs,
    invites,
    ...dialInPayloadFields(),
    activeMeetingCountForCreator: countActiveMeetingsForUser(meeting.createdByUserId),
    maxActiveMeetingsPerUser: MAX_ACTIVE_MEETINGS_PER_USER,
  };
}

async function createLiveRoomForSession(
  request: FastifyRequest,
  session: ReturnType<typeof createSession>,
): Promise<{
  webrtcUrl: string | null;
  roomId: string | null;
  hostToken: string | null;
  webrtcUnavailable: boolean;
}> {
  let webrtcUrl: string | null = null;
  let roomId: string | null = null;
  let hostTokenOut: string | null = null;
  let webrtcUnavailable = false;
  const webrtcCfg = getWebRtcConfig();
  const publicWsBase = getPublicWsUrl(
    request.headers["origin"] as string | undefined,
    request.headers["referer"] as string | undefined,
  );
  if (WEBRTC_ENABLED && webrtcCfg.serviceUrl) {
    const hostToken = nanoid(24);
    const roomUrl = `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/room`;
    const roomBody = JSON.stringify({
      roomId: session.sessionId,
      hostToken,
    });
    try {
      const res = await fetch(roomUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...webrtcRequestHeaders(webrtcCfg),
        },
        body: roomBody,
      });
      if (res.ok) {
        roomId = session.sessionId;
        setSessionRoomId(session.sessionId, roomId);
        setSessionHostToken(session.sessionId, hostToken);
        hostTokenOut = hostToken;
        if (publicWsBase) {
          webrtcUrl =
            publicWsBase.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
        } else if (webrtcCfg.publicWsUrl) {
          webrtcUrl =
            webrtcCfg.publicWsUrl.replace(/^http/, "ws").replace(/\/$/, "") +
            "/ws";
        }
      } else {
        webrtcUnavailable = true;
      }
    } catch {
      webrtcUnavailable = true;
    }
  }
  return { webrtcUrl, roomId, hostToken: hostTokenOut, webrtcUnavailable };
}

function onSessionEndFactory(request: FastifyRequest) {
  return async (endedSession: {
    sessionId: string;
    episodeId: string;
    roomId?: string;
    recordingInProgress?: boolean;
  }) => {
    if (endedSession.roomId && endedSession.recordingInProgress === true) {
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
    void hangUpFakeDialInsForRoom(endedSession.roomId);
  };
}

export async function registerMeetingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/call/meetings",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Call"],
        summary: "Get scheduled meeting for episode",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = callMeetingQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { episodeId } = parsed.data;
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });

      const meeting = getActiveMeetingForEpisode(episodeId);
      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined,
      );
      const activeCount = countActiveMeetingsForUser(request.userId);
      if (!meeting) {
        return reply.send({
          meeting: null,
          activeMeetingCountForCreator: activeCount,
          maxActiveMeetingsPerUser: MAX_ACTIVE_MEETINGS_PER_USER,
          atMeetingCap: activeCount >= MAX_ACTIVE_MEETINGS_PER_USER,
        });
      }
      return reply.send({
        meeting: serializeMeeting(meeting, origin),
        activeMeetingCountForCreator: activeCount,
        maxActiveMeetingsPerUser: MAX_ACTIVE_MEETINGS_PER_USER,
        atMeetingCap: activeCount >= MAX_ACTIVE_MEETINGS_PER_USER,
      });
    },
  );

  app.post(
    "/call/meetings",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Call"],
        summary: "Schedule a group call meeting",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = callMeetingCreateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { episodeId, scheduledStartAt, timeZone } = parsed.data;
      try {
        assertSafeId(episodeId, "episodeId");
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : "Invalid episodeId" });
      }
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to schedule meetings." });
      }

      const when = validateScheduledStartAt(scheduledStartAt);
      if (!when.ok) return reply.status(400).send({ error: when.error });

      if (getActiveMeetingForEpisode(episodeId)) {
        return reply.status(409).send({
          error: "A meeting is already scheduled for this episode.",
        });
      }
      if (countActiveMeetingsForUser(request.userId) >= MAX_ACTIVE_MEETINGS_PER_USER) {
        return reply.status(403).send({
          error: `You can have at most ${MAX_ACTIVE_MEETINGS_PER_USER} scheduled meetings at once.`,
        });
      }

      const episodeRow = getEpisodePodcastId(episodeId);
      if (!episodeRow) return reply.status(404).send({ error: "Episode not found" });

      let meeting;
      try {
        meeting = createMeeting({
          episodeId,
          podcastId: episodeRow.podcastId,
          createdByUserId: request.userId,
          scheduledStartAt: when.iso,
          hostTimeZone: timeZone,
        });
      } catch (err) {
        return reply.status(503).send({
          error: err instanceof Error ? err.message : "Could not create meeting",
        });
      }

      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined,
      );
      const emailResult = await sendMeetingCreatorConfirmation(meeting, origin).catch(
        (err) => {
          request.log.warn({ err }, "meeting creator confirmation email failed");
          return { sent: false, error: String(err) };
        },
      );

      return reply.send({
        meeting: serializeMeeting(meeting, origin),
        creatorEmailSent: emailResult.sent,
        creatorEmailError: emailResult.error,
      });
    },
  );

  app.patch(
    "/call/meetings/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: { tags: ["Call"], summary: "Reschedule meeting" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idParsed = callMeetingIdParamSchema.safeParse(request.params);
      const bodyParsed = callMeetingPatchBodySchema.safeParse(request.body);
      if (!idParsed.success || !bodyParsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const meeting = getMeetingById(idParsed.data.id);
      if (!meeting || !isActiveMeetingRow(meeting)) {
        return reply.status(404).send({ error: "Meeting not found" });
      }
      if (meeting.status === "live") {
        return reply
          .status(409)
          .send({ error: "Cannot reschedule a meeting that is live." });
      }
      const access = canAccessEpisode(request.userId, meeting.episodeId);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Permission denied" });
      }
      const when = validateScheduledStartAt(bodyParsed.data.scheduledStartAt);
      if (!when.ok) return reply.status(400).send({ error: when.error });

      const previous = meeting.scheduledStartAt;
      if (previous === when.iso) {
        const origin = getRequestOrigin(
          request.headers["origin"] as string | undefined,
          request.headers["referer"] as string | undefined,
        );
        return reply.send({ meeting: serializeMeeting(meeting, origin) });
      }

      const updated = updateMeetingSchedule(
        meeting.id,
        when.iso,
        bodyParsed.data.timeZone,
      );
      if (!updated) return reply.status(404).send({ error: "Meeting not found" });

      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined,
      );
      await notifyEmailedInvitesRescheduled(updated, previous, origin).catch(
        (err) => request.log.warn({ err }, "meeting reschedule emails failed"),
      );
      return reply.send({ meeting: serializeMeeting(updated, origin) });
    },
  );

  app.post(
    "/call/meetings/:id/cancel",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: { tags: ["Call"], summary: "Cancel meeting" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idParsed = callMeetingIdParamSchema.safeParse(request.params);
      if (!idParsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const meeting = getMeetingById(idParsed.data.id);
      if (!meeting || !isActiveMeetingRow(meeting)) {
        return reply.status(404).send({ error: "Meeting not found" });
      }
      const access = canAccessEpisode(request.userId, meeting.episodeId);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Permission denied" });
      }

      if (meeting.liveSessionId) {
        const live = getSessionByToken(meeting.token);
        if (live) endSession(live.sessionId);
      }

      const cancelled = cancelMeeting(meeting.id);
      if (!cancelled) return reply.status(404).send({ error: "Meeting not found" });

      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined,
      );
      await notifyEmailedInvitesCancelled(cancelled, origin).catch((err) =>
        request.log.warn({ err }, "meeting cancel emails failed"),
      );
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/call/meetings/:id/start",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: { tags: ["Call"], summary: "Start scheduled meeting" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idParsed = callMeetingIdParamSchema.safeParse(request.params);
      if (!idParsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const meeting = getMeetingById(idParsed.data.id);
      if (!meeting || !isActiveMeetingRow(meeting)) {
        return reply.status(404).send({ error: "Meeting not found" });
      }
      const access = canAccessEpisode(request.userId, meeting.episodeId);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Permission denied" });
      }
      if (!isWithinJoinWindow(meeting.scheduledStartAt)) {
        return reply.status(400).send({
          error: `This meeting can only be started from ${formatMeetingDurationMs(MEETING_JOIN_OPENS_BEFORE_MS)} before until ${formatMeetingDurationMs(MEETING_JOIN_EXPIRES_AFTER_MS)} after the scheduled start.`,
        });
      }

      const anyExisting = getAnyActiveSessionForEpisode(meeting.episodeId);
      if (anyExisting) {
        if (anyExisting.hostUserId === request.userId && anyExisting.meetingId === meeting.id) {
          const origin = getRequestOrigin(
            request.headers["origin"] as string | undefined,
            request.headers["referer"] as string | undefined,
          );
          const joinUrl = buildCallJoinUrl(meeting.podcastId, meeting.token, origin);
          return reply.send({
            token: anyExisting.token,
            sessionId: anyExisting.sessionId,
            joinUrl,
            joinCode: anyExisting.joinCode,
            ...dialInPayloadFields(),
            roomId: anyExisting.roomId ?? null,
            hostToken: anyExisting.hostToken ?? null,
            webrtcUrl: anyExisting.roomId
              ? getPublicWsUrl(
                  request.headers["origin"] as string | undefined,
                  request.headers["referer"] as string | undefined,
                )
              : null,
          });
        }
        return reply.status(409).send({
          error: "A call is already in progress for this episode.",
        });
      }

      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined,
      );
      const session = createSession(
        meeting.episodeId,
        meeting.podcastId,
        request.userId,
        origin,
        {
          token: meeting.token,
          joinCode: meeting.joinCode,
          meetingId: meeting.id,
          password: null,
        },
        onSessionEndFactory(request),
      );

      const room = await createLiveRoomForSession(request, session);
      if (WEBRTC_ENABLED && room.webrtcUnavailable && !room.roomId) {
        endSession(session.sessionId);
        return reply.status(503).send({
          error: "WebRTC service is unavailable. Try again shortly.",
        });
      }

      markMeetingLive(meeting.id, session.sessionId);
      const joinUrl = buildCallJoinUrl(meeting.podcastId, meeting.token, origin);
      broadcastToEpisode(meeting.episodeId, {
        type: "callStarted",
        joinUrl,
        joinCode: meeting.joinCode,
        webrtcUrl: room.webrtcUrl,
        roomId: room.roomId,
        hostToken: room.hostToken,
      });

      return reply.send({
        token: session.token,
        sessionId: session.sessionId,
        joinUrl,
        joinCode: session.joinCode,
        ...dialInPayloadFields(),
        webrtcUrl: room.webrtcUrl,
        roomId: room.roomId,
        hostToken: room.hostToken,
        webrtcUnavailable: room.webrtcUnavailable || undefined,
      });
    },
  );

  app.post(
    "/call/meetings/:id/invites",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({
          bucket: "meeting-invites",
          windowMs: MEETING_INVITE_RATE_LIMIT_WINDOW_MS,
          max: MEETING_INVITE_RATE_LIMIT_MAX,
        }),
      ],
      schema: {
        tags: ["Call"],
        summary: "Create meeting invite or share link",
        description:
          "Rate limited per user (MEETING_INVITE_RATE_LIMIT_MAX / MEETING_INVITE_RATE_LIMIT_WINDOW_MS).",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idParsed = callMeetingIdParamSchema.safeParse(request.params);
      const bodyParsed = callMeetingInviteBodySchema.safeParse(request.body);
      if (!idParsed.success || !bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.success
            ? "Validation failed"
            : bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      let meeting = getMeetingById(idParsed.data.id);
      if (!meeting || !isActiveMeetingRow(meeting)) {
        return reply.status(404).send({ error: "Meeting not found" });
      }
      const access = canAccessEpisode(request.userId, meeting.episodeId);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Permission denied" });
      }

      meeting =
        ensureMeetingHostTimeZone(meeting.id, bodyParsed.data.timeZone) ?? meeting;

      const origin = getRequestOrigin(
        request.headers["origin"] as string | undefined,
        request.headers["referer"] as string | undefined,
      );
      const name = bodyParsed.data.name?.trim() || null;
      const email = bodyParsed.data.email?.trim() || null;

      // Blank name + no email: return generic meeting join URL (no row).
      if (!name && !email) {
        return reply.send({
          joinUrl: buildCallJoinUrl(meeting.podcastId, meeting.token, origin),
          invite: null,
        });
      }

      const invite = createInvite({
        meetingId: meeting.id,
        email,
        displayName: name,
      });

      let emailSent = false;
      let emailError: string | undefined;
      if (email) {
        const result = await sendMeetingInviteEmail(meeting, invite, origin);
        emailSent = result.sent;
        emailError = result.error;
      }

      return reply.send({
        invite: {
          id: invite.id,
          email: invite.email,
          displayName: invite.displayName,
          inviteToken: invite.inviteToken,
          joinUrl: inviteJoinUrl(meeting, origin, invite),
          createdAt: invite.createdAt,
          lastSentAt: invite.lastSentAt,
          emailSent,
          emailError,
        },
        joinUrl: inviteJoinUrl(meeting, origin, invite),
      });
    },
  );

  app.delete(
    "/call/meetings/:id/invites/:inviteId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: { tags: ["Call"], summary: "Delete meeting invite" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = callMeetingInviteIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const meeting = getMeetingById(parsed.data.id);
      if (!meeting || !isActiveMeetingRow(meeting)) {
        return reply.status(404).send({ error: "Meeting not found" });
      }
      const access = canAccessEpisode(request.userId, meeting.episodeId);
      if (!access || !canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Permission denied" });
      }
      const invite = getInviteById(parsed.data.inviteId);
      if (!invite || invite.meetingId !== meeting.id) {
        return reply.status(404).send({ error: "Invite not found" });
      }
      deleteInvite(invite.id);
      return reply.status(204).send();
    },
  );
}
