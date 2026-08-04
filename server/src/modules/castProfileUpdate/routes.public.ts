import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync } from "fs";
import { basename, dirname, extname } from "path";
import send from "@fastify/send";
import {
  castProfileUpdateSubmitSchema,
  parseCastSocialLinks,
} from "@harborfm/shared";
import {
  API_PREFIX,
  CAST_PROFILE_UPDATE_IP_MAX,
  CAST_PROFILE_UPDATE_MAX,
  CAST_PROFILE_UPDATE_WINDOW_MS,
} from "../../config.js";
import { getClientIp } from "../../services/loginAttempts.js";
import { checkKeyRateLimit } from "../../services/rateLimit.js";
import {
  assertPathUnder,
  castPhotoDir,
  resolveDataPath,
} from "../../services/paths.js";
import { EXT_DOT_TO_MIMETYPE } from "../../utils/artwork.js";
import { absoluteOrigin } from "../call/meetingMail.js";
import { notifyHostsOfCastProfilePending } from "./notify.js";
import {
  castPendingPhotoDir,
  getPendingForCast,
  pendingSocialLinks,
  resolveCastProfileFromRawToken,
  upsertPending,
  validateAndStorePendingPhoto,
  type CastProfileCastContext,
  type CastProfilePendingRow,
} from "./repo.js";

function rawTokenFromQuery(query: unknown): string {
  const q = query as { token?: string | string[] };
  const raw = Array.isArray(q.token) ? q.token[0] : q.token;
  return typeof raw === "string" ? raw.trim() : "";
}

async function sendImageFile(
  request: FastifyRequest,
  reply: FastifyReply,
  absolutePath: string,
  allowedDir: string,
) {
  const safe = assertPathUnder(absolutePath, allowedDir);
  if (!existsSync(safe)) {
    return reply.status(404).send({ error: "Not found" });
  }
  const ext = extname(safe).toLowerCase();
  const contentType = EXT_DOT_TO_MIMETYPE[ext] || "image/jpeg";
  const result = await send(request.raw, basename(safe), {
    root: dirname(safe),
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
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "private, no-cache");
  return reply.send(result.stream);
}

function formDefaults(
  cast: CastProfileCastContext,
  pending: CastProfilePendingRow | undefined,
  token: string,
) {
  const enc = encodeURIComponent(token);
  if (pending) {
    const pendingPhotoVersion = encodeURIComponent(
      pending.updatedAt || pending.submittedAt || "",
    );
    return {
      name: pending.name,
      nickname: pending.nickname,
      description: pending.description,
      socialLinks: pendingSocialLinks(pending),
      timeZone: pending.timeZone?.trim() || null,
      photoUrl: pending.photoPath
        ? `/${API_PREFIX}/public/cast-profile-update/photo?token=${enc}&source=pending&v=${pendingPhotoVersion}`
        : cast.photoPath || cast.photoUrl
          ? `/${API_PREFIX}/public/cast-profile-update/photo?token=${enc}&source=current`
          : null,
      hasPending: true,
    };
  }
  return {
    name: cast.name,
    nickname: cast.nickname,
    description: cast.description,
    socialLinks: parseCastSocialLinks(cast.socialLinks),
    timeZone: cast.timeZone?.trim() || null,
    photoUrl:
      cast.photoPath || cast.photoUrl
        ? `/${API_PREFIX}/public/cast-profile-update/photo?token=${enc}&source=current`
        : null,
    hasPending: false,
  };
}

async function parseSubmitBody(request: {
  isMultipart: () => boolean;
  parts: () => AsyncIterableIterator<{
    type: string;
    fieldname: string;
    mimetype?: string;
    value?: unknown;
    toBuffer?: () => Promise<Buffer>;
  }>;
  body: unknown;
}): Promise<{
  fields: Record<string, unknown>;
  photo: { buffer: Buffer; mimetype: string } | null;
}> {
  if (request.isMultipart()) {
    const fields: Record<string, unknown> = {};
    let photo: { buffer: Buffer; mimetype: string } | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const buffer = part.toBuffer ? await part.toBuffer() : Buffer.alloc(0);
        if (
          buffer.length > 0 &&
          (part.fieldname === "photo" ||
            part.fieldname === "file" ||
            (part.mimetype || "").startsWith("image/"))
        ) {
          photo = {
            buffer,
            mimetype: part.mimetype || "image/jpeg",
          };
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    return { fields, photo };
  }
  const body = (request.body ?? {}) as Record<string, unknown>;
  return { fields: body, photo: null };
}

function parseSocialLinksField(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export async function registerCastProfileUpdatePublicRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/public/cast-profile-update",
    {
      schema: {
        tags: ["Public"],
        summary: "Load cast profile self-update form data",
        security: [],
        querystring: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    },
    async (request, reply) => {
      const token = rawTokenFromQuery(request.query);
      const resolved = resolveCastProfileFromRawToken(token);
      if (!resolved) {
        return reply.status(200).send({ state: "invalid" });
      }
      const { cast } = resolved;
      const pending = getPendingForCast(cast.id);
      const form = formDefaults(cast, pending, token);
      return reply.status(200).send({
        state: "ok",
        podcastTitle: cast.podcastTitle,
        ...form,
      });
    },
  );

  app.get(
    "/public/cast-profile-update/photo",
    {
      schema: {
        tags: ["Public"],
        summary: "Serve current or pending cast photo for self-update form",
        security: [],
        querystring: {
          type: "object",
          properties: {
            token: { type: "string" },
            source: { type: "string" },
          },
          required: ["token"],
        },
      },
    },
    async (request, reply) => {
      const token = rawTokenFromQuery(request.query);
      const source = String(
        (request.query as { source?: string }).source || "current",
      );
      const resolved = resolveCastProfileFromRawToken(token);
      if (!resolved) {
        return reply.status(404).send({ error: "Not found" });
      }
      const { cast } = resolved;
      if (source === "pending") {
        const pending = getPendingForCast(cast.id);
        const photoPath = pending?.photoPath ?? null;
        if (!photoPath) {
          return reply.status(404).send({ error: "Not found" });
        }
        try {
          return await sendImageFile(
            request,
            reply,
            resolveDataPath(photoPath),
            castPendingPhotoDir(cast.podcastId),
          );
        } catch {
          return reply.status(404).send({ error: "Not found" });
        }
      }

      if (cast.photoUrl?.trim() && /^https?:\/\//i.test(cast.photoUrl.trim())) {
        return reply.redirect(cast.photoUrl.trim());
      }
      if (!cast.photoPath) {
        return reply.status(404).send({ error: "Not found" });
      }
      try {
        return await sendImageFile(
          request,
          reply,
          resolveDataPath(cast.photoPath),
          castPhotoDir(cast.podcastId),
        );
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.post(
    "/public/cast-profile-update",
    {
      schema: {
        tags: ["Public"],
        summary: "Submit cast profile self-update (pending approval)",
        security: [],
      },
    },
    async (request, reply) => {
      const parsedBody = await parseSubmitBody(request);
      const token =
        typeof parsedBody.fields.token === "string"
          ? parsedBody.fields.token.trim()
          : "";
      const resolved = resolveCastProfileFromRawToken(token);
      if (!resolved) {
        return reply.status(400).send({
          error: "This update link is invalid or has expired.",
        });
      }
      const { cast } = resolved;

      const castLimit = checkKeyRateLimit({
        key: `cast-profile-submit:cast:${cast.id}`,
        windowMs: CAST_PROFILE_UPDATE_WINDOW_MS,
        max: CAST_PROFILE_UPDATE_MAX,
      });
      if (!castLimit.ok) {
        return reply
          .status(429)
          .header("Retry-After", String(castLimit.retryAfterSec))
          .send({ error: castLimit.error });
      }
      const ip = getClientIp(request);
      const ipLimit = checkKeyRateLimit({
        key: `cast-profile-submit:ip:${ip}`,
        windowMs: CAST_PROFILE_UPDATE_WINDOW_MS,
        max: CAST_PROFILE_UPDATE_IP_MAX,
      });
      if (!ipLimit.ok) {
        return reply
          .status(429)
          .header("Retry-After", String(ipLimit.retryAfterSec))
          .send({ error: ipLimit.error });
      }

      const submitParsed = castProfileUpdateSubmitSchema.safeParse({
        name: parsedBody.fields.name,
        nickname: parsedBody.fields.nickname ?? null,
        description: parsedBody.fields.description ?? null,
        socialLinks: parseSocialLinksField(parsedBody.fields.socialLinks),
        timeZone: parsedBody.fields.timeZone ?? null,
      });
      if (!submitParsed.success) {
        return reply.status(400).send({
          error:
            submitParsed.error.issues[0]?.message ?? "Validation failed",
          details: submitParsed.error.flatten(),
        });
      }

      let photoPath: string | null = null;
      let replacePhoto = false;
      if (parsedBody.photo) {
        const stored = await validateAndStorePendingPhoto({
          podcastId: cast.podcastId,
          castId: cast.id,
          buffer: parsedBody.photo.buffer,
          mimetype: parsedBody.photo.mimetype,
        });
        if ("error" in stored) {
          return reply.status(400).send({ error: stored.error });
        }
        photoPath = stored.photoPath;
        replacePhoto = true;
      }

      upsertPending({
        castId: cast.id,
        podcastId: cast.podcastId,
        name: submitParsed.data.name.trim(),
        nickname: submitParsed.data.nickname?.trim() || null,
        description: submitParsed.data.description?.trim() || null,
        socialLinks: submitParsed.data.socialLinks,
        timeZone: submitParsed.data.timeZone?.trim() || null,
        photoPath,
        replacePhoto,
      });

      const fallbackOrigin =
        (request.headers["origin"] as string | undefined) ||
        absoluteOrigin("");
      void notifyHostsOfCastProfilePending({
        cast,
        fallbackOrigin,
      });

      return reply.status(200).send({ ok: true });
    },
  );
}
