import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { canAccessEpisode, canEditSegments } from "../../services/access.js";
import {
  showNotesEpisodeIdParamSchema,
  showNotesItemIdParamSchema,
  showNotesPatchBodySchema,
  showNotesCreateItemBodySchema,
  showNotesUpdateItemBodySchema,
  showNotesReorderBodySchema,
  SHOW_NOTES_DURATION_OPTIONS,
} from "@harborfm/shared";
import * as repo from "./repo.js";
import { broadcastShowNotesUpdate } from "./broadcast.js";

function isValidDuration(v: number | null | undefined): boolean {
  if (v == null) return true;
  return (SHOW_NOTES_DURATION_OPTIONS as readonly number[]).includes(v);
}

export async function registerShowNotesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/episodes/:id/show-notes",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Show Notes"],
        summary: "List show notes items",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const parsed = showNotesEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      return repo.getShowNotesForEpisode(episodeId);
    },
  );

  app.patch(
    "/episodes/:id/show-notes",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Show Notes"],
        summary: "Update show notes settings",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = showNotesEpisodeIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = showNotesPatchBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      repo.setGuestVisible(episodeId, bodyParsed.data.guestVisible);
      broadcastShowNotesUpdate(episodeId);
      return repo.getShowNotesForEpisode(episodeId);
    },
  );

  app.post(
    "/episodes/:id/show-notes/items",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Show Notes"],
        summary: "Add show notes item",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = showNotesEpisodeIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = showNotesCreateItemBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const id = nanoid();
      const position = repo.getNextPosition(episodeId);
      const item = repo.insertItem(episodeId, id, bodyParsed.data.text ?? "", position, {
        tag: bodyParsed.data.tag ?? "none",
        submittedBy: bodyParsed.data.submittedBy ?? null,
      });
      broadcastShowNotesUpdate(episodeId);
      return reply.status(201).send(item);
    },
  );

  app.patch(
    "/episodes/:id/show-notes/items/:itemId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Show Notes"],
        summary: "Update show notes item",
        params: {
          type: "object",
          properties: { id: { type: "string" }, itemId: { type: "string" } },
          required: ["id", "itemId"],
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = showNotesItemIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = showNotesUpdateItemBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId, itemId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const { durationMin, text, checked, tag, submittedBy } = bodyParsed.data;
      if (!isValidDuration(durationMin)) {
        return reply.status(400).send({ error: "Invalid durationMin" });
      }
      const updated = repo.updateItem(episodeId, itemId, {
        ...(text !== undefined && { text }),
        ...(durationMin !== undefined && { durationMin }),
        ...(checked !== undefined && { checked }),
        ...(tag !== undefined && { tag }),
        ...(submittedBy !== undefined && { submittedBy }),
      });
      if (!updated) return reply.status(404).send({ error: "Item not found" });
      broadcastShowNotesUpdate(episodeId);
      return updated;
    },
  );

  app.put(
    "/episodes/:id/show-notes/items/reorder",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Show Notes"],
        summary: "Reorder show notes items",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = showNotesEpisodeIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const bodyParsed = showNotesReorderBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      try {
        // Prefer notes-only reorder when the client sends only tag=none ids.
        const all = repo.listItemsForEpisode(episodeId);
        const noteIds = new Set(all.filter((i) => i.tag === "none").map((i) => i.id));
        const ids = bodyParsed.data.itemIds;
        const notesOnly =
          ids.length === noteIds.size && ids.every((id) => noteIds.has(id));
        const items = notesOnly
          ? repo.reorderNotesItems(episodeId, ids)
          : repo.reorderItems(episodeId, ids);
        broadcastShowNotesUpdate(episodeId);
        return { items };
      } catch {
        return reply.status(400).send({ error: "Invalid reorder" });
      }
    },
  );

  app.post(
    "/episodes/:id/show-notes/items/:itemId/add-to-notes",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Show Notes"],
        summary: "Promote a discuss submission into Notes",
        params: {
          type: "object",
          properties: { id: { type: "string" }, itemId: { type: "string" } },
          required: ["id", "itemId"],
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = showNotesItemIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId, itemId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const item = repo.promoteDiscussTopicToNotes(episodeId, itemId);
      if (!item) {
        return reply.status(400).send({
          error: "Only Topic To Discuss submissions can be added to Notes",
        });
      }
      broadcastShowNotesUpdate(episodeId);
      return item;
    },
  );

  app.delete(
    "/episodes/:id/show-notes/items/:itemId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Show Notes"],
        summary: "Delete show notes item",
        params: {
          type: "object",
          properties: { id: { type: "string" }, itemId: { type: "string" } },
          required: ["id", "itemId"],
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = showNotesItemIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          error: paramsParsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const { id: episodeId, itemId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const ok = repo.deleteItem(episodeId, itemId);
      if (!ok) return reply.status(404).send({ error: "Item not found" });
      broadcastShowNotesUpdate(episodeId);
      return { ok: true };
    },
  );
}
