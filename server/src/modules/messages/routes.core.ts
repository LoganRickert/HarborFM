import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { isAdmin } from "../../services/access.js";
import { toContactMessage } from "./utils.js";
import * as repo from "./repo.js";

export async function registerCoreRoutes(app: FastifyInstance) {
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
      const userId = request.userId as string;
      const isAdminUser = isAdmin(userId);

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
      const search = query?.search?.trim() ?? "";
      const sort = query?.sort === "oldest" ? "oldest" : "newest";

      const { rows, total } = repo.listMessages(userId, isAdminUser, {
        page,
        limit,
        search,
        sort,
      });

      return {
        messages: rows.map(toContactMessage),
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
