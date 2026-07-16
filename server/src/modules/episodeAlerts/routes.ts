import type { FastifyInstance, FastifyReply } from "fastify";
import {
  episodeAlertsSettingsPatchSchema,
  episodeAlertDestinationCreateSchema,
  episodeAlertDestinationUpdateSchema,
} from "@harborfm/shared";
import {
  requireAuth,
  requireNotReadOnly,
} from "../../plugins/auth.js";
import {
  getPodcastRole,
  canEditEpisodeOrPodcastMetadata,
} from "../../services/access.js";
import { assertSafeId } from "../../services/paths.js";
import { getUserCanEpisodeAlert } from "./canEpisodeAlert.js";
import * as repo from "./repo.js";
import { episodeAlertsEmailAvailable } from "./dispatch.js";

function requireCanEpisodeAlert(userId: string, reply: FastifyReply): boolean {
  if (!getUserCanEpisodeAlert(userId)) {
    void reply
      .code(403)
      .send({ error: "Episode alerts are not enabled for this account" });
    return false;
  }
  return true;
}

async function requirePodcastEditor(
  userId: string,
  podcastId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    assertSafeId(podcastId, "podcastId");
  } catch {
    void reply.code(400).send({ error: "Invalid podcast id" });
    return false;
  }
  const role = getPodcastRole(userId, podcastId);
  if (!role || !canEditEpisodeOrPodcastMetadata(role)) {
    void reply.code(403).send({ error: "Permission denied" });
    return false;
  }
  return true;
}

export async function episodeAlertRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/episode-alerts",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episode Alerts"],
        summary: "Get episode alert settings and destinations for a show",
      },
    },
    async (request, reply) => {
      if (!requireCanEpisodeAlert(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      if (!(await requirePodcastEditor(request.userId!, podcastId, reply))) {
        return;
      }
      const settings = repo.getPodcastAlertSettings(podcastId);
      if (!settings) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const destinations = repo.listDestinations(podcastId).map(repo.toDestinationApi);
      const listCounts = repo.countVerifiedAlertSubscribers(podcastId);
      return reply.send({
        settings: {
          episodeAlertsEnabled: settings.episodeAlertsEnabled,
          episodeAlertsCheckoutList: settings.episodeAlertsCheckoutList,
          episodeAlertsMailingAddress: settings.episodeAlertsMailingAddress,
        },
        destinations,
        listCounts,
        emailAvailable: episodeAlertsEmailAvailable(podcastId),
      });
    },
  );

  app.patch(
    "/podcasts/:podcastId/episode-alerts",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Alerts"],
        summary: "Update episode alert show settings",
      },
    },
    async (request, reply) => {
      if (!requireCanEpisodeAlert(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      if (!(await requirePodcastEditor(request.userId!, podcastId, reply))) {
        return;
      }
      const parsed = episodeAlertsSettingsPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const settings = repo.updatePodcastAlertSettings(podcastId, parsed.data);
      if (!settings) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      return reply.send({
        settings: {
          episodeAlertsEnabled: settings.episodeAlertsEnabled,
          episodeAlertsCheckoutList: settings.episodeAlertsCheckoutList,
          episodeAlertsMailingAddress: settings.episodeAlertsMailingAddress,
        },
      });
    },
  );

  app.post(
    "/podcasts/:podcastId/episode-alerts/destinations",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Alerts"],
        summary: "Create an episode alert destination",
      },
    },
    async (request, reply) => {
      if (!requireCanEpisodeAlert(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      if (!(await requirePodcastEditor(request.userId!, podcastId, reply))) {
        return;
      }
      const parsed = episodeAlertDestinationCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const row = repo.createDestination({
        podcastId,
        name: parsed.data.name,
        type: parsed.data.type,
        enabled: parsed.data.enabled,
        episodeScope: parsed.data.episodeScope,
        config: parsed.data.config as Record<string, unknown>,
      });
      return reply.code(201).send({ destination: repo.toDestinationApi(row) });
    },
  );

  app.patch(
    "/podcasts/:podcastId/episode-alerts/destinations/:destinationId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Alerts"],
        summary: "Update an episode alert destination",
      },
    },
    async (request, reply) => {
      if (!requireCanEpisodeAlert(request.userId!, reply)) return;
      const { podcastId, destinationId } = request.params as {
        podcastId: string;
        destinationId: string;
      };
      if (!(await requirePodcastEditor(request.userId!, podcastId, reply))) {
        return;
      }
      try {
        assertSafeId(destinationId, "destinationId");
      } catch {
        return reply.code(400).send({ error: "Invalid destination id" });
      }
      const parsed = episodeAlertDestinationUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const row = repo.updateDestination(podcastId, destinationId, {
        name: parsed.data.name,
        enabled: parsed.data.enabled,
        episodeScope: parsed.data.episodeScope,
        config: parsed.data.config as Record<string, unknown> | undefined,
      });
      if (!row) {
        return reply.code(404).send({ error: "Destination not found" });
      }
      return reply.send({ destination: repo.toDestinationApi(row) });
    },
  );

  app.delete(
    "/podcasts/:podcastId/episode-alerts/destinations/:destinationId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episode Alerts"],
        summary: "Delete an episode alert destination",
      },
    },
    async (request, reply) => {
      if (!requireCanEpisodeAlert(request.userId!, reply)) return;
      const { podcastId, destinationId } = request.params as {
        podcastId: string;
        destinationId: string;
      };
      if (!(await requirePodcastEditor(request.userId!, podcastId, reply))) {
        return;
      }
      try {
        assertSafeId(destinationId, "destinationId");
      } catch {
        return reply.code(400).send({ error: "Invalid destination id" });
      }
      const ok = repo.deleteDestination(podcastId, destinationId);
      if (!ok) {
        return reply.code(404).send({ error: "Destination not found" });
      }
      return reply.code(204).send();
    },
  );
}
