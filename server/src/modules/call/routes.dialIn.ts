import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DIAL_IN_FAKE, DIAL_IN_WEBHOOK_RATE_LIMIT_MAX } from "../../config.js";
import {
  findSessionByParticipantId,
  getSessionById,
  removeParticipant,
} from "../../services/callSession.js";
import { broadcastToSession } from "./shared.js";
import {
  admitPhoneByJoinCode,
  leaveWebrtcDialIn,
  muteWebrtcDialIn,
} from "./dialIn/admitPhone.js";
import { getFakeCallControl } from "./dialIn/callControl.js";
import {
  getDialInLeg,
  handleDialInWebhook,
  hangUpAllDialInLegs,
  hangUpDialInLegByParticipant,
  listDialInLegs,
  resetDialInIvrState,
  type TelnyxWebhookEnvelope,
} from "./dialIn/ivr.js";
import { assertFakeDialInAllowed, getDialInPublicConfig, isDialInWebhookEnabled } from "./dialIn/config.js";
import { verifyTelnyxWebhookSignature } from "./dialIn/telnyxWebhook.js";

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/** Hang up all dial-in legs for a mediasoup room (call end). */
export async function hangUpFakeDialInsForRoom(roomId: string | undefined): Promise<void> {
  if (!roomId) return;
  await hangUpAllDialInLegs();
  await leaveWebrtcDialIn({ roomId, allInRoom: true });
}

/** Pause/resume phone audio when host mutes a dial-in participant. */
export async function setPhoneDialInMuted(
  participantId: string,
  muted: boolean,
): Promise<boolean> {
  return muteWebrtcDialIn(participantId, muted);
}

/** Remove a dial-in participant from media + session roster; hang up Telnyx leg if any. */
export async function kickPhoneDialIn(
  sessionId: string,
  participantId: string,
): Promise<boolean> {
  const session = getSessionById(sessionId);
  const p = session?.participants.find((x) => x.id === participantId);
  await hangUpDialInLegByParticipant(participantId);
  await leaveWebrtcDialIn({ participantId });
  if (!p) return false;
  removeParticipant(sessionId, participantId);
  broadcastToSession(sessionId, {
    type: "participants",
    participants: [...(getSessionById(sessionId)?.participants ?? [])],
  });
  return true;
}

export async function registerDialInRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/call/dial-in/fake/join",
    {
      schema: {
        tags: ["Call"],
        summary: "Fake phone dial-in join (local/e2e)",
        description:
          "Inject a fake phone participant into a live call by join code. Requires DIAL_IN_FAKE=1. No Telnyx.",
        body: {
          type: "object",
          properties: {
            joinCode: { type: "string" },
            displayName: { type: "string" },
            toneHz: { type: "number" },
          },
          required: ["joinCode"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const gate = assertFakeDialInAllowed();
      if (!gate.ok) {
        return reply.status(gate.status).send({ error: gate.error });
      }
      const body = request.body as {
        joinCode?: string;
        displayName?: string;
        toneHz?: number;
      };
      const result = await admitPhoneByJoinCode({
        joinCode: typeof body.joinCode === "string" ? body.joinCode : "",
        displayName: body.displayName,
        toneHz: body.toneHz,
        mediaMode: "fake",
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error });
      }
      return reply.send(result);
    },
  );

  app.post(
    "/call/dial-in/fake/leave",
    {
      schema: {
        tags: ["Call"],
        summary: "Fake phone dial-in leave (local/e2e)",
        body: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            participantId: { type: "string" },
            dialInId: { type: "string" },
          },
          required: ["participantId"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!DIAL_IN_FAKE) {
        return reply.status(404).send({ error: "Fake dial-in disabled" });
      }
      const body = request.body as {
        sessionId?: string;
        participantId?: string;
        dialInId?: string;
      };
      const participantId =
        typeof body.participantId === "string" ? body.participantId.trim() : "";
      if (!participantId) {
        return reply.status(400).send({ error: "participantId is required" });
      }

      let sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      if (!sessionId) {
        sessionId = findSessionByParticipantId(participantId)?.sessionId ?? "";
      }

      await leaveWebrtcDialIn({
        dialInId: typeof body.dialInId === "string" ? body.dialInId.trim() : undefined,
        participantId,
      });

      if (sessionId) {
        removeParticipant(sessionId, participantId);
        const session = getSessionById(sessionId);
        if (session) {
          broadcastToSession(sessionId, {
            type: "participants",
            participants: [...session.participants],
          });
        }
      }

      return reply.send({ ok: true });
    },
  );

  app.get(
    "/call/dial-in/config",
    {
      schema: {
        tags: ["Call"],
        summary: "Public dial-in config for host/guest UI (no secrets)",
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const cfg = getDialInPublicConfig();
      return reply.send({
        enabled: cfg.enabled,
        phoneNumber: cfg.phoneNumber,
      });
    },
  );

  // Isolated plugin so the buffer JSON parser only applies to the Telnyx webhook.
  await app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (req, body, done) => {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        (req as RawBodyRequest).rawBody = buf;
        try {
          const json = JSON.parse(buf.toString("utf8")) as unknown;
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    webhookApp.post(
      "/call/dial-in/webhook",
      {
        config: {
          rateLimit: {
            max: DIAL_IN_WEBHOOK_RATE_LIMIT_MAX,
            timeWindow: "1 minute",
          },
        },
        schema: {
          tags: ["Call"],
          summary: "Telnyx-shaped dial-in Call Control webhook",
          description:
            "IVR join-code flow. With a Telnyx API key, requires a valid Ed25519 signature and starts bidirectional media streaming; with DIAL_IN_FAKE only, uses FakeDialIn.",
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!isDialInWebhookEnabled()) {
          return reply.status(404).send({
            error:
              "Dial-in webhook disabled. Enable phone dial-in in Settings and set a Telnyx API key (or DIAL_IN_FAKE=1).",
          });
        }

        const rawBody = (request as RawBodyRequest).rawBody;
        if (!rawBody) {
          return reply.status(400).send({ error: "Missing raw body" });
        }

        const sigHeader = request.headers["telnyx-signature-ed25519"];
        const tsHeader = request.headers["telnyx-timestamp"];
        const verified = verifyTelnyxWebhookSignature({
          rawBody,
          signatureHeader: typeof sigHeader === "string" ? sigHeader : undefined,
          timestampHeader: typeof tsHeader === "string" ? tsHeader : undefined,
        });
        if (!verified.ok) {
          return reply.status(verified.status).send({ error: verified.error });
        }

        try {
          const result = await handleDialInWebhook(
            (request.body ?? {}) as TelnyxWebhookEnvelope,
          );
          if (!result.ok) {
            return reply.status(400).send({ error: result.error });
          }
          return reply.send({ ok: true });
        } catch (err) {
          request.log.warn({ err }, "Dial-in webhook handler failed");
          // Still 200 so Telnyx does not retry forever on app bugs; hang-up timeout covers stuck legs.
          return reply.status(200).send({
            ok: false,
            error: err instanceof Error ? err.message : "Dial-in webhook failed",
          });
        }
      },
    );
  });

  app.get(
    "/call/dial-in/fake/call-control",
    {
      schema: {
        tags: ["Call"],
        summary: "Inspect Fake Call Control commands (e2e)",
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!DIAL_IN_FAKE) {
        return reply.status(404).send({ error: "Fake dial-in disabled" });
      }
      return reply.send({
        commands: getFakeCallControl().commands,
        legs: listDialInLegs(),
      });
    },
  );

  app.post(
    "/call/dial-in/fake/ivr/reset",
    {
      schema: {
        tags: ["Call"],
        summary: "Reset Fake IVR + Call Control state (e2e)",
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!DIAL_IN_FAKE) {
        return reply.status(404).send({ error: "Fake dial-in disabled" });
      }
      resetDialInIvrState();
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/call/dial-in/fake/legs/:callControlId",
    {
      schema: {
        tags: ["Call"],
        summary: "Get one Fake IVR leg by call_control_id (e2e)",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!DIAL_IN_FAKE) {
        return reply.status(404).send({ error: "Fake dial-in disabled" });
      }
      const { callControlId } = request.params as { callControlId: string };
      const leg = getDialInLeg(callControlId);
      if (!leg) return reply.status(404).send({ error: "Leg not found" });
      return reply.send({ leg });
    },
  );
}
