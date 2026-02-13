import type { FastifyInstance } from "fastify";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, extname, basename } from "path";
import send from "@fastify/send";
import { execFile } from "child_process";
import { promisify } from "util";
import { nanoid } from "nanoid";
import { db } from "../../db/index.js";
import { requireAuth, requireNotReadOnly } from "../../plugins/auth.js";
import {
  canAccessEpisode,
  canEditSegments,
  canUseAssetInSegment,
  getPodcastOwnerId,
} from "../../services/access.js";
import { readSettings, isTranscriptionProviderConfigured } from "../settings/index.js";
import {
  uploadsDir,
  segmentPath,
  getDataDir,
  libraryDir,
  processedDir,
  assertPathUnder,
  assertResolvedPathUnder,
  transcriptSrtPath,
} from "../../services/paths.js";
import * as audioService from "../../services/audio.js";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import {
  FileTooLargeError,
  streamToFileWithLimit,
  extensionFromAudioMimetype,
} from "../../services/uploads.js";
import { userRateLimitPreHandler } from "../../services/rateLimit.js";
import { wouldExceedStorageLimit } from "../../services/storageLimit.js";
import { contentTypeFromAudioPath } from "../../utils/audio.js";
import {
  SEGMENT_UPLOAD_MAX_BYTES,
  FFMPEG_PATH,
  WAVEFORM_EXTENSION,
  OPENAI_TRANSCRIPTION_DEFAULT_URL,
} from "../../config.js";
import {
  segmentEpisodeIdParamSchema,
  segmentEpisodeSegmentIdParamSchema,
  segmentEpisodeIdOnlyParamSchema,
  segmentCreateReusableBodySchema,
  segmentReorderBodySchema,
  segmentUpdateNameBodySchema,
  segmentTrimBodySchema,
  segmentRemoveSilenceBodySchema,
  segmentNoiseSuppressionBodySchema,
  segmentTranscriptBodySchema,
  segmentEpisodeTranscriptBodySchema,
  segmentTranscriptGenerateQuerySchema,
  segmentTranscriptDeleteQuerySchema,
} from "@harborfm/shared";

const exec = promisify(execFile);

/** In-memory render status per episode: only one build per episode at a time. Cleared when returning 'done' or 'failed'. */
const renderStatusByEpisode = new Map<string, "building" | "done" | "failed">();
const renderErrorByEpisode = new Map<string, string>();

/** In-memory transcript generation status per episode. Cleared when returning 'done' or 'failed'. */
const transcriptStatusByEpisode = new Map<string, "transcribing" | "done" | "failed">();
const transcriptErrorByEpisode = new Map<string, string>();

function transcriptPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, ".txt");
}

/** Strip HTML/XML tags and dangerous control chars from transcript text before saving. Keeps newlines and tabs. */
function sanitizeTranscriptText(s: string): string {
  let out = s.replace(/<[^>]*>/g, "");
  out = out.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, ""); // eslint-disable-line no-control-regex
  return out;
}

function waveformPath(audioPath: string): string {
  return audioPath.replace(/\.[^.]+$/, WAVEFORM_EXTENSION);
}

function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function parseSrtTime(timeStr: string): number {
  const normalized = timeStr.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 3) return 0;
  const hours = parseFloat(parts[0] || "0");
  const minutes = parseFloat(parts[1] || "0");
  const seconds = parseFloat(parts[2] || "0");
  return hours * 3600 + minutes * 60 + seconds;
}

interface SrtEntry {
  index: number;
  start: string;
  end: string;
  text: string;
}

function parseSrt(srtText: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = srtText.split(/\n\s*\n/).filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const indexStr = lines[0]?.trim();
    const timeLine = lines[1]?.trim();
    if (!indexStr || !timeLine || !timeLine.includes("-->")) continue;
    const [start, end] = timeLine.split("-->").map((s) => s.trim());
    const text = lines.slice(2).join("\n").trim();
    if (start && end && text) {
      const index = parseInt(indexStr, 10);
      if (!Number.isNaN(index)) {
        entries.push({ index, start, end, text });
      }
    }
  }
  return entries;
}

/**
 * Run transcription (Whisper or OpenAI) on an audio file. Returns SRT text.
 * Throws if provider not configured or transcription fails. May throw with message "CHUNK_TOO_LARGE".
 */
async function runTranscription(
  audioPath: string,
  allowedBaseDir: string,
  settings: ReturnType<typeof readSettings>,
): Promise<string> {
  let text: string | null = null;
  if (settings.transcription_provider === "self_hosted") {
    const whisperUrl = settings.whisper_asr_url?.trim();
    if (whisperUrl) {
      text = await generateSrtFromWhisper(audioPath, allowedBaseDir, whisperUrl);
    }
  } else if (settings.transcription_provider === "openai") {
    const url =
      settings.openai_transcription_url?.trim() ||
      OPENAI_TRANSCRIPTION_DEFAULT_URL;
    const apiKey = settings.openai_transcription_api_key?.trim();
    const model = settings.transcription_model?.trim() || "whisper-1";
    if (apiKey) {
      text = await generateSrtFromOpenAI(audioPath, allowedBaseDir, {
        url,
        apiKey,
        model,
      });
    }
  }
  if (!text) {
    throw new Error(
      "Transcription service failed. Check Settings and try again.",
    );
  }
  return text;
}

/**
 * Call Whisper ASR with an audio file and return SRT text, or null on failure.
 * Used for segment transcripts and for episode-level transcript after render.
 */
export async function generateSrtFromWhisper(
  audioPath: string,
  allowedBaseDir: string,
  whisperAsrUrl: string,
): Promise<string | null> {
  const url = whisperAsrUrl.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/\/$/, "") || "";
    if (!pathname.endsWith("asr")) {
      u.pathname = pathname ? `${pathname}/asr` : "/asr";
    }
    u.searchParams.set("output", "srt");
    const whisperUrl = u.toString();
    assertPathUnder(audioPath, allowedBaseDir);
    const buffer = readFileSync(audioPath);
    const mime = contentTypeFromAudioPath(audioPath);
    const ext = (extname(audioPath).replace(/^\./, "") || "mp3").toLowerCase();
    const form = new FormData();
    form.append(
      "audio_file",
      new Blob([new Uint8Array(buffer)], { type: mime }),
      `audio.${ext}`,
    );
    const res = await fetch(whisperUrl, { method: "POST", body: form });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    let text: string;
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as {
        text?: string;
        srt?: string;
        vtt?: string;
        segments?: Array<{ start?: number; end?: number; text?: string }>;
      };
      if (typeof data?.srt === "string") {
        text = data.srt.trim();
      } else if (typeof data?.vtt === "string") {
        text = data.vtt.trim();
      } else if (Array.isArray(data?.segments) && data.segments.length > 0) {
        text = data.segments
          .map((seg, i) => {
            const start = seg.start ?? 0;
            const end = seg.end ?? start + 1;
            const startTime = formatSrtTime(start);
            const endTime = formatSrtTime(end);
            return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text || ""}\n`;
          })
          .join("\n");
      } else if (typeof data?.text === "string") {
        text = data.text.trim();
      } else {
        text = "";
      }
    } else {
      text = (await res.text()).trim();
    }
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Call OpenAI Audio API with an audio file and return SRT text, or null on failure.
 * Uses multipart/form-data: file, model. For gpt-4o-transcribe / gpt-4o-mini-transcribe
 * only response_format=json is supported; we request json and convert text to a single SRT cue.
 * For whisper-1 we can request response_format=srt.
 */
export async function generateSrtFromOpenAI(
  audioPath: string,
  allowedBaseDir: string,
  options: { url: string; apiKey: string; model: string },
): Promise<string | null> {
  const { url, apiKey, model } = options;
  if (!url?.trim() || !apiKey?.trim()) return null;
  const modelVal = (model || "whisper-1").trim();
  const supportsSrt = modelVal.toLowerCase() === "whisper-1";
  try {
    assertPathUnder(audioPath, allowedBaseDir);
    let durationSec = 0;
    try {
      const probe = await audioService.probeAudio(audioPath, allowedBaseDir);
      durationSec = Math.max(0, probe.durationSec);
    } catch {
      // keep 0 if probe fails
    }
    const buffer = readFileSync(audioPath);
    const mime = contentTypeFromAudioPath(audioPath);
    const ext = (extname(audioPath).replace(/^\./, "") || "mp3").toLowerCase();
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mime }),
      `audio.${ext}`,
    );
    form.append("model", modelVal);
    form.append("response_format", supportsSrt ? "srt" : "json");
    const res = await fetch(url.trim(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const bodyText = await res.text();
    if (!res.ok) return null;
    if (supportsSrt) {
      return bodyText.trim() || null;
    }
    try {
      const data = JSON.parse(bodyText) as { text?: string };
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) return null;
      const endTime =
        durationSec > 0 ? formatSrtTime(durationSec) : "00:00:01,000";
      return `1\n00:00:00,000 --> ${endTime}\n${text}\n`;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function removeSrtEntryAndAdjustTimings(
  entries: SrtEntry[],
  removeArrayIndex: number,
  removedDurationSec: number,
): string {
  // Remove the entry at the specified array index
  const removedEntry = entries[removeArrayIndex];
  if (!removedEntry)
    return entries
      .map((e, i) => `${i + 1}\n${e.start} --> ${e.end}\n${e.text}\n`)
      .join("\n");

  const filtered = entries.filter((_, i) => i !== removeArrayIndex);

  // Adjust timings for entries after the removed one
  const removedStartSec = parseSrtTime(removedEntry.start);

  const adjusted = filtered.map((entry) => {
    const startSec = parseSrtTime(entry.start);
    const endSec = parseSrtTime(entry.end);

    if (startSec >= removedStartSec) {
      // This entry comes after the removed one, adjust timings
      return {
        ...entry,
        start: formatSrtTime(Math.max(0, startSec - removedDurationSec)),
        end: formatSrtTime(Math.max(0, endSec - removedDurationSec)),
      };
    }
    return entry;
  });

  // Renumber entries sequentially
  return adjusted
    .map((entry, i) => {
      return `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`;
    })
    .join("\n");
}

function getSegmentAudioPath(
  segment: Record<string, unknown>,
  podcastId: string,
  episodeId: string,
): { path: string; base: string } | null {
  if (segment.type === "recorded" && segment.audio_path) {
    return {
      path: segment.audio_path as string,
      base: uploadsDir(podcastId, episodeId),
    };
  }
  if (segment.type === "reusable" && segment.reusable_asset_id) {
    const asset = db
      .prepare(
        "SELECT audio_path, owner_user_id FROM reusable_assets WHERE id = ?",
      )
      .get(segment.reusable_asset_id) as
      | { audio_path: string; owner_user_id: string }
      | undefined;
    if (asset?.audio_path)
      return { path: asset.audio_path, base: libraryDir(asset.owner_user_id) };
  }
  return null;
}

const ALLOWED_MIME = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/webm",
  "audio/ogg",
];

export async function segmentRoutes(app: FastifyInstance) {
  // Used by the web client to decide whether transcript viewing/generation should be shown.
  app.get(
    "/asr/available",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "ASR available",
        description: "Whether Whisper ASR is configured for transcripts.",
        response: { 200: { description: "available: boolean" } },
      },
    },
    async (request, reply) => {
      const settings = readSettings();
      const providerConfigured = isTranscriptionProviderConfigured(settings);
      const userRow = db
        .prepare(
          "SELECT COALESCE(can_transcribe, 0) AS can_transcribe FROM users WHERE id = ?",
        )
        .get(request.userId) as { can_transcribe: number } | undefined;
      const canTranscribe = userRow?.can_transcribe === 1;
      const available = providerConfigured && canTranscribe;
      return reply.send({ available });
    },
  );

  app.get(
    "/episodes/:id/segments",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "List segments",
        description: "List segments for an episode (recorded and reusable).",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { description: "List of segments" },
          400: { description: "Validation failed" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const rows = db
        .prepare(
          `SELECT s.id, s.episode_id, s.position, s.type, s.name, s.reusable_asset_id, s.audio_path, s.duration_sec, s.created_at,
                  a.name AS asset_name
           FROM episode_segments s
           LEFT JOIN reusable_assets a ON a.id = s.reusable_asset_id
           WHERE s.episode_id = ? ORDER BY s.position ASC, s.created_at ASC`,
        )
        .all(episodeId) as Record<string, unknown>[];
      return { segments: rows };
    },
  );

  app.post(
    "/episodes/:id/segments",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Add segment",
        description:
          "Add segment: JSON type=reusable + reusable_asset_id, or multipart audio for recorded.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          201: { description: "Created segment" },
          400: { description: "Validation failed" },
          403: { description: "Storage limit" },
          404: { description: "Episode or asset not found" },
          500: { description: "Upload or process failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const { podcastId } = access;

      const contentType = (request.headers["content-type"] || "").toLowerCase();
      if (contentType.includes("application/json")) {
        const bodyParsed = segmentCreateReusableBodySchema.safeParse(request.body);
        if (!bodyParsed.success) {
          return reply
            .status(400)
            .send({
              error: bodyParsed.error.issues[0]?.message ?? "Validation failed",
              details: bodyParsed.error.flatten(),
            });
        }
        const body = bodyParsed.data;
        if (body.type === "reusable" && body.reusable_asset_id) {
          if (
            !canUseAssetInSegment(
              request.userId,
              body.reusable_asset_id,
              podcastId,
            )
          ) {
            return reply.status(404).send({ error: "Library asset not found" });
          }
          const asset = db
            .prepare("SELECT id, name FROM reusable_assets WHERE id = ?")
            .get(body.reusable_asset_id) as { name: string } | undefined;
          if (!asset)
            return reply.status(404).send({ error: "Library asset not found" });
          const maxPos = db
            .prepare(
              "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?",
            )
            .get(episodeId) as { pos: number };
          const id = nanoid();
          const assetRow = db
            .prepare("SELECT duration_sec FROM reusable_assets WHERE id = ?")
            .get(body.reusable_asset_id) as { duration_sec: number };
          const segmentName =
            (body.name && String(body.name).trim()) || asset.name;
          db.prepare(
            `INSERT INTO episode_segments (id, episode_id, position, type, name, reusable_asset_id, duration_sec)
             VALUES (?, ?, ?, 'reusable', ?, ?, ?)`,
          ).run(
            id,
            episodeId,
            maxPos.pos,
            segmentName,
            body.reusable_asset_id,
            assetRow.duration_sec ?? 0,
          );
          const row = db
            .prepare("SELECT * FROM episode_segments WHERE id = ?")
            .get(id) as Record<string, unknown>;
          return reply.status(201).send(row);
        }
      }

      const data = await request.file();
      if (!data) {
        return reply
          .status(400)
          .send({
            error:
              "Send multipart file for recorded segment or JSON body type=reusable&reusable_asset_id=...",
          });
      }

      const mimetype = data.mimetype || "";
      if (!ALLOWED_MIME.includes(mimetype) && !mimetype.startsWith("audio/")) {
        return reply
          .status(400)
          .send({ error: "Invalid file type. Use WAV, MP3, or WebM." });
      }
      const segmentName =
        (data.fields?.name as { value?: string })?.value?.trim() || null;
      const ext = extensionFromAudioMimetype(mimetype);
      const segmentId = nanoid();
      const destPath = segmentPath(podcastId, episodeId, segmentId, ext);
      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(
          data.file,
          destPath,
          SEGMENT_UPLOAD_MAX_BYTES,
        );
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: "File too large" });
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Upload failed" });
      }

      const storageUserId = getPodcastOwnerId(podcastId) ?? request.userId;
      if (wouldExceedStorageLimit(db, storageUserId, bytesWritten)) {
        try {
          unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        return reply.status(403).send({
          error:
            "You have reached your storage limit. Delete some content to free space.",
        });
      }

      const segmentBase = uploadsDir(podcastId, episodeId);
      let finalPath = destPath;
      try {
        const normalized = await audioService.normalizeUploadToMp3OrWav(
          destPath,
          ext,
          segmentBase,
        );
        finalPath = normalized.path;
        bytesWritten = statSync(finalPath).size;
      } catch (err) {
        request.log.error(err);
        return reply
          .status(500)
          .send({ error: "Failed to process audio file" });
      }

      try {
        await audioService.generateWaveformFile(finalPath, segmentBase);
      } catch (err) {
        request.log.warn(
          { err, finalPath },
          "Waveform generation failed (upload succeeded)",
        );
      }

      let durationSec = 0;
      try {
        const probe = await audioService.probeAudio(finalPath, segmentBase);
        durationSec = Math.max(0, probe.durationSec);
      } catch {
        // keep 0 if probe fails
      }

      const maxPos = db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM episode_segments WHERE episode_id = ?",
        )
        .get(episodeId) as { pos: number };
      db.prepare(
        `INSERT INTO episode_segments (id, episode_id, position, type, name, audio_path, duration_sec)
         VALUES (?, ?, ?, 'recorded', ?, ?, ?)`,
      ).run(
        segmentId,
        episodeId,
        maxPos.pos,
        segmentName,
        finalPath,
        durationSec,
      );

      // Track disk usage against podcast owner (best-effort)
      db.prepare(
        `UPDATE users
         SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ?
         WHERE id = ?`,
      ).run(bytesWritten, storageUserId);

      const row = db
        .prepare("SELECT * FROM episode_segments WHERE id = ?")
        .get(segmentId) as Record<string, unknown>;
      return reply.status(201).send(row);
    },
  );

  app.put(
    "/episodes/:id/segments/reorder",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Reorder segments",
        description: "Set segment order by array of segment_ids.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            segment_ids: { type: "array", items: { type: "string" } },
          },
          required: ["segment_ids"],
        },
        response: {
          200: { description: "Updated segments list" },
          400: { description: "segment_ids required" },
          403: { description: "Permission denied" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { id: episodeId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const bodyParsed = segmentReorderBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const ids = bodyParsed.data.segment_ids;
      for (let i = 0; i < ids.length; i++) {
        db.prepare(
          "UPDATE episode_segments SET position = ? WHERE id = ? AND episode_id = ?",
        ).run(i, ids[i], episodeId);
      }
      const rows = db
        .prepare(
          "SELECT * FROM episode_segments WHERE episode_id = ? ORDER BY position ASC",
        )
        .all(episodeId) as Record<string, unknown>[];
      return { segments: rows };
    },
  );

  app.patch(
    "/episodes/:episodeId/segments/:segmentId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Update segment",
        description: "Update segment name.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        body: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        response: {
          200: { description: "Updated segment" },
          400: { description: "name required" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const bodyParsed = segmentUpdateNameBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const name =
        bodyParsed.data.name === null || bodyParsed.data.name === ""
          ? null
          : String(bodyParsed.data.name).trim();
      const row = db
        .prepare(
          "SELECT id FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId);
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      db.prepare(
        "UPDATE episode_segments SET name = ? WHERE id = ? AND episode_id = ?",
      ).run(name, segmentId, episodeId);
      const updated = db
        .prepare("SELECT * FROM episode_segments WHERE id = ?")
        .get(segmentId) as Record<string, unknown>;
      return updated;
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/stream",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Stream segment audio",
        description: "Stream segment audio file.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Audio stream" },
          206: { description: "Partial content" },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
          500: { description: "Send error" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      const safePath = assertPathUnder(audio.path, audio.base);
      const contentType = contentTypeFromAudioPath(audio.path);

      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false,
        acceptRanges: true,
        cacheControl: false,
      });

      if (result.type === "error") {
        const err = result.metadata.error as Error & { status?: number };
        return reply
          .status((err.status ?? 500) as 404 | 500)
          .send({ error: err.message ?? "Internal Server Error" });
      }

      reply.status(result.statusCode as 200 | 206 | 404 | 500);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply
        .header("Content-Type", contentType)
        .header("Cache-Control", "private, no-transform");
      return reply.send(result.stream);
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/waveform",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get segment waveform",
        description: "Returns waveform JSON for a segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Waveform JSON" },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const wavPath = waveformPath(audio.path);
      if (!existsSync(wavPath))
        return reply.status(404).send({ error: "Waveform not found" });
      assertPathUnder(wavPath, audio.base);
      const json = readFileSync(wavPath, "utf-8");
      reply
        .header("Content-Type", "application/json")
        .header("Cache-Control", "private, max-age=3600");
      return reply.send(json);
    },
  );

  app.get(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get segment transcript",
        description: "Returns transcript text for a segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "text" },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      if (!existsSync(txtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      assertPathUnder(txtPath, audio.base);
      const text = readFileSync(txtPath, "utf-8");
      return reply.send({ text });
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "whisper", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Generate segment transcript",
        description:
          "Generate or return transcript via Whisper ASR. Query regenerate=true to force regenerate.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        querystring: {
          type: "object",
          properties: { regenerate: { type: "string" } },
        },
        response: {
          200: { description: "text" },
          400: { description: "ASR not configured" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          413: { description: "Audio too large" },
          502: { description: "ASR failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const queryParsed = segmentTranscriptGenerateQuerySchema.safeParse(request.query);
      const regenerate = queryParsed.success ? queryParsed.data.regenerate === true : false;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      if (existsSync(txtPath) && !regenerate) {
        assertPathUnder(txtPath, audio.base);
        const text = readFileSync(txtPath, "utf-8");
        return reply.send({ text });
      }
      const settings = readSettings();
      if (!isTranscriptionProviderConfigured(settings)) {
        return reply
          .status(400)
          .send({
            error:
              "Set a transcription provider in Settings to generate transcripts.",
          });
      }
      const userRow = db
        .prepare(
          "SELECT COALESCE(can_transcribe, 0) AS can_transcribe FROM users WHERE id = ?",
        )
        .get(request.userId) as { can_transcribe: number } | undefined;
      if (userRow?.can_transcribe !== 1) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to use transcription." });
      }
      try {
        const text = await runTranscription(audio.path, audio.base, settings);
        assertPathUnder(dirname(txtPath), audio.base);
        writeFileSync(txtPath, text, "utf-8");
        return reply.send({ text });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "CHUNK_TOO_LARGE") {
          return reply.status(413).send({
            error:
              "Audio file is too large for the transcription service. Try a shorter section or increase the server upload limit.",
          });
        }
        request.log.error(err instanceof Error ? err : new Error(String(err)));
        return reply
          .status(502)
          .send({
            error:
              "Transcription service failed. Check Settings and try again.",
          });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/trim",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Trim segment",
        description:
          "Trim segment to start/end seconds. Body: start_sec, end_sec.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        body: {
          type: "object",
          properties: {
            start_sec: { type: "number" },
            end_sec: { type: "number" },
          },
        },
        response: {
          200: { description: "Updated segment" },
          204: { description: "Trimmed" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const bodyParsed = segmentTrimBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const startSec = bodyParsed.data.start_sec;
      const endSec = bodyParsed.data.end_sec;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });

      // Only recorded segments can be trimmed
      if (segment.type !== "recorded") {
        return reply
          .status(400)
          .send({ error: "Only recorded segments can be trimmed" });
      }

      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);

      // Get current duration
      const probe = await audioService.probeAudio(audio.path, audio.base);
      const currentDurationSec = probe.durationSec;

      // Calculate new start and end
      const newStartSec = startSec ?? 0;
      const newEndSec = endSec ?? currentDurationSec;

      if (
        newStartSec < 0 ||
        newEndSec <= newStartSec ||
        newEndSec > currentDurationSec
      ) {
        return reply.status(400).send({ error: "Invalid trim range" });
      }

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const tempPath = join(tmpdir(), `${nanoid()}.wav`);
      const outputExt = ".wav";
      const finalPath = join(
        dir,
        basename(audio.path, extname(audio.path)) + outputExt,
      );

      try {
        await audioService.trimAudioToWav(
          audio.path,
          audio.base,
          newStartSec,
          newEndSec,
          tempPath,
        );

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error("Trimmed audio file was not created or is empty");
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPath },
            "Waveform generation failed after trim",
          );
        }

        // Update transcript if it exists (adjust timings)
        const txtPath = transcriptPath(audio.path);
        if (existsSync(txtPath)) {
          assertPathUnder(txtPath, audio.base);
          const srtText = readFileSync(txtPath, "utf-8");
          const entries = parseSrt(srtText);

          const adjustedEntries = entries
            .map((entry) => {
              const entryStartSec = parseSrtTime(entry.start);
              const entryEndSec = parseSrtTime(entry.end);
              if (entryEndSec <= newStartSec || entryStartSec >= newEndSec)
                return null;
              const adjustedStart = Math.max(0, entryStartSec - newStartSec);
              const adjustedEnd = Math.min(
                newEndSec - newStartSec,
                entryEndSec - newStartSec,
              );
              return {
                ...entry,
                start: formatSrtTime(adjustedStart),
                end: formatSrtTime(adjustedEnd),
              };
            })
            .filter((e): e is SrtEntry => e !== null);

          const newTxtPath = transcriptPath(finalPath);
          const updatedSrt = adjustedEntries
            .map(
              (entry, i) =>
                `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`,
            )
            .join("\n");
          writeFileSync(newTxtPath, updatedSrt, "utf-8");
        }

        const newDurationSec = newEndSec - newStartSec;
        db.prepare(
          "UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?",
        ).run(finalPath, newDurationSec, segmentId, episodeId);

        if (audio.path !== finalPath) unlinkSync(audio.path);
        const txtPathToRemove = transcriptPath(audio.path);
        if (
          existsSync(txtPathToRemove) &&
          txtPathToRemove !== transcriptPath(finalPath)
        ) {
          unlinkSync(txtPathToRemove);
        }

        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Failed to trim audio" });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/remove-silence",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Remove silence",
        description:
          "Remove silence from segment. Body: threshold_db, min_silence_duration_sec.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        body: {
          type: "object",
          properties: {
            threshold_db: { type: "number" },
            min_silence_duration_sec: { type: "number" },
          },
        },
        response: {
          200: { description: "Updated segment" },
          204: { description: "Done" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const bodyParsed = segmentRemoveSilenceBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const thresholdSeconds = bodyParsed.data.threshold_seconds ?? 2.0;
      const silenceThresholdDb = bodyParsed.data.silence_threshold ?? -60;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });

      // Only recorded segments can have silence removed
      if (segment.type !== "recorded") {
        return reply
          .status(400)
          .send({ error: "Only recorded segments can have silence removed" });
      }

      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const tempPath = join(tmpdir(), `${nanoid()}.wav`);
      const finalPath = join(
        dir,
        basename(audio.path, extname(audio.path)) + ".wav",
      );

      try {
        await audioService.removeSilenceFromWav(
          audio.path,
          audio.base,
          thresholdSeconds,
          silenceThresholdDb,
          tempPath,
        );

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error(
            "Audio file with silence removed was not created or is empty",
          );
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPath },
            "Waveform generation failed after remove-silence",
          );
        }

        const probe = await audioService.probeAudio(finalPath, audio.base);
        const newDurationSec = probe.durationSec;

        // Update transcript if it exists (adjust timings based on removed silence)
        const txtPath = transcriptPath(audio.path);
        if (existsSync(txtPath)) {
          assertPathUnder(txtPath, audio.base);
          const srtText = readFileSync(txtPath, "utf-8");
          const entries = parseSrt(srtText);

          // Detect silence periods to calculate timing adjustments
          const { stderr } = await exec(
            FFMPEG_PATH,
            [
              "-i",
              audio.path,
              "-af",
              `silencedetect=noise=${silenceThresholdDb}dB:d=${thresholdSeconds}`,
              "-f",
              "null",
              "-",
            ],
            { maxBuffer: 10 * 1024 * 1024 },
          );

          const silencePeriods: Array<{ start: number; end: number }> = [];
          const lines = stderr.split("\n");
          let currentStart: number | null = null;

          for (const line of lines) {
            const startMatch = line.match(/silence_start:\s*([\d.]+)/);
            const endMatch = line.match(/silence_end:\s*([\d.]+)/);

            if (startMatch) {
              currentStart = parseFloat(startMatch[1]);
            }
            if (endMatch && currentStart !== null) {
              const end = parseFloat(endMatch[1]);
              const duration = end - currentStart;
              if (duration >= thresholdSeconds) {
                silencePeriods.push({ start: currentStart, end });
              }
              currentStart = null;
            }
          }

          // Adjust transcript timings: subtract cumulative silence duration before each entry
          const adjustedEntries = entries
            .map((entry) => {
              const entryStartSec = parseSrtTime(entry.start);
              const entryEndSec = parseSrtTime(entry.end);

              // Calculate how much silence was removed before this entry
              let removedBefore = 0;
              for (const silence of silencePeriods) {
                if (silence.end <= entryStartSec) {
                  removedBefore += silence.end - silence.start;
                } else if (
                  silence.start < entryStartSec &&
                  silence.end > entryStartSec
                ) {
                  // Entry starts during silence, adjust start to silence start
                  removedBefore += entryStartSec - silence.start;
                }
              }

              // Calculate how much silence was removed before the end
              let removedBeforeEnd = 0;
              for (const silence of silencePeriods) {
                if (silence.end <= entryEndSec) {
                  removedBeforeEnd += silence.end - silence.start;
                } else if (
                  silence.start < entryEndSec &&
                  silence.end > entryEndSec
                ) {
                  removedBeforeEnd += entryEndSec - silence.start;
                }
              }

              // Adjust timings
              const adjustedStart = Math.max(0, entryStartSec - removedBefore);
              const adjustedEnd = Math.max(
                adjustedStart,
                entryEndSec - removedBeforeEnd,
              );

              return {
                ...entry,
                start: formatSrtTime(adjustedStart),
                end: formatSrtTime(adjustedEnd),
              };
            })
            .filter((e) => {
              // Remove entries that are now invalid or were entirely within removed silence
              const startSec = parseSrtTime(e.start);
              const endSec = parseSrtTime(e.end);
              return endSec > startSec && startSec >= 0;
            });

          const newTxtPath = transcriptPath(finalPath);
          const updatedSrt = adjustedEntries
            .map(
              (entry, i) =>
                `${i + 1}\n${entry.start} --> ${entry.end}\n${entry.text}\n`,
            )
            .join("\n");
          writeFileSync(newTxtPath, updatedSrt, "utf-8");
        }

        db.prepare(
          "UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?",
        ).run(finalPath, newDurationSec, segmentId, episodeId);

        if (audio.path !== finalPath) unlinkSync(audio.path);
        const txtPathToRemove = transcriptPath(audio.path);
        if (
          existsSync(txtPathToRemove) &&
          txtPathToRemove !== transcriptPath(finalPath)
        ) {
          unlinkSync(txtPathToRemove);
        }

        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply.status(500).send({ error: "Failed to remove silence" });
      }
    },
  );

  app.post(
    "/episodes/:episodeId/segments/:segmentId/noise-suppression",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Noise suppression",
        description: "Apply noise suppression to segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          200: { description: "Updated segment" },
          204: { description: "Done" },
          400: { description: "Only recorded segments" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const bodyParsed = segmentNoiseSuppressionBodySchema.safeParse(request.body);
      const nf = bodyParsed.success && bodyParsed.data.nf !== undefined && Number.isFinite(bodyParsed.data.nf)
        ? bodyParsed.data.nf
        : -25;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });

      if (segment.type !== "recorded") {
        return reply
          .status(400)
          .send({
            error: "Only recorded segments can have noise suppression applied",
          });
      }

      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);

      const dir = dirname(audio.path);
      assertPathUnder(dir, audio.base);
      const ext = extname(audio.path) || ".wav";
      const tempPath = join(tmpdir(), `${nanoid()}${ext}`);
      const finalPath = join(dir, basename(audio.path));

      try {
        await audioService.applyNoiseSuppressionToWav(
          audio.path,
          audio.base,
          nf,
          tempPath,
        );

        if (!existsSync(tempPath) || statSync(tempPath).size === 0) {
          throw new Error(
            "Noise-suppressed audio file was not created or is empty",
          );
        }
        copyFileSync(tempPath, finalPath);
        unlinkSync(tempPath);

        try {
          await audioService.generateWaveformFile(finalPath, audio.base);
        } catch (err) {
          request.log.warn(
            { err, finalPath },
            "Waveform generation failed after noise-suppression",
          );
        }

        const probe = await audioService.probeAudio(finalPath, audio.base);
        const newDurationSec = probe.durationSec;

        const oldTxtPath = transcriptPath(audio.path);
        const newTxtPath = transcriptPath(finalPath);
        if (existsSync(oldTxtPath)) {
          assertPathUnder(oldTxtPath, audio.base);
          copyFileSync(oldTxtPath, newTxtPath);
        }

        db.prepare(
          "UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?",
        ).run(finalPath, newDurationSec, segmentId, episodeId);

        if (audio.path !== finalPath) unlinkSync(audio.path);
        if (existsSync(oldTxtPath) && oldTxtPath !== newTxtPath)
          unlinkSync(oldTxtPath);

        return reply.status(204).send();
      } catch (err) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
        request.log.error(err);
        return reply
          .status(500)
          .send({ error: "Failed to apply noise suppression" });
      }
    },
  );

  app.patch(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Update segment transcript",
        description: "Replace transcript text. Body: text.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        body: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        response: {
          200: { description: "Updated" },
          400: { description: "text required" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const bodyParsed = segmentTranscriptBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const transcriptText = bodyParsed.data.text;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      assertPathUnder(dirname(txtPath), audio.base);
      writeFileSync(txtPath, transcriptText, "utf-8");
      return reply.send({ text: transcriptText });
    },
  );

  app.delete(
    "/episodes/:episodeId/segments/:segmentId/transcript",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Delete segment transcript",
        description: "Remove transcript file for segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          204: { description: "Deleted" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId, segmentId } = paramsParsed.data;
      const queryParsed = segmentTranscriptDeleteQuerySchema.safeParse(request.query);
      const entryIndex = queryParsed.success ? queryParsed.data.entryIndex : undefined;

      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const segment = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!segment)
        return reply.status(404).send({ error: "Segment not found" });
      const audio = getSegmentAudioPath(segment, access.podcastId, episodeId);
      if (!audio || !existsSync(audio.path))
        return reply.status(404).send({ error: "Segment audio not found" });
      assertPathUnder(audio.path, audio.base);
      const txtPath = transcriptPath(audio.path);
      if (!existsSync(txtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      assertPathUnder(txtPath, audio.base);

      // If entryIndex is provided, delete that specific entry from audio and transcript
      if (typeof entryIndex === "number") {
        const srtText = readFileSync(txtPath, "utf-8");
        const entries = parseSrt(srtText);

        if (entryIndex < 0 || entryIndex >= entries.length) {
          return reply
            .status(404)
            .send({ error: "Transcript entry not found" });
        }

        const entryToRemove = entries[entryIndex]; // entryIndex is 0-based array index

        const startSec = parseSrtTime(entryToRemove.start);
        const endSec = parseSrtTime(entryToRemove.end);
        const removedDurationSec = endSec - startSec;

        // Remove segment from audio and export to WAV
        const { nanoid } = await import("nanoid");
        const isReusable = segment.type === "reusable";
        let workingSourcePath = audio.path;
        let workingBase = audio.base;
        let tempSourcePath: string | null = null;
        if (isReusable) {
          const ext = (
            extname(audio.path).replace(/^\./, "") || "mp3"
          ).toLowerCase();
          tempSourcePath = segmentPath(
            access.podcastId,
            episodeId,
            nanoid(),
            ext,
          );
          copyFileSync(audio.path, tempSourcePath);
          workingSourcePath = tempSourcePath;
          workingBase = uploadsDir(access.podcastId, episodeId);
        }
        const newAudioPath = isReusable
          ? segmentPath(access.podcastId, episodeId, nanoid(), "wav")
          : join(dirname(audio.path), `${nanoid()}.wav`);

        try {
          await audioService.removeSegmentAndExportToWav(
            workingSourcePath,
            workingBase,
            startSec,
            endSec,
            newAudioPath,
          );
          if (tempSourcePath && existsSync(tempSourcePath)) {
            unlinkSync(tempSourcePath);
          }

          // Update transcript
          const updatedSrt = removeSrtEntryAndAdjustTimings(
            entries,
            entryIndex,
            removedDurationSec,
          );
          const newTxtPath = transcriptPath(newAudioPath);

          // Write updated transcript to new location
          writeFileSync(newTxtPath, updatedSrt, "utf-8");

          // Replace old audio file with new one and clean up old transcript
          if (!isReusable && audio.path !== newAudioPath) {
            unlinkSync(audio.path);
            // Delete old transcript if it exists and has a different name
            if (txtPath !== newTxtPath && existsSync(txtPath)) {
              unlinkSync(txtPath);
            }
          }
          let newDurationSec = removedDurationSec;
          try {
            const probe = await audioService.probeAudio(
              newAudioPath,
              uploadsDir(access.podcastId, episodeId),
            );
            newDurationSec = probe.durationSec;
          } catch {
            // fallback: subtract removed duration if probe fails
            newDurationSec = Math.max(
              0,
              ((segment.duration_sec as number | undefined) ?? 0) -
                removedDurationSec,
            );
          }
          if (isReusable) {
            db.prepare(
              `UPDATE episode_segments
               SET audio_path = ?, reusable_asset_id = NULL, type = 'recorded', duration_sec = ?
               WHERE id = ? AND episode_id = ?`,
            ).run(newAudioPath, newDurationSec, segmentId, episodeId);
          } else {
            db.prepare(
              "UPDATE episode_segments SET audio_path = ?, duration_sec = ? WHERE id = ? AND episode_id = ?",
            ).run(newAudioPath, newDurationSec, segmentId, episodeId);
          }

          return reply.send({ text: updatedSrt });
        } catch (err) {
          // Clean up new file if it exists
          try {
            if (existsSync(newAudioPath)) unlinkSync(newAudioPath);
          } catch {
            // ignore
          }
          request.log.error(err);
          return reply
            .status(500)
            .send({ error: "Failed to remove segment from audio" });
        }
      } else {
        // Delete entire transcript (original behavior)
        assertPathUnder(txtPath, audio.base);
        unlinkSync(txtPath);
        return reply.status(204).send();
      }
    },
  );

  app.delete(
    "/episodes/:episodeId/segments/:segmentId",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Delete segment",
        description: "Permanently delete a segment.",
        params: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            segmentId: { type: "string" },
          },
          required: ["episodeId", "segmentId"],
        },
        response: {
          204: { description: "Deleted" },
          400: { description: "Validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
          500: { description: "Processing failed" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeSegmentIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId, segmentId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit segments." });
      const row = db
        .prepare(
          "SELECT * FROM episode_segments WHERE id = ? AND episode_id = ?",
        )
        .get(segmentId, episodeId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: "Segment not found" });
      const path = row.audio_path as string | null;
      const { unlinkSync } = await import("fs");
      let bytesFreed = 0;
      if (path && existsSync(path)) {
        const base = uploadsDir(access.podcastId, episodeId);
        assertPathUnder(path, base);
        try {
          bytesFreed = statSync(path).size;
        } catch {
          bytesFreed = 0;
        }
        unlinkSync(path);
        const txtPath = transcriptPath(path);
        if (existsSync(txtPath)) {
          try {
            assertPathUnder(txtPath, base);
            unlinkSync(txtPath);
          } catch {
            // ignore if transcript path escapes base
          }
        }
      }
      db.prepare(
        "DELETE FROM episode_segments WHERE id = ? AND episode_id = ?",
      ).run(segmentId, episodeId);

      // Track disk usage (recorded segments): subtract from podcast owner
      const storageUserId =
        getPodcastOwnerId(access.podcastId) ?? request.userId;
      if (bytesFreed > 0) {
        db.prepare(
          `UPDATE users
           SET disk_bytes_used =
             CASE
               WHEN COALESCE(disk_bytes_used, 0) - ? < 0 THEN 0
               ELSE COALESCE(disk_bytes_used, 0) - ?
             END
           WHERE id = ?`,
        ).run(bytesFreed, bytesFreed, storageUserId);
      }

      return reply.status(204).send();
    },
  );

  app.get(
    "/episodes/:episodeId/transcript",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get episode transcript",
        description:
          "Returns the final episode transcript (SRT text) if it exists.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Transcript text",
            body: { type: "object", properties: { text: { type: "string" } } },
          },
          400: { description: "Validation failed" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const row = db
        .prepare(
          "SELECT id, podcast_id, audio_final_path FROM episodes WHERE id = ?",
        )
        .get(episodeId) as
        | { id: string; podcast_id: string; audio_final_path: string | null }
        | undefined;
      if (!row || !row.audio_final_path)
        return reply.status(404).send({ error: "Episode has no final audio" });
      const srtPath = transcriptSrtPath(row.podcast_id, episodeId);
      if (!existsSync(srtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      assertPathUnder(srtPath, processedDir(row.podcast_id, episodeId));
      const text = readFileSync(srtPath, "utf-8");
      return reply.send({ text });
    },
  );

  app.patch(
    "/episodes/:episodeId/transcript",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Update episode transcript",
        description:
          "Replace the final episode transcript text. Requires owner or editor and account not read-only or disabled.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        body: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        response: {
          200: { description: "Updated" },
          400: { description: "text required" },
          403: { description: "Permission denied" },
          404: { description: "Not found" },
        },
      },
    },
    async (request, reply) => {
      const paramsParsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(400)
          .send({ error: paramsParsed.error.issues[0]?.message ?? "Validation failed", details: paramsParsed.error.flatten() });
      }
      const { episodeId } = paramsParsed.data;
      const bodyParsed = segmentEpisodeTranscriptBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .status(400)
          .send({ error: bodyParsed.error.issues[0]?.message ?? "Validation failed", details: bodyParsed.error.flatten() });
      }
      const transcriptText = sanitizeTranscriptText(bodyParsed.data.text);
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({
            error: "You do not have permission to edit the transcript.",
          });
      const row = db
        .prepare(
          "SELECT id, podcast_id, audio_final_path FROM episodes WHERE id = ?",
        )
        .get(episodeId) as
        | { id: string; podcast_id: string; audio_final_path: string | null }
        | undefined;
      if (!row || !row.audio_final_path)
        return reply.status(404).send({ error: "Episode has no final audio" });
      const srtPath = transcriptSrtPath(row.podcast_id, episodeId);
      if (!existsSync(srtPath))
        return reply.status(404).send({ error: "Transcript not found" });
      assertPathUnder(srtPath, processedDir(row.podcast_id, episodeId));
      writeFileSync(srtPath, transcriptText, "utf-8");
      return reply.send({ text: transcriptText });
    },
  );

  app.get(
    "/episodes/:episodeId/transcript-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get transcript generation status",
        description:
          "Returns whether transcript generation is in progress, done, or failed. Poll after POST generate-transcript (202).",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          200: {
            description: "Transcript status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "transcribing", "done", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Validation failed" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const status = transcriptStatusByEpisode.get(episodeId) ?? "idle";
      const error =
        status === "failed"
          ? (transcriptErrorByEpisode.get(episodeId) ?? "Transcript generation failed")
          : undefined;
      if (status === "done" || status === "failed") {
        transcriptStatusByEpisode.delete(episodeId);
        transcriptErrorByEpisode.delete(episodeId);
      }
      return reply.send({ status, error });
    },
  );

  app.post(
    "/episodes/:episodeId/generate-transcript",
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ["Segments"],
        summary: "Generate episode transcript",
        description:
          "Start transcription (Whisper or OpenAI) on the final episode audio. Returns 202; poll GET /episodes/:episodeId/transcript-status until done or failed.",
        params: {
          type: "object",
          properties: { episodeId: { type: "string" } },
          required: ["episodeId"],
        },
        response: {
          202: {
            description: "Transcription started",
            type: "object",
            properties: { status: { type: "string", enum: ["transcribing"] } },
            required: ["status"],
          },
          409: {
            description: "Transcription already in progress",
            type: "object",
            properties: { status: { type: "string" }, message: { type: "string" } },
          },
          400: { description: "Transcription not configured" },
          403: { description: "Permission denied" },
          404: { description: "Episode or final audio not found" },
          413: { description: "Audio too large for transcription" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdOnlyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to edit this episode." });
      const row = db
        .prepare(
          "SELECT id, podcast_id, audio_final_path FROM episodes WHERE id = ?",
        )
        .get(episodeId) as
        | { id: string; podcast_id: string; audio_final_path: string | null }
        | undefined;
      if (!row || !row.audio_final_path)
        return reply.status(404).send({ error: "Episode has no final audio" });
      const audioPath = row.audio_final_path as string;
      if (!existsSync(audioPath))
        return reply.status(404).send({ error: "Final audio file not found" });
      const { podcastId } = access;
      const procDir = processedDir(podcastId, episodeId);
      assertPathUnder(audioPath, getDataDir());
      const settings = readSettings();
      if (!isTranscriptionProviderConfigured(settings)) {
        return reply
          .status(400)
          .send({
            error:
              "Set a transcription provider in Settings to generate transcripts.",
          });
      }
      const userRow = db
        .prepare(
          "SELECT COALESCE(can_transcribe, 0) AS can_transcribe FROM users WHERE id = ?",
        )
        .get(request.userId) as { can_transcribe: number } | undefined;
      if (userRow?.can_transcribe !== 1) {
        return reply
          .status(403)
          .send({ error: "You do not have permission to use transcription." });
      }
      if (transcriptStatusByEpisode.get(episodeId) === "transcribing") {
        return reply.status(409).send({
          status: "transcribing",
          message: "Transcript generation is already in progress.",
        });
      }
      transcriptStatusByEpisode.set(episodeId, "transcribing");
      transcriptErrorByEpisode.delete(episodeId);
      const log = request.log;
      setImmediate(() => {
        (async () => {
          try {
            const text = await runTranscription(audioPath, procDir, settings);
            const srtPath = transcriptSrtPath(podcastId, episodeId);
            assertResolvedPathUnder(srtPath, getDataDir());
            writeFileSync(srtPath, text, "utf-8");
            transcriptStatusByEpisode.set(episodeId, "done");
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "CHUNK_TOO_LARGE") {
              transcriptErrorByEpisode.set(
                episodeId,
                "Audio file is too large for the transcription service. Try a shorter episode or increase the server upload limit.",
              );
            } else {
              log.error(err);
              transcriptErrorByEpisode.set(
                episodeId,
                err instanceof Error ? err.message : "Transcript generation failed",
              );
            }
            transcriptStatusByEpisode.set(episodeId, "failed");
          }
        })();
      });
      return reply.status(202).send({ status: "transcribing" });
    },
  );

  app.get(
    "/episodes/:id/render-status",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Segments"],
        summary: "Get render status",
        description:
          "Returns whether a final episode build is in progress, done, or failed. Poll every 1–2s after starting a build.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: {
            description: "Render status",
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["idle", "building", "done", "failed"],
              },
              error: { type: "string" },
            },
            required: ["status"],
          },
          400: { description: "Validation failed" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      const status = renderStatusByEpisode.get(episodeId) ?? "idle";
      const error =
        status === "failed"
          ? (renderErrorByEpisode.get(episodeId) ?? "Render failed")
          : undefined;
      if (status === "done" || status === "failed") {
        renderStatusByEpisode.delete(episodeId);
        renderErrorByEpisode.delete(episodeId);
      }
      return reply.send({ status, error });
    },
  );

  app.post(
    "/episodes/:id/render",
    {
      preHandler: [
        requireAuth,
        requireNotReadOnly,
        userRateLimitPreHandler({ bucket: "ffmpeg", windowMs: 1000 }),
      ],
      schema: {
        tags: ["Segments"],
        summary: "Start render",
        description:
          "Start building the final episode audio. Returns immediately; poll GET /episodes/:id/render-status until status is done or failed.",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          202: {
            description: "Build started",
            type: "object",
            properties: { status: { type: "string", enum: ["building"] } },
            required: ["status"],
          },
          409: {
            description: "Build already in progress",
            type: "object",
            properties: {
              status: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { description: "No segments or validation failed" },
          403: { description: "Permission denied" },
          404: { description: "Episode not found" },
        },
      },
    },
    async (request, reply) => {
      const parsed = segmentEpisodeIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() });
      }
      const { id: episodeId } = parsed.data;
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access)
        return reply.status(404).send({ error: "Episode not found" });
      if (!canEditSegments(access.role))
        return reply
          .status(403)
          .send({ error: "You do not have permission to build the episode." });

      if (renderStatusByEpisode.get(episodeId) === "building") {
        return reply
          .status(409)
          .send({
            status: "building",
            message: "A build is already in progress for this episode.",
          });
      }

      const { podcastId } = access;
      const segments = db
        .prepare(
          "SELECT * FROM episode_segments WHERE episode_id = ? ORDER BY position ASC, created_at ASC",
        )
        .all(episodeId) as Record<string, unknown>[];
      if (segments.length === 0) {
        return reply
          .status(400)
          .send({ error: "Add at least one section before rendering." });
      }
      const DATA_DIR = getDataDir();
      const paths: string[] = [];
      for (const s of segments) {
        if (
          s.type === "recorded" &&
          s.audio_path &&
          existsSync(s.audio_path as string)
        ) {
          assertPathUnder(s.audio_path as string, DATA_DIR);
          paths.push(s.audio_path as string);
        } else if (s.type === "reusable" && s.reusable_asset_id) {
          const asset = db
            .prepare("SELECT audio_path FROM reusable_assets WHERE id = ?")
            .get(s.reusable_asset_id) as { audio_path: string } | undefined;
          if (asset?.audio_path && existsSync(asset.audio_path)) {
            assertPathUnder(asset.audio_path, DATA_DIR);
            paths.push(asset.audio_path);
          }
        }
      }
      if (paths.length === 0)
        return reply
          .status(400)
          .send({ error: "No valid segment audio found." });
      const copyrightLines: string[] = [];
      for (const s of segments) {
        if (s.type === "reusable" && s.reusable_asset_id) {
          const asset = db
            .prepare("SELECT name, copyright FROM reusable_assets WHERE id = ?")
            .get(s.reusable_asset_id) as
            | { name: string; copyright: string | null }
            | undefined;
          const copyright =
            asset?.copyright != null ? String(asset.copyright).trim() : "";
          if (copyright) {
            const name =
              s.name != null && String(s.name).trim() !== ""
                ? String(s.name).trim()
                : (asset?.name ?? "");
            copyrightLines.push(`${name || "Segment"} by ${copyright}`);
          }
        }
      }
      const descriptionCopyrightSnapshot =
        copyrightLines.length > 0 ? copyrightLines.join("\n") : null;
      const settings = readSettings();
      const outPath = audioService.getFinalOutputPath(
        podcastId,
        episodeId,
        settings.final_format,
      );

      renderStatusByEpisode.set(episodeId, "building");
      renderErrorByEpisode.delete(episodeId);

      const srtPath = transcriptSrtPath(podcastId, episodeId);
      if (existsSync(srtPath)) {
        try {
          assertPathUnder(srtPath, DATA_DIR);
          unlinkSync(srtPath);
        } catch (err) {
          request.log.warn({ err, episodeId }, "Failed to delete episode transcript before build");
        }
      }

      const log = request.log;
      setImmediate(() => {
        (async () => {
          try {
            await audioService.concatToFinal(paths, outPath, {
              format: settings.final_format,
              bitrateKbps: settings.final_bitrate_kbps,
              channels: settings.final_channels,
            });
            const meta = await audioService.getAudioMetaAfterProcess(
              podcastId,
              episodeId,
              settings.final_format,
            );
            db.prepare(
              `UPDATE episodes SET
                audio_final_path = ?,
                audio_source_path = ?,
                audio_mime = ?,
                audio_bytes = ?,
                audio_duration_sec = ?,
                description_copyright_snapshot = ?,
                updated_at = datetime('now')
               WHERE id = ?`,
            ).run(
              outPath,
              outPath,
              meta.mime,
              meta.sizeBytes,
              meta.durationSec,
              descriptionCopyrightSnapshot,
              episodeId,
            );
            const epRow = db
              .prepare("SELECT status, publish_at FROM episodes WHERE id = ?")
              .get(episodeId) as
              | { status: string; publish_at: string | null }
              | undefined;
            const isPublic =
              epRow?.status === "published" &&
              (epRow.publish_at == null ||
                new Date(epRow.publish_at) <= new Date());
            if (isPublic) {
              try {
                writeRssFile(podcastId, null);
                deleteTokenFeedTemplateFile(podcastId);
                notifyWebSubHub(podcastId, null);
              } catch (err) {
                log.warn(
                  { err, podcastId },
                  "Failed to regenerate RSS feed after episode render",
                );
              }
            }
            try {
              await audioService.generateWaveformFile(
                outPath,
                processedDir(podcastId, episodeId),
              );
            } catch (err) {
              log.warn(
                { err, episodeId },
                "Waveform generation failed after render",
              );
            }
            renderStatusByEpisode.set(episodeId, "done");
          } catch (err) {
            log.error(err);
            renderStatusByEpisode.set(episodeId, "failed");
            renderErrorByEpisode.set(
              episodeId,
              err instanceof Error ? err.message : "Render failed",
            );
          }
        })();
      });

      return reply.status(202).send({ status: "building" });
    },
  );
}
