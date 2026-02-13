import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { db } from "../../db/index.js";

export interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  message: string;
  created_at: string;
  podcast_id: string | null;
  episode_id: string | null;
  podcast_title: string | null;
  episode_title: string | null;
}

export async function messagesRoutes(app: FastifyInstance) {
  app.get(
    "/messages",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Messages"],
        summary: "List contact messages",
        description:
          "Paginated list of contact form messages. Admins see all; others see only messages for their podcasts.",
        querystring: {
          type: "object",
          properties: {
            page: { type: "string" },
            limit: { type: "string" },
            search: { type: "string" },
            sort: { type: "string", enum: ["newest", "oldest"] },
          },
        },
        response: { 200: { description: "Messages and pagination" } },
      },
    },
    async (request) => {
      const userId = request.userId;
      const user = db
        .prepare("SELECT role FROM users WHERE id = ?")
        .get(userId) as { role: string } | undefined;
      const isAdmin = user?.role === "admin";

      const query = request.query as
        | {
            page?: string;
            limit?: string;
            search?: string;
            sort?: string;
          }
        | undefined;
      const page = Math.max(1, parseInt(query?.page ?? "1", 10) || 1);
      const limit = Math.min(
        100,
        Math.max(10, parseInt(query?.limit ?? "50", 10) || 50),
      );
      const offset = (page - 1) * limit;
      const search = query?.search?.trim() ?? "";
      const sort = query?.sort === "oldest" ? "oldest" : "newest";
      const order = sort === "oldest" ? "ASC" : "DESC";

      const searchParam = search ? `%${search}%` : null;
      const ownerFilter = isAdmin
        ? ""
        : " AND m.podcast_id IN (SELECT id FROM podcasts WHERE owner_user_id = ?)";

      let whereClause = "";
      const countParams: unknown[] = [];
      const listParams: unknown[] = [];

      if (search) {
        whereClause = `WHERE (m.name LIKE ? OR m.email LIKE ? OR m.message LIKE ?)${ownerFilter}`;
        countParams.push(searchParam, searchParam, searchParam);
        listParams.push(searchParam, searchParam, searchParam);
        if (!isAdmin) {
          countParams.push(userId);
          listParams.push(userId);
        }
      } else {
        if (!isAdmin) {
          whereClause = `WHERE 1=1${ownerFilter}`;
          countParams.push(userId);
          listParams.push(userId);
        }
      }
      listParams.push(limit, offset);

      const countQuery = db.prepare(
        `SELECT COUNT(*) as count FROM contact_messages m ${whereClause}`,
      );
      const totalCount = (
        countParams.length > 0
          ? countQuery.get(...countParams)
          : countQuery.get()
      ) as { count: number };
      const total = totalCount.count;

      const orderClause = `ORDER BY m.created_at ${order} LIMIT ? OFFSET ?`;
      const selectStr = `SELECT m.id, m.name, m.email, m.message, m.created_at, m.podcast_id, m.episode_id, p.title as podcast_title, e.title as episode_title FROM contact_messages m LEFT JOIN podcasts p ON m.podcast_id = p.id LEFT JOIN episodes e ON m.episode_id = e.id ${whereClause} ${orderClause}`;
      const rows = db
        .prepare(selectStr)
        .all(...listParams) as ContactMessageRow[];

      return {
        messages: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  );
}
