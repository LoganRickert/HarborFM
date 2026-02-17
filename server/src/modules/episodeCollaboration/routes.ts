import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { requireAuth } from "../../plugins/auth.js";
import { canAccessEpisode } from "../../services/access.js";
import {
  subscribeEpisode,
  unsubscribeEpisode,
} from "../../services/episodeBroadcast.js";

export async function episodeCollaborationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/episodes/:episodeId/ws",
    {
      websocket: true,
      preHandler: [requireAuth],
    },
    (socket: WebSocket, req: FastifyRequest) => {
      const { episodeId } = req.params as { episodeId: string };
      const userId = req.userId;

      const access = canAccessEpisode(userId, episodeId);
      if (!access) {
        socket.close();
        return;
      }

      const podcastId = access.podcastId;
      subscribeEpisode(episodeId, podcastId, userId, socket);

      const handleClose = () => {
        unsubscribeEpisode(socket);
      };

      socket.on("close", handleClose);
      socket.on("error", handleClose);
    },
  );
}
