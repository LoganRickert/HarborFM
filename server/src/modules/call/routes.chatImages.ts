import type { FastifyInstance } from "fastify";
import { basename, dirname } from "path";
import { existsSync } from "fs";
import send from "@fastify/send";
import {
  CALL_CHAT_IMAGE_UPLOAD_IP_MAX,
  CALL_CHAT_IMAGE_UPLOAD_MAX,
  CALL_CHAT_IMAGE_UPLOAD_WINDOW_MS,
} from "../../config.js";
import { getClientIp } from "../../services/loginAttempts.js";
import { checkKeyRateLimit } from "../../services/rateLimit.js";
import { getSessionById, getSessionByToken } from "../../services/callSession.js";
import { assertPathUnder } from "../../services/paths.js";
import {
  callChatImageAbsolutePath,
  callChatImageUrl,
  callChatImagesDir,
  validateAndStoreCallChatImage,
} from "./chatImages.js";

export async function registerCallChatImageRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/call/chat-images",
    {
      schema: {
        tags: ["Call"],
        summary: "Upload an ephemeral call chat image",
        description:
          "Requires a live call join token and participant id. Images are deleted when the call ends.",
        security: [],
        consumes: ["multipart/form-data"],
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              url: { type: "string" },
            },
          },
          400: { description: "Validation failed" },
          403: { description: "Not in live call" },
          429: { description: "Rate limited" },
        },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.status(400).send({ error: "Expected multipart upload" });
      }

      let token = "";
      let participantId = "";
      let image: { buffer: Buffer; mimetype: string } | null = null;

      for await (const part of request.parts()) {
        if (part.type === "file") {
          const buffer = await part.toBuffer();
          if (
            buffer.length > 0 &&
            (part.fieldname === "image" ||
              part.fieldname === "file" ||
              (part.mimetype || "").startsWith("image/"))
          ) {
            image = {
              buffer,
              mimetype: part.mimetype || "image/jpeg",
            };
          }
        } else {
          const value =
            typeof part.value === "string" ? part.value.trim() : "";
          if (part.fieldname === "token") token = value;
          if (part.fieldname === "participantId") participantId = value;
        }
      }

      if (!token || !participantId) {
        return reply
          .status(400)
          .send({ error: "token and participantId are required" });
      }
      if (!image) {
        return reply.status(400).send({ error: "Image file is required" });
      }

      const session = getSessionByToken(token);
      if (!session || session.ended) {
        return reply.status(403).send({ error: "Call is not live" });
      }
      const participant = session.participants.find((p) => p.id === participantId);
      if (!participant) {
        return reply.status(403).send({ error: "Not a call participant" });
      }

      const participantLimit = checkKeyRateLimit({
        key: `call-chat-image:participant:${session.sessionId}:${participantId}`,
        windowMs: CALL_CHAT_IMAGE_UPLOAD_WINDOW_MS,
        max: CALL_CHAT_IMAGE_UPLOAD_MAX,
        actionLabel: "upload call chat images",
      });
      if (!participantLimit.ok) {
        return reply
          .status(429)
          .header("Retry-After", String(participantLimit.retryAfterSec))
          .send({ error: participantLimit.error });
      }
      const ip = getClientIp(request);
      const ipLimit = checkKeyRateLimit({
        key: `call-chat-image:ip:${ip}`,
        windowMs: CALL_CHAT_IMAGE_UPLOAD_WINDOW_MS,
        max: CALL_CHAT_IMAGE_UPLOAD_IP_MAX,
        actionLabel: "upload call chat images",
      });
      if (!ipLimit.ok) {
        return reply
          .status(429)
          .header("Retry-After", String(ipLimit.retryAfterSec))
          .send({ error: ipLimit.error });
      }

      const stored = await validateAndStoreCallChatImage({
        sessionId: session.sessionId,
        buffer: image.buffer,
        mimetype: image.mimetype,
      });
      if ("error" in stored) {
        return reply.status(400).send({ error: stored.error });
      }

      return {
        id: stored.id,
        url: callChatImageUrl(session.sessionId, stored.id, session.token),
      };
    },
  );

  app.get(
    "/call/chat-images/:sessionId/:imageId",
    {
      schema: {
        tags: ["Call"],
        summary: "Serve a live call chat image",
        description:
          "Available only while the call session is live. Returns 404 after the call ends.",
        security: [],
        params: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            imageId: { type: "string" },
          },
          required: ["sessionId", "imageId"],
        },
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
        response: {
          200: { description: "JPEG image" },
          206: { description: "Partial content" },
          416: { description: "Range not satisfiable" },
          404: { description: "Not found or call ended" },
        },
      },
    },
    async (request, reply) => {
      const { sessionId, imageId } = request.params as {
        sessionId: string;
        imageId: string;
      };
      const token = String(
        (request.query as { token?: string }).token || "",
      ).trim();
      if (!token) {
        return reply.status(404).send({ error: "Not found" });
      }

      const session = getSessionById(sessionId);
      if (!session || session.ended || session.token !== token) {
        return reply.status(404).send({ error: "Not found" });
      }

      let abs: string;
      let dir: string;
      try {
        abs = callChatImageAbsolutePath(sessionId, imageId);
        dir = callChatImagesDir(sessionId);
        abs = assertPathUnder(abs, dir);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      if (!existsSync(abs)) {
        return reply.status(404).send({ error: "Not found" });
      }

      const result = await send(request.raw, basename(abs), {
        root: dirname(abs),
        contentType: false,
        acceptRanges: true,
        cacheControl: false,
      });
      if (result.type === "error") {
        return reply.status(404).send({ error: "Not found" });
      }
      reply.status(result.statusCode as 200 | 206 | 416);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined && key.toLowerCase() !== "cache-control") {
          reply.header(key, value);
        }
      }
      reply.header("Content-Type", "image/jpeg");
      reply.header("Cache-Control", "private, no-store");
      return reply.send(result.stream);
    },
  );
}
