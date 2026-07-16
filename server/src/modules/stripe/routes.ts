import type { FastifyInstance, FastifyReply } from "fastify";
import {
  requireAuth,
  requireNotReadOnly,
} from "../../plugins/auth.js";
import {
  stripeCredentialsCreateSchema,
  stripeCredentialsUpdateSchema,
  podcastStripeAttachSchema,
  stripePlanCreateSchema,
  stripePlanUpdateSchema,
  stripeCouponCreateSchema,
  stripeCouponUpdateSchema,
} from "@harborfm/shared";
import {
  getPodcastRole,
  canEditEpisodeOrPodcastMetadata,
} from "../../services/access.js";
import { assertSafeId } from "../../services/paths.js";
import { getUserCanStripe } from "./canStripe.js";
import * as creds from "./credentials.js";
import * as plans from "./plans.js";
import * as coupons from "./coupons.js";
import * as refundRequests from "./refundRequests.js";
import * as ownerSubs from "./ownerSubscriptions.js";
import * as subs from "./subscriptions.js";
import { verifyStripeCredentialKeys } from "./verify.js";

function requireCanStripe(userId: string, reply: FastifyReply): boolean {
  if (!getUserCanStripe(userId)) {
    void reply.code(403).send({ error: "Stripe is not enabled for this account" });
    return false;
  }
  return true;
}

function httpErrorStatus(err: unknown): number {
  if (
    err &&
    typeof err === "object" &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
  ) {
    return (err as { statusCode: number }).statusCode;
  }
  return 500;
}

export async function stripeRoutes(app: FastifyInstance) {
  app.get(
    "/stripe/status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "Stripe permission + configuration status for current user",
        response: {
          200: {
            type: "object",
            properties: {
              canStripe: { type: "boolean" },
              configured: { type: "boolean" },
            },
            required: ["canStripe", "configured"],
          },
          403: { description: "User does not have Stripe permission" },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const configured =
        creds.countConfiguredForOwner(request.userId!) > 0;
      return reply.send({ canStripe: true, configured });
    },
  );

  app.get(
    "/stripe/credentials",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "List Stripe credential packs owned by current user",
        response: {
          200: { description: "Credential packs (secrets redacted)" },
          403: { description: "Stripe not enabled" },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const rows = creds.listByOwner(request.userId!);
      return reply.send({
        credentials: rows.map((r) =>
          creds.toCredentialsApi(r, { includePublishable: true }),
        ),
      });
    },
  );

  app.post(
    "/stripe/credentials",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Create a Stripe credential pack for current user",
        body: {
          type: "object",
          properties: {
            displayName: { type: "string" },
            mode: { type: "string", enum: ["test", "live"] },
            testSecretKey: { type: "string" },
            testPublishableKey: { type: "string" },
            testWebhookSecret: { type: "string" },
            liveSecretKey: { type: "string" },
            livePublishableKey: { type: "string" },
            liveWebhookSecret: { type: "string" },
          },
        },
        response: {
          201: { description: "Created credential pack" },
          400: { description: "Validation failed" },
          403: { description: "Stripe not enabled or read-only" },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const parsed = stripeCredentialsCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const row = creds.createCredentials(request.userId!, parsed.data);
      return reply
        .code(201)
        .send(creds.toCredentialsApi(row, { includePublishable: true }));
    },
  );

  app.get(
    "/stripe/credentials/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "Get a Stripe credential pack (owner only)",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Credential pack" },
          400: { description: "Invalid id" },
          403: { description: "Stripe not enabled" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const row = creds.getById(id);
      if (!row || row.ownerUserId !== request.userId) {
        return reply.code(404).send({ error: "Credentials not found" });
      }
      return reply.send(
        creds.toCredentialsApi(row, { includePublishable: true }),
      );
    },
  );

  app.patch(
    "/stripe/credentials/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Update a Stripe credential pack (owner only)",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Updated credential pack" },
          400: { description: "Validation failed" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const existing = creds.getById(id);
      if (!existing || existing.ownerUserId !== request.userId) {
        return reply.code(404).send({ error: "Credentials not found" });
      }
      const parsed = stripeCredentialsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      if (
        request.body &&
        typeof request.body === "object" &&
        "mode" in (request.body as Record<string, unknown>)
      ) {
        return reply.code(400).send({
          error:
            "Account mode cannot be changed. Create a separate test or live account instead.",
        });
      }
      const row = creds.updateCredentials(id, parsed.data);
      if (!row) {
        return reply.code(404).send({ error: "Credentials not found" });
      }
      return reply.send(
        creds.toCredentialsApi(row, { includePublishable: true }),
      );
    },
  );

  app.post(
    "/stripe/credentials/:id/verify",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Verify restricted + publishable keys and required Write permissions",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Verification result" },
          400: { description: "Missing keys or invalid id" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
          500: { description: "Verification failed" },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const row = creds.getById(id);
      if (!row || row.ownerUserId !== request.userId) {
        return reply.code(404).send({ error: "Credentials not found" });
      }
      const mode = (row.mode === "live" ? "live" : "test") as "test" | "live";
      const secretKey = creds.getActiveSecretKey(row);
      const publishableKey = creds.getActivePublishableKey(row);
      if (!secretKey || !publishableKey) {
        return reply.code(400).send({
          error:
            "Restricted key and publishable key must both be saved before verification.",
        });
      }
      try {
        const result = await verifyStripeCredentialKeys({
          secretKey,
          publishableKey,
          mode,
        });
        if (result.ok) {
          creds.setCredentialsVerified(id, true);
        } else {
          creds.setCredentialsVerified(id, false);
        }
        return reply.send(result);
      } catch (err) {
        creds.setCredentialsVerified(id, false);
        const status = httpErrorStatus(err) as 400 | 403 | 404 | 500;
        return reply.code(status).send({
          error: err instanceof Error ? err.message : "Verification failed",
        });
      }
    },
  );

  app.delete(
    "/stripe/credentials/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Delete a Stripe credential pack (owner only)",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Deleted" },
          400: { description: "Invalid id" },
          403: { description: "Stripe not enabled" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { id } = request.params as { id: string };
      try {
        assertSafeId(id, "id");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const existing = creds.getById(id);
      if (!existing || existing.ownerUserId !== request.userId) {
        return reply.code(404).send({ error: "Credentials not found" });
      }
      creds.deleteCredentials(id, request.userId!);
      return reply.send({ ok: true });
    },
  );

  /** List show owner's packs (for owner/manager Payments UI). */
  app.get(
    "/podcasts/:podcastId/stripe/credentials",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "List Stripe packs owned by the show owner",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const podcast = creds.getPodcastStripeFields(podcastId);
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const rows = creds.listByOwner(podcast.ownerUserId);
      const includePublishable = true;
      return reply.send({
        credentials: rows.map((r) =>
          creds.toCredentialsApi(r, { includePublishable }),
        ),
        stripeCredentialsId: podcast.stripeCredentialsId,
        stripePaymentsEnabled: podcast.stripePaymentsEnabled,
        stripeCheckoutPaused: podcast.stripeCheckoutPaused,
        billingAnchor: podcast.billingAnchor,
        canEditPacks: podcast.ownerUserId === request.userId,
      });
    },
  );

  app.get(
    "/podcasts/:podcastId/stripe/status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "Stripe status for a show",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const podcast = creds.getPodcastStripeFields(podcastId);
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      let pack = null;
      if (podcast.stripeCredentialsId) {
        const row = creds.getById(podcast.stripeCredentialsId);
        if (row && row.ownerUserId === podcast.ownerUserId) {
          pack = creds.toCredentialsApi(row, { includePublishable: true });
        }
      }
      return reply.send({
        stripeCredentialsId: podcast.stripeCredentialsId,
        stripePaymentsEnabled: podcast.stripePaymentsEnabled,
        stripeCheckoutPaused: podcast.stripeCheckoutPaused,
        billingAnchor: podcast.billingAnchor,
        canEditPacks: podcast.ownerUserId === request.userId,
        credentials: pack,
      });
    },
  );

  app.patch(
    "/podcasts/:podcastId/stripe",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Attach Stripe credentials / enable payments on a show",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const podcast = creds.getPodcastStripeFields(podcastId);
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const parsed = podcastStripeAttachSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const {
        stripeCredentialsId,
        stripePaymentsEnabled,
        stripeCheckoutPaused,
        billingAnchor,
      } = parsed.data;
      if (stripeCredentialsId !== undefined && stripeCredentialsId !== null) {
        try {
          assertSafeId(stripeCredentialsId, "stripeCredentialsId");
        } catch (err) {
          return reply.code(400).send({
            error: err instanceof Error ? err.message : "Invalid id",
          });
        }
        const pack = creds.getById(stripeCredentialsId);
        if (!pack || pack.ownerUserId !== podcast.ownerUserId) {
          return reply.code(400).send({
            error:
              "Credentials must belong to the show owner",
          });
        }
        if (!pack.verified) {
          return reply.code(400).send({
            error:
              "Finish setup and verify this Stripe account before selecting it",
          });
        }
      }
      const nextCredentialsId =
        stripeCredentialsId !== undefined
          ? stripeCredentialsId
          : podcast.stripeCredentialsId;
      creds.attachToPodcast(
        podcastId,
        nextCredentialsId,
        stripePaymentsEnabled,
        billingAnchor,
        stripeCheckoutPaused,
      );
      const updated = creds.getPodcastStripeFields(podcastId)!;
      let packApi = null;
      if (updated.stripeCredentialsId) {
        const row = creds.getById(updated.stripeCredentialsId);
        if (row) {
          packApi = creds.toCredentialsApi(row, { includePublishable: true });
        }
      }
      return reply.send({
        stripeCredentialsId: updated.stripeCredentialsId,
        stripePaymentsEnabled: updated.stripePaymentsEnabled,
        stripeCheckoutPaused: updated.stripeCheckoutPaused,
        billingAnchor: updated.billingAnchor,
        credentials: packApi,
      });
    },
  );

  app.get(
    "/podcasts/:podcastId/stripe/plans",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "List Stripe plans for the show (active credential mode only)",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const podcast = creds.getPodcastStripeFields(podcastId);
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      let mode: "test" | "live" | undefined;
      if (podcast.stripeCredentialsId) {
        const pack = creds.getById(podcast.stripeCredentialsId);
        if (pack && pack.ownerUserId === podcast.ownerUserId) {
          mode = pack.mode === "live" ? "live" : "test";
        }
      }
      const rows = mode
        ? plans.listPlansForPodcast(podcastId, mode)
        : [];
      return reply.send({
        mode: mode ?? null,
        billingAnchor: podcast.billingAnchor,
        plans: rows.map(plans.toPlanApi),
        subscriberCounts: subs.countActiveByPlanKind(podcastId),
      });
    },
  );

  app.post(
    "/podcasts/:podcastId/stripe/plans",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Create a Stripe product/price plan for the show",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const parsed = stripePlanCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      try {
        const row = await plans.createPlan(podcastId, parsed.data);
        return reply.code(201).send(plans.toPlanApi(row));
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not create plan",
        });
      }
    },
  );

  app.patch(
    "/podcasts/:podcastId/stripe/plans/:planId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Update a Stripe plan for the show",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            planId: { type: "string" },
          },
          required: ["podcastId", "planId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, planId } = request.params as {
        podcastId: string;
        planId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(planId, "planId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const parsed = stripePlanUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      try {
        const row = await plans.updatePlan(podcastId, planId, parsed.data);
        return reply.send(plans.toPlanApi(row));
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not update plan",
        });
      }
    },
  );

  app.delete(
    "/podcasts/:podcastId/stripe/plans/:planId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Delete a Stripe plan for the show",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            planId: { type: "string" },
          },
          required: ["podcastId", "planId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, planId } = request.params as {
        podcastId: string;
        planId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(planId, "planId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      try {
        await plans.deletePlan(podcastId, planId);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not delete plan",
        });
      }
    },
  );

  app.get(
    "/podcasts/:podcastId/stripe/coupons",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "List Stripe coupons for the show (active credential mode)",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const podcast = creds.getPodcastStripeFields(podcastId);
      if (!podcast) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      let mode: "test" | "live" | undefined;
      if (podcast.stripeCredentialsId) {
        const pack = creds.getById(podcast.stripeCredentialsId);
        if (pack && pack.ownerUserId === podcast.ownerUserId) {
          mode = pack.mode === "live" ? "live" : "test";
        }
      }
      const rows = mode
        ? coupons.listCouponsForPodcast(podcastId, mode)
        : [];
      return reply.send({
        mode: mode ?? null,
        coupons: rows.map(coupons.toCouponApi),
      });
    },
  );

  app.post(
    "/podcasts/:podcastId/stripe/coupons",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Create a Stripe coupon + promotion code for the show",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const parsed = stripeCouponCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      try {
        const row = await coupons.createCoupon(podcastId, parsed.data);
        return reply.code(201).send(coupons.toCouponApi(row));
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not create coupon",
        });
      }
    },
  );

  app.patch(
    "/podcasts/:podcastId/stripe/coupons/:couponId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Update a Stripe coupon for the show",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            couponId: { type: "string" },
          },
          required: ["podcastId", "couponId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, couponId } = request.params as {
        podcastId: string;
        couponId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(couponId, "couponId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      const parsed = stripeCouponUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      try {
        const row = await coupons.updateCoupon(
          podcastId,
          couponId,
          parsed.data,
        );
        return reply.send(coupons.toCouponApi(row));
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not update coupon",
        });
      }
    },
  );

  app.delete(
    "/podcasts/:podcastId/stripe/coupons/:couponId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Delete a Stripe coupon for the show",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            couponId: { type: "string" },
          },
          required: ["podcastId", "couponId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, couponId } = request.params as {
        podcastId: string;
        couponId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(couponId, "couponId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      try {
        await coupons.deleteCoupon(podcastId, couponId);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not delete coupon",
        });
      }
    },
  );

  app.get(
    "/podcasts/:podcastId/stripe/refund-requests",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "List refund requests for the show",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      return reply.send({
        refundRequests: refundRequests.listForPodcast(podcastId),
      });
    },
  );

  app.post(
    "/podcasts/:podcastId/stripe/refund-requests/:requestId/approve",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Approve a refund request and refund via Stripe",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            requestId: { type: "string" },
          },
          required: ["podcastId", "requestId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, requestId } = request.params as {
        podcastId: string;
        requestId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(requestId, "requestId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      try {
        const result = await refundRequests.approveRefundRequest({
          podcastId,
          requestId,
          resolvedByUserId: request.userId!,
        });
        return reply.send({ refundRequest: result });
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not approve refund",
        });
      }
    },
  );

  app.post(
    "/podcasts/:podcastId/stripe/refund-requests/:requestId/reject",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Reject a refund request",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            requestId: { type: "string" },
          },
          required: ["podcastId", "requestId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, requestId } = request.params as {
        podcastId: string;
        requestId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(requestId, "requestId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      try {
        const result = await refundRequests.rejectRefundRequest({
          podcastId,
          requestId,
          resolvedByUserId: request.userId!,
        });
        return reply.send({ refundRequest: result });
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error: err instanceof Error ? err.message : "Could not reject refund",
        });
      }
    },
  );

  app.get(
    "/podcasts/:podcastId/stripe/subscriptions",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Stripe"],
        summary: "List active Stripe subscriptions for the show",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "number", minimum: 1, maximum: 100, default: 10 },
            offset: { type: "number", minimum: 0, default: 0 },
            q: { type: "string" },
            sort: {
              type: "string",
              enum: ["newest", "oldest"],
              default: "newest",
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId } = request.params as { podcastId: string };
      const {
        limit = 10,
        offset = 0,
        q,
        sort = "newest",
      } = request.query as {
        limit?: number;
        offset?: number;
        q?: string;
        sort?: "newest" | "oldest";
      };
      try {
        assertSafeId(podcastId, "podcastId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      return reply.send(
        ownerSubs.listActiveForPodcast({
          podcastId,
          limit,
          offset,
          q,
          sort,
        }),
      );
    },
  );

  app.post(
    "/podcasts/:podcastId/stripe/subscriptions/:subscriptionId/cancel-auto-renew",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary: "Turn off auto-renew (cancel at period end) for a subscription",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            subscriptionId: { type: "string" },
          },
          required: ["podcastId", "subscriptionId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, subscriptionId } = request.params as {
        podcastId: string;
        subscriptionId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(subscriptionId, "subscriptionId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      try {
        const subscription = await ownerSubs.cancelAutoRenew({
          podcastId,
          subscriptionId,
        });
        return reply.send({ subscription });
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error:
            err instanceof Error
              ? err.message
              : "Could not turn off auto-renew",
        });
      }
    },
  );

  app.delete(
    "/podcasts/:podcastId/stripe/subscriptions/:subscriptionId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Stripe"],
        summary:
          "Delete a local subscription row (cleanup; does not cancel in Stripe)",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            subscriptionId: { type: "string" },
          },
          required: ["podcastId", "subscriptionId"],
        },
      },
    },
    async (request, reply) => {
      if (!requireCanStripe(request.userId!, reply)) return;
      const { podcastId, subscriptionId } = request.params as {
        podcastId: string;
        subscriptionId: string;
      };
      try {
        assertSafeId(podcastId, "podcastId");
        assertSafeId(subscriptionId, "subscriptionId");
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid id" });
      }
      const role = getPodcastRole(request.userId!, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.code(404).send({ error: "Podcast not found" });
      }
      try {
        ownerSubs.deleteLocalSubscription({ podcastId, subscriptionId });
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(httpErrorStatus(err)).send({
          error:
            err instanceof Error
              ? err.message
              : "Could not delete subscription",
        });
      }
    },
  );
}
