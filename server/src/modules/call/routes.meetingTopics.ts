import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import {
  meetingTopicsCreateBodySchema,
  meetingTopicsIdentitySchema,
  meetingTopicsItemIdParamSchema,
  meetingTopicsReorderBodySchema,
  meetingTopicsTokenParamSchema,
  meetingTopicsUpdateBodySchema,
  type ShowNotesItem,
} from "@harborfm/shared";
import {
  getInviteByToken,
  getMeetingByToken,
  resolveGuestMeetingStatus,
  type MeetingInviteRow,
  type MeetingRow,
} from "./meetings.js";
import { getSessionForJoinInfo } from "../../services/callSession.js";
import * as showNotesRepo from "../showNotes/repo.js";
import { broadcastShowNotesUpdate } from "../showNotes/broadcast.js";
import { getEpisodeForJoinInfo, getPodcastForJoinInfo } from "./repo.js";

const CLOSED_STATUSES = new Set(["cancelled", "ended", "expired"]);

function toGuestTopic(item: ShowNotesItem) {
  const addedToNotes = item.tag === "none";
  return {
    id: item.id,
    text: item.text,
    // Promoted notes keep discuss as the guest-facing intent label.
    tag: (addedToNotes ? "discuss" : item.tag) as "discuss" | "avoid",
    submittedBy: item.submittedBy ?? "",
    position: item.position,
    addedToNotes,
  };
}

function resolveMeetingContext(token: string): {
  meeting: MeetingRow;
  episodeId: string;
  podcastTitle: string;
  episodeTitle: string;
  meetingStatus: ReturnType<typeof resolveGuestMeetingStatus>;
} | null {
  const meeting = getMeetingByToken(token);
  if (!meeting) return null;
  const liveExists = !!getSessionForJoinInfo(meeting.token);
  const meetingStatus = resolveGuestMeetingStatus(meeting, liveExists);
  const podcast = getPodcastForJoinInfo(meeting.podcastId);
  const episode = getEpisodeForJoinInfo(meeting.episodeId, meeting.podcastId);
  if (!podcast || !episode) return null;
  return {
    meeting,
    episodeId: meeting.episodeId,
    podcastTitle: podcast.title,
    episodeTitle: episode.title,
    meetingStatus,
  };
}

function resolveSubmittedBy(
  meeting: MeetingRow,
  identity: { invite?: string; submittedBy?: string },
):
  | { ok: true; submittedBy: string; fromInvite: boolean }
  | { ok: false; error: string; status: number } {
  const inviteToken = identity.invite?.trim();
  if (inviteToken) {
    const invite: MeetingInviteRow | undefined = getInviteByToken(inviteToken);
    if (!invite || invite.meetingId !== meeting.id) {
      return { ok: false, error: "Invalid invite link", status: 400 };
    }
    const email = invite.email?.trim();
    const name = invite.displayName?.trim();
    const submittedBy = email || name;
    if (!submittedBy) {
      return {
        ok: false,
        error: "This invite has no identity; enter your name instead",
        status: 400,
      };
    }
    return { ok: true, submittedBy, fromInvite: true };
  }
  const name = identity.submittedBy?.trim();
  if (!name) {
    return { ok: false, error: "Name is required", status: 400 };
  }
  return { ok: true, submittedBy: name, fromInvite: false };
}

function rejectIfClosed(
  meetingStatus: string,
  reply: FastifyReply,
): FastifyReply | null {
  if (CLOSED_STATUSES.has(meetingStatus)) {
    const message =
      meetingStatus === "cancelled"
        ? "This meeting was cancelled."
        : meetingStatus === "ended"
          ? "This meeting has ended."
          : "This meeting link has expired.";
    return reply.status(403).send({ error: message, meetingStatus });
  }
  return null;
}

export async function registerMeetingTopicsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/call/meetings/by-token/:token/topics",
    {
      schema: {
        tags: ["Call"],
        summary: "List guest discuss/avoid topics for a meeting (public)",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = meetingTopicsTokenParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const queryParsed = meetingTopicsIdentitySchema.safeParse(request.query ?? {});
      if (!queryParsed.success) {
        return reply.status(400).send({
          error: queryParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const ctx = resolveMeetingContext(paramsParsed.data.token);
      if (!ctx) return reply.status(404).send({ error: "Meeting not found" });
      const closed = rejectIfClosed(ctx.meetingStatus, reply);
      if (closed) return closed;

      const identity = resolveSubmittedBy(ctx.meeting, queryParsed.data);
      if (!identity.ok) {
        return reply.status(identity.status).send({ error: identity.error });
      }

      const items = showNotesRepo
        .listGuestTopicsForSubmitter(ctx.episodeId, identity.submittedBy)
        .map(toGuestTopic);

      return {
        podcast: { title: ctx.podcastTitle },
        episode: { id: ctx.episodeId, title: ctx.episodeTitle },
        meetingStatus: ctx.meetingStatus,
        scheduledStartAt: ctx.meeting.scheduledStartAt,
        submittedBy: identity.submittedBy,
        fromInvite: identity.fromInvite,
        items,
      };
    },
  );

  app.post(
    "/call/meetings/by-token/:token/topics",
    {
      schema: {
        tags: ["Call"],
        summary: "Create a guest discuss/avoid topic (public)",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = meetingTopicsTokenParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = meetingTopicsCreateBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const ctx = resolveMeetingContext(paramsParsed.data.token);
      if (!ctx) return reply.status(404).send({ error: "Meeting not found" });
      const closed = rejectIfClosed(ctx.meetingStatus, reply);
      if (closed) return closed;

      const identity = resolveSubmittedBy(ctx.meeting, bodyParsed.data);
      if (!identity.ok) {
        return reply.status(identity.status).send({ error: identity.error });
      }

      const item = showNotesRepo.insertGuestTopic(
        ctx.episodeId,
        nanoid(),
        bodyParsed.data.text ?? "",
        bodyParsed.data.tag,
        identity.submittedBy,
      );
      broadcastShowNotesUpdate(ctx.episodeId);
      return reply.status(201).send(toGuestTopic(item));
    },
  );

  app.patch(
    "/call/meetings/by-token/:token/topics/:itemId",
    {
      schema: {
        tags: ["Call"],
        summary: "Update a guest discuss/avoid topic (public)",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = meetingTopicsItemIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = meetingTopicsUpdateBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const ctx = resolveMeetingContext(paramsParsed.data.token);
      if (!ctx) return reply.status(404).send({ error: "Meeting not found" });
      const closed = rejectIfClosed(ctx.meetingStatus, reply);
      if (closed) return closed;

      const identity = resolveSubmittedBy(ctx.meeting, bodyParsed.data);
      if (!identity.ok) {
        return reply.status(identity.status).send({ error: identity.error });
      }

      const owned = showNotesRepo.guestTopicOwnedBySubmitter(
        ctx.episodeId,
        paramsParsed.data.itemId,
        identity.submittedBy,
      );
      if (!owned) return reply.status(404).send({ error: "Topic not found" });

      // Host-promoted items are locked for guests (no text or tag edits).
      if (owned.tag === "none") {
        return reply.status(400).send({
          error: "This topic was added to show notes and can no longer be edited",
        });
      }

      const updated = showNotesRepo.updateItem(ctx.episodeId, paramsParsed.data.itemId, {
        ...(bodyParsed.data.text !== undefined && { text: bodyParsed.data.text }),
        ...(bodyParsed.data.tag !== undefined && { tag: bodyParsed.data.tag }),
      });
      if (!updated) return reply.status(404).send({ error: "Topic not found" });
      broadcastShowNotesUpdate(ctx.episodeId);
      return toGuestTopic(updated);
    },
  );

  app.put(
    "/call/meetings/by-token/:token/topics/reorder",
    {
      schema: {
        tags: ["Call"],
        summary: "Reorder guest discuss/avoid topics (public)",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = meetingTopicsTokenParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = meetingTopicsReorderBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const ctx = resolveMeetingContext(paramsParsed.data.token);
      if (!ctx) return reply.status(404).send({ error: "Meeting not found" });
      const closed = rejectIfClosed(ctx.meetingStatus, reply);
      if (closed) return closed;

      const identity = resolveSubmittedBy(ctx.meeting, bodyParsed.data);
      if (!identity.ok) {
        return reply.status(identity.status).send({ error: identity.error });
      }

      try {
        const items = showNotesRepo
          .reorderGuestTopicsForSubmitter(
            ctx.episodeId,
            identity.submittedBy,
            bodyParsed.data.itemIds,
          )
          .map(toGuestTopic);
        broadcastShowNotesUpdate(ctx.episodeId);
        return { items };
      } catch {
        return reply.status(400).send({ error: "Invalid reorder" });
      }
    },
  );

  app.delete(
    "/call/meetings/by-token/:token/topics/:itemId",
    {
      schema: {
        tags: ["Call"],
        summary: "Delete a guest discuss/avoid topic (public)",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = meetingTopicsItemIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const queryParsed = meetingTopicsIdentitySchema.safeParse(request.query ?? {});
      if (!queryParsed.success) {
        return reply.status(400).send({
          error: queryParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const ctx = resolveMeetingContext(paramsParsed.data.token);
      if (!ctx) return reply.status(404).send({ error: "Meeting not found" });
      const closed = rejectIfClosed(ctx.meetingStatus, reply);
      if (closed) return closed;

      const identity = resolveSubmittedBy(ctx.meeting, queryParsed.data);
      if (!identity.ok) {
        return reply.status(identity.status).send({ error: identity.error });
      }

      const owned = showNotesRepo.guestTopicOwnedBySubmitter(
        ctx.episodeId,
        paramsParsed.data.itemId,
        identity.submittedBy,
      );
      if (!owned) return reply.status(404).send({ error: "Topic not found" });

      const ok = showNotesRepo.deleteItem(ctx.episodeId, paramsParsed.data.itemId);
      if (!ok) return reply.status(404).send({ error: "Topic not found" });
      broadcastShowNotesUpdate(ctx.episodeId);
      return { ok: true };
    },
  );
}
