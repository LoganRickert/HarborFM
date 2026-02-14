import type { FastifyInstance } from "fastify";
import send from "@fastify/send";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join, extname } from "path";
import { nanoid } from "nanoid";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import { db } from "../../db/index.js";
import {
  isAdmin,
  canAccessPodcast,
  getPodcastRole,
  canAccessEpisode,
  canEditEpisodeOrPodcastMetadata,
  canAssignCastToEpisode,
} from "../../services/access.js";
import { episodeCreateSchema, episodeUpdateSchema, episodeCastAssignBodySchema } from "@harborfm/shared";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import {
  assertPathUnder,
  assertResolvedPathUnder,
  artworkDir,
  processedDir,
  transcriptSrtPath,
} from "../../services/paths.js";
import { EXT_DOT_TO_MIMETYPE, MIMETYPE_TO_EXT } from "../../utils/artwork.js";
import { APP_NAME, ARTWORK_MAX_BYTES, ARTWORK_MAX_MB } from "../../config.js";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function episodeRowWithFilename(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const path = row.artwork_path as string | null | undefined;
  const podcastId = row.podcast_id as string | undefined;
  let artwork_filename: string | null = null;
  if (path && podcastId) {
    try {
      const dir = artworkDir(podcastId);
      assertPathUnder(path, dir);
      artwork_filename = basename(path);
    } catch {
      // path invalid or outside allowed dir: don't expose filename
    }
  }
  return { ...row, artwork_filename };
}

export async function episodeRoutes(app: FastifyInstance) {
  app.get(
    "/podcasts/:podcastId/episodes",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "List episodes",
        description:
          "List episodes for a podcast. Must have access to the podcast.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        response: {
          200: { description: "List of episodes" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const rows = db
        .prepare(
          `SELECT * FROM episodes WHERE podcast_id = ? ORDER BY created_at DESC`,
        )
        .all(podcastId) as Record<string, unknown>[];
      return { episodes: rows.map((r) => episodeRowWithFilename(r)) };
    },
  );

  app.post(
    "/podcasts/:podcastId/episodes",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Create episode",
        description:
          "Create an episode for a podcast. Requires read-write access.",
        params: {
          type: "object",
          properties: { podcastId: { type: "string" } },
          required: ["podcastId"],
        },
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
          },
          required: ["title"],
        },
        response: {
          201: { description: "Created episode" },
          400: { description: "Validation failed" },
          403: { description: "At limit or read-only" },
          404: { description: "Podcast not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId } = request.params as { podcastId: string };
      const role = getPodcastRole(request.userId, podcastId);
      if (!canEditEpisodeOrPodcastMetadata(role)) {
        return reply.status(404).send({ error: "Podcast not found" });
      }
      const podcastRow = db
        .prepare(
          "SELECT owner_user_id, max_episodes FROM podcasts WHERE id = ?",
        )
        .get(podcastId) as
        | { owner_user_id: string; max_episodes: number | null }
        | undefined;
      const ownerMax = podcastRow
        ? (db
            .prepare("SELECT max_episodes FROM users WHERE id = ?")
            .get(podcastRow.owner_user_id) as
            | { max_episodes: number | null }
            | undefined)
        : undefined;
      const maxEpisodes =
        podcastRow?.max_episodes ?? ownerMax?.max_episodes ?? null;
      if (maxEpisodes != null && maxEpisodes > 0) {
        const count = db
          .prepare(
            "SELECT COUNT(*) as count FROM episodes WHERE podcast_id = ?",
          )
          .get(podcastId) as { count: number };
        if (count.count >= maxEpisodes) {
          return reply.status(403).send({
            error: `This show has reached its limit of ${maxEpisodes} episode${maxEpisodes === 1 ? "" : "s"}. You cannot create more.`,
          });
        }
      }
      const parsed = episodeCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const id = nanoid();
      const urnNamespace = APP_NAME.toLowerCase().replace(/\s+/g, "-");
      const guid = `urn:${urnNamespace}:episode:${id}`;
      const data = parsed.data;
      const slug = (data as { slug?: string }).slug || slugify(data.title);
      // Ensure slug is unique within podcast
      let finalSlug = slug;
      let counter = 1;
      while (
        db
          .prepare("SELECT id FROM episodes WHERE podcast_id = ? AND slug = ?")
          .get(podcastId, finalSlug)
      ) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }
      db.prepare(
        `INSERT INTO episodes (
          id, podcast_id, title, description, subtitle, summary, content_encoded, slug, guid, season_number, episode_number,
          episode_type, explicit, publish_at, status, artwork_url, episode_link, guid_is_permalink
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        podcastId,
        data.title,
        data.description ?? "",
        (data as { subtitle?: string | null }).subtitle ?? null,
        (data as { summary?: string | null }).summary ?? null,
        (data as { content_encoded?: string | null }).content_encoded ?? null,
        finalSlug,
        guid,
        data.season_number ?? null,
        data.episode_number ?? null,
        data.episode_type ?? null,
        data.explicit ?? null,
        data.publish_at ?? null,
        data.status ?? "draft",
        data.artwork_url ?? null,
        (data as { episode_link?: string | null }).episode_link ?? null,
        (data as { guid_is_permalink?: 0 | 1 }).guid_is_permalink ?? 0,
      );
      try {
        writeRssFile(podcastId, null);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      const row = db
        .prepare("SELECT * FROM episodes WHERE id = ?")
        .get(id) as Record<string, unknown>;
      return reply.status(201).send(episodeRowWithFilename(row));
    },
  );

  app.get(
    "/episodes/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "Get episode",
        description: "Get an episode by ID. Must have access to the podcast.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "Episode" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, id);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const row = db.prepare("SELECT * FROM episodes WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) return reply.status(404).send({ error: "Episode not found" });
      const out = episodeRowWithFilename(row) as Record<string, unknown>;
      const podcastId = row.podcast_id as string | undefined;
      if (podcastId && row.audio_final_path) {
        const srtPath = transcriptSrtPath(podcastId, id);
        if (existsSync(srtPath)) {
          assertPathUnder(srtPath, processedDir(podcastId, id));
          out.has_transcript = true;
        }
      }
      return out;
    },
  );

  app.patch(
    "/episodes/:id",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Update episode",
        description: "Update episode metadata. Requires read-write access.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
          },
        },
        response: {
          200: { description: "Updated episode" },
          400: { description: "Validation failed" },
          403: { description: "Only admins can edit slugs" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, id);
      if (!access || !canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const parsed = episodeUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: parsed.error.flatten(),
          });
      }
      const data = parsed.data;
      const fields: string[] = [];
      const values: unknown[] = [];
      const updateData = data as { slug?: string; title?: string };

      // Get current episode to ensure we have podcast_id and current title
      const currentEpisode = db
        .prepare("SELECT podcast_id, title, slug FROM episodes WHERE id = ?")
        .get(id) as
        | { podcast_id: string; title: string; slug: string }
        | undefined;
      if (!currentEpisode)
        return reply.status(404).send({ error: "Episode not found" });

      // Only admins can explicitly edit slugs after creation
      // Allow auto-generation from title if slug is empty, but block explicit slug changes
      if (
        updateData.slug !== undefined &&
        updateData.slug !== currentEpisode.slug &&
        !isAdmin(request.userId)
      ) {
        return reply
          .status(403)
          .send({ error: "Only administrators can edit slugs" });
      }

      // Ensure slug is always set - use provided slug, or generate from title (new or existing)
      const newTitle = data.title ?? currentEpisode.title;
      let finalSlug = updateData.slug || currentEpisode.slug;
      // Only auto-generate if slug is empty or missing, and user didn't explicitly provide one
      // If user explicitly provided a slug (even if same), respect it (admin check already done above)
      if (!finalSlug && updateData.slug === undefined) {
        // Generate slug from title if slug is empty and no explicit slug provided
        finalSlug = slugify(newTitle);
      }

      // Ensure slug is unique within podcast
      if (finalSlug !== currentEpisode.slug) {
        let uniqueSlug = finalSlug;
        let counter = 1;
        while (
          db
            .prepare(
              "SELECT id FROM episodes WHERE podcast_id = ? AND slug = ? AND id != ?",
            )
            .get(currentEpisode.podcast_id, uniqueSlug, id)
        ) {
          uniqueSlug = `${finalSlug}-${counter}`;
          counter++;
        }
        finalSlug = uniqueSlug;
      }

      let oldArtworkPath: string | null = null;
      if (data.artwork_url !== undefined) {
        fields.push("artwork_url = ?");
        values.push(
          data.artwork_url && String(data.artwork_url).trim()
            ? data.artwork_url
            : null,
        );
        fields.push("artwork_path = NULL");
        const episodeRow = db
          .prepare("SELECT artwork_path FROM episodes WHERE id = ?")
          .get(id) as { artwork_path: string | null } | undefined;
        if (episodeRow?.artwork_path) oldArtworkPath = episodeRow.artwork_path;
      }

      const guidPayload = (data as { guid?: string }).guid;
      const map: Record<string, unknown> = {
        title: data.title,
        description: data.description,
        subtitle: (data as { subtitle?: string | null }).subtitle,
        summary: (data as { summary?: string | null }).summary,
        content_encoded: (data as { content_encoded?: string | null })
          .content_encoded,
        slug: finalSlug,
        ...(guidPayload !== undefined && String(guidPayload).trim()
          ? { guid: String(guidPayload).trim() }
          : {}),
        season_number: data.season_number,
        episode_number: data.episode_number,
        episode_type: data.episode_type,
        explicit: data.explicit,
        publish_at: data.publish_at,
        status: data.status,
        episode_link: (data as { episode_link?: string | null }).episode_link,
        guid_is_permalink: (data as { guid_is_permalink?: 0 | 1 })
          .guid_is_permalink,
        subscriber_only: data.subscriber_only,
      };
      for (const [k, v] of Object.entries(map)) {
        if (v !== undefined) {
          fields.push(`${k} = ?`);
          // Convert empty string to null for URL fields
          if ((k === "artwork_url" || k === "episode_link") && v === "") {
            values.push(null);
          } else {
            values.push(v);
          }
        }
      }
      // Always ensure slug is updated (it's always set, but ensure it's included)
      if (!fields.some((f) => f.startsWith("slug"))) {
        fields.push("slug = ?");
        values.push(finalSlug);
      }
      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        values.push(id);
        db.prepare(`UPDATE episodes SET ${fields.join(", ")} WHERE id = ?`).run(
          ...values,
        );
      }
      if (oldArtworkPath) {
        try {
          const dir = artworkDir(currentEpisode.podcast_id);
          const safeOld = assertPathUnder(oldArtworkPath, dir);
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      const row = db
        .prepare("SELECT * FROM episodes WHERE id = ?")
        .get(id) as Record<string, unknown>;
      const podcastId = (row as { podcast_id: string }).podcast_id;
      try {
        writeRssFile(podcastId, null);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      return episodeRowWithFilename(row);
    },
  );

  // Authenticated episode artwork (for episode editor etc. - not gated by public_feed_disabled).
  const ARTWORK_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/i;
  app.get(
    "/podcasts/:podcastId/episodes/:episodeId/artwork/:filename",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "Get episode artwork (authenticated)",
        description:
          "Returns the episode cover image. Requires access to the podcast. Use this in the app instead of /public/artwork when logged in.",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["podcastId", "episodeId", "filename"],
        },
        response: {
          200: { description: "Image binary" },
          206: { description: "Partial content" },
          404: { description: "Not found" },
          416: { description: "Range not satisfiable" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId, filename } = request.params as {
        podcastId: string;
        episodeId: string;
        filename: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: "Not found" });
      if (!ARTWORK_FILENAME_REGEX.test(filename))
        return reply.status(404).send({ error: "Not found" });
      const row = db
        .prepare(
          "SELECT artwork_path FROM episodes WHERE id = ? AND podcast_id = ?",
        )
        .get(episodeId, podcastId) as
        | { artwork_path: string | null }
        | undefined;
      if (!row?.artwork_path || basename(row.artwork_path) !== filename)
        return reply.status(404).send({ error: "Not found" });
      try {
        const safePath = assertPathUnder(
          row.artwork_path,
          artworkDir(podcastId),
        );
        const ext = extname(safePath).toLowerCase();
        const contentType = EXT_DOT_TO_MIMETYPE[ext] ?? "image/jpeg";
        const result = await send(request.raw, basename(safePath), {
          root: dirname(safePath),
          contentType: false,
          acceptRanges: true,
          cacheControl: true,
          maxAge: 86400,
        });
        if (result.type === "error") {
          const err = result.metadata.error as Error & { status?: number };
          const status = (err.status ?? 404) as 404 | 500;
          return reply
            .status(status === 500 ? 404 : status)
            .send({ error: err.message ?? "Not found" });
        }
        reply.status(result.statusCode as 200 | 206 | 416);
        const headers = result.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) reply.header(key, value);
        }
        reply.header("Content-Type", contentType);
        return reply.send(result.stream);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.post(
    "/podcasts/:podcastId/episodes/:episodeId/artwork",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Upload episode artwork",
        description:
          "Upload episode cover image (multipart). Max 5MB. Requires read-write access.",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        response: {
          200: { description: "Artwork uploaded" },
          400: { description: "No file or not image" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access || !canEditEpisodeOrPodcastMetadata(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const existing = db
        .prepare(
          "SELECT id, artwork_path FROM episodes WHERE id = ? AND podcast_id = ?",
        )
        .get(episodeId, podcastId) as
        | { id: string; artwork_path: string | null }
        | undefined;
      if (!existing)
        return reply.status(404).send({ error: "Episode not found" });
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const mimetype = data.mimetype || "";
      if (!mimetype.startsWith("image/"))
        return reply.status(400).send({ error: "Not an image" });
      const ext = MIMETYPE_TO_EXT[mimetype] ?? "jpg";
      const dir = artworkDir(podcastId);
      const filename = `${nanoid()}.${ext}`;
      const destPath = join(dir, filename);
      const buffer = await data.toBuffer();
      if (buffer.length > ARTWORK_MAX_BYTES)
        return reply
          .status(400)
          .send({ error: `Image too large (max ${ARTWORK_MAX_MB}MB)` });
      assertResolvedPathUnder(destPath, dir);
      writeFileSync(destPath, buffer);
      db.prepare(
        "UPDATE episodes SET artwork_path = ?, artwork_url = NULL, updated_at = datetime('now') WHERE id = ?",
      ).run(destPath, episodeId);
      const oldPath = existing.artwork_path;
      if (oldPath && oldPath !== destPath) {
        try {
          const safeOld = assertPathUnder(oldPath, dir);
          if (existsSync(safeOld)) unlinkSync(safeOld);
        } catch {
          // ignore
        }
      }
      try {
        writeRssFile(podcastId, null);
        deleteTokenFeedTemplateFile(podcastId);
        notifyWebSubHub(podcastId, null);
      } catch (_) {
        // non-fatal
      }
      const row = db
        .prepare("SELECT * FROM episodes WHERE id = ?")
        .get(episodeId) as Record<string, unknown>;
      return episodeRowWithFilename(row);
    },
  );

  // Episode cast (assign hosts/guests to episode)
  app.get(
    "/podcasts/:podcastId/episodes/:episodeId/cast",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Episodes"],
        summary: "List episode cast",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        response: {
          200: { description: "Assigned cast" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access || access.podcastId !== podcastId) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const episode = db
        .prepare("SELECT id FROM episodes WHERE id = ? AND podcast_id = ?")
        .get(episodeId, podcastId);
      if (!episode) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const rows = db
        .prepare(
          `SELECT c.* FROM podcast_cast c
           JOIN episode_cast ec ON ec.cast_id = c.id
           WHERE ec.episode_id = ?
           ORDER BY c.role ASC, c.created_at DESC`,
        )
        .all(episodeId) as Record<string, unknown>[];
      return { cast: rows };
    },
  );

  app.put(
    "/podcasts/:podcastId/episodes/:episodeId/cast",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Episodes"],
        summary: "Assign cast to episode",
        params: {
          type: "object",
          properties: {
            podcastId: { type: "string" },
            episodeId: { type: "string" },
          },
          required: ["podcastId", "episodeId"],
        },
        body: { type: "object", properties: { cast_ids: { type: "array", items: { type: "string" } } } },
        response: {
          200: { description: "Updated" },
          400: { description: "Invalid cast_ids" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const { podcastId, episodeId } = request.params as {
        podcastId: string;
        episodeId: string;
      };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access || !canAssignCastToEpisode(access.role)) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const episode = db
        .prepare("SELECT id FROM episodes WHERE id = ? AND podcast_id = ?")
        .get(episodeId, podcastId);
      if (!episode) {
        return reply.status(404).send({ error: "Episode not found" });
      }
      const parsed = episodeCastAssignBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        });
      }
      const castIds = parsed.data.cast_ids;
      if (castIds.length > 0) {
        const placeholders = castIds.map(() => "?").join(",");
        const existingCast = db
          .prepare(
            `SELECT id FROM podcast_cast WHERE id IN (${placeholders}) AND podcast_id = ?`,
          )
          .all(...castIds, podcastId) as { id: string }[];
        if (existingCast.length !== castIds.length) {
          return reply
            .status(400)
            .send({ error: "One or more cast IDs are invalid or do not belong to this podcast" });
        }
      }
      db.prepare("DELETE FROM episode_cast WHERE episode_id = ?").run(episodeId);
      for (const castId of castIds) {
        db.prepare("INSERT INTO episode_cast (episode_id, cast_id) VALUES (?, ?)").run(
          episodeId,
          castId,
        );
      }
      const rows = db
        .prepare(
          `SELECT c.* FROM podcast_cast c
           JOIN episode_cast ec ON ec.cast_id = c.id
           WHERE ec.episode_id = ?
           ORDER BY c.role ASC, c.created_at DESC`,
        )
        .all(episodeId) as Record<string, unknown>[];
      return { cast: rows };
    },
  );
}
