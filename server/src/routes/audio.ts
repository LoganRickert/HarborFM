import type { FastifyInstance } from 'fastify';
import { createReadStream, statSync, unlinkSync } from 'fs';
import { extname, dirname, basename } from 'path';
import send from '@fastify/send';
import { existsSync } from 'fs';
import { db } from '../db/index.js';
import { requireAuth } from '../plugins/auth.js';
import { uploadsDir, processedDir, assertPathUnder } from '../services/paths.js';
import * as audioService from '../services/audio.js';
import { FileTooLargeError, streamToFileWithLimit } from '../services/uploads.js';
import { readSettings } from './settings.js';
import { userRateLimitPreHandler } from '../services/rateLimit.js';

const ALLOWED_MIME = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'];
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

function canAccessEpisode(userId: string, episodeId: string): { episode: Record<string, unknown>; podcastId: string } | null {
  const row = db
    .prepare(
      `SELECT e.* FROM episodes e
       JOIN podcasts p ON p.id = e.podcast_id
       WHERE e.id = ? AND p.owner_user_id = ?`
    )
    .get(episodeId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const podcastId = row.podcast_id as string;
  return { episode: row, podcastId };
}

export async function audioRoutes(app: FastifyInstance) {
  app.post(
    '/api/episodes/:id/audio',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const { podcastId } = access;

      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });
      const mimetype = data.mimetype || '';
      if (!ALLOWED_MIME.includes(mimetype) && !mimetype.startsWith('audio/')) {
        return reply.status(400).send({ error: 'Invalid file type. Use WAV or MP3.' });
      }
      const ext = mimetype.includes('wav') ? 'wav' : 'mp3';
      const dir = uploadsDir(podcastId, episodeId);
      const destPath = `${dir}/source.${ext}`;
      // Remove any previous source files to avoid orphaned disk usage.
      // We only ever write source.wav or source.mp3.
      let bytesRemoved = 0;
      for (const p of [`${dir}/source.wav`, `${dir}/source.mp3`]) {
        if (p === destPath) continue;
        if (!existsSync(p)) continue;
        try {
          bytesRemoved += statSync(p).size;
        } catch {
          // ignore
        }
        try {
          unlinkSync(p);
        } catch {
          // ignore
        }
      }

      let oldDestBytes = 0;
      if (existsSync(destPath)) {
        try {
          oldDestBytes = statSync(destPath).size;
        } catch {
          oldDestBytes = 0;
        }
      }

      let bytesWritten = 0;
      try {
        bytesWritten = await streamToFileWithLimit(data.file, destPath, MAX_FILE_BYTES);
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          return reply.status(400).send({ error: 'File too large' });
        }
        request.log.error(err);
        return reply.status(500).send({ error: 'Upload failed' });
      }

      let durationSec = 0;
      let sizeBytes = bytesWritten;
      let audioMime = mimetype;
      try {
        const probe = await audioService.probeAudio(destPath, dir);
        durationSec = probe.durationSec;
        sizeBytes = probe.sizeBytes;
        audioMime = probe.mime ?? mimetype;
      } catch {
        // keep defaults
      }

      // Track disk usage delta (best-effort)
      const delta = (sizeBytes || 0) - oldDestBytes - bytesRemoved;
      if (delta !== 0) {
        db.prepare(
          `UPDATE users
           SET disk_bytes_used =
             CASE
               WHEN COALESCE(disk_bytes_used, 0) + ? < 0 THEN 0
               ELSE COALESCE(disk_bytes_used, 0) + ?
             END
           WHERE id = ?`
        ).run(delta, delta, request.userId);
      }

      db.prepare(
        `UPDATE episodes SET
          audio_source_path = ?,
          audio_mime = ?,
          audio_bytes = ?,
          audio_duration_sec = ?,
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(destPath, audioMime, sizeBytes, durationSec, episodeId);

      const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Record<string, unknown>;
      return row;
    }
  );

  app.post(
    '/api/episodes/:id/process-audio',
    { preHandler: [requireAuth, userRateLimitPreHandler({ bucket: 'ffmpeg', windowMs: 1000 })] },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const { podcastId, episode } = access;
      const sourcePath = episode.audio_source_path as string | undefined;
      if (!sourcePath || !existsSync(sourcePath)) {
        return reply.status(400).send({ error: 'No audio uploaded for this episode' });
      }
      try {
        const settings = readSettings();
        const finalPath = await audioService.transcodeToFinal(sourcePath, podcastId, episodeId, {
          format: settings.final_format,
          bitrateKbps: settings.final_bitrate_kbps,
          channels: settings.final_channels,
        });
        const meta = await audioService.getAudioMetaAfterProcess(podcastId, episodeId, settings.final_format);
        db.prepare(
          `UPDATE episodes SET
            audio_final_path = ?,
            audio_mime = ?,
            audio_bytes = ?,
            audio_duration_sec = ?,
            updated_at = datetime('now')
           WHERE id = ?`
        ).run(finalPath, meta.mime, meta.sizeBytes, meta.durationSec, episodeId);
        const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Record<string, unknown>;
        return row;
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Audio processing failed' });
      }
    }
  );

  app.get(
    '/api/episodes/:id/download',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: episodeId } = request.params as { id: string };
      const type = (request.query as { type?: string }).type ?? 'final';
      const access = canAccessEpisode(request.userId, episodeId);
      if (!access) return reply.status(404).send({ error: 'Episode not found' });
      const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Record<string, unknown>;
      const path = type === 'source' ? episode.audio_source_path : episode.audio_final_path;
      const p = path as string | null;
      if (!p || !existsSync(p)) {
        return reply.status(404).send({ error: type === 'source' ? 'No source audio' : 'No processed audio. Run Process first.' });
      }
      const allowedBase = type === 'source'
        ? uploadsDir(access.podcastId, episodeId)
        : processedDir(access.podcastId, episodeId);
      const safePath = assertPathUnder(p, allowedBase);
      const ext = extname(safePath) || (type === 'source' ? '' : '.mp3');
      const filename = type === 'source' ? `episode-source-${episodeId}${ext}` : `episode-${episodeId}${ext}`;
      const mime = type === 'source' ? (episode.audio_mime as string) || 'audio/mpeg' : (episode.audio_mime as string) || 'audio/mpeg';
      return reply
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .type(mime)
        .send(createReadStream(safePath));
    }
  );

  // Public endpoint for serving episode MP3s with podcast ID in path (for RSS feed enclosures)
  // Format: /api/<podcastId>/episodes/<episodeId>
  app.get(
    '/api/:podcastId/episodes/:episodeId',
    async (request, reply) => {
      const settings = readSettings();
      if (!settings.public_feeds_enabled) {
        return reply.status(404).send({ error: 'Not found' });
      }
      const { podcastId, episodeId } = request.params as { podcastId: string; episodeId: string };
      
      // Validate IDs exist and are non-empty
      if (!podcastId || !podcastId.trim() || !episodeId || !episodeId.trim()) {
        return reply.status(400).send({ error: 'Invalid podcast or episode ID' });
      }

      // Verify podcast exists
      const podcast = db
        .prepare('SELECT id FROM podcasts WHERE id = ?')
        .get(podcastId.trim()) as { id: string } | undefined;
      
      if (!podcast) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }

      // Verify episode exists, belongs to podcast, and is published
      const episode = db
        .prepare(
          `SELECT e.* FROM episodes e
           WHERE e.id = ? AND e.podcast_id = ? AND e.status = 'published'
           AND (e.publish_at IS NULL OR datetime(e.publish_at) <= datetime('now'))`
        )
        .get(episodeId.trim(), podcastId.trim()) as Record<string, unknown> | undefined;
      
      if (!episode) {
        return reply.status(404).send({ error: 'Episode not found' });
      }

      const path = episode.audio_final_path as string | null;
      if (!path || !existsSync(path)) {
        return reply.status(404).send({ error: 'Audio file not found' });
      }

      const allowedBase = processedDir(podcastId.trim(), episodeId.trim());
      const safePath = assertPathUnder(path, allowedBase);
      const mime = (episode.audio_mime as string) || 'audio/mpeg';

      const result = await send(request.raw, basename(safePath), {
        root: dirname(safePath),
        contentType: false, // set manually from episode.audio_mime
        maxAge: 3600,
        acceptRanges: true,
        cacheControl: true,
      });

      if (result.type === 'error') {
        const err = result.metadata.error as Error & { status?: number };
        const status = err.status ?? 500;
        const message = err.message ?? 'Internal Server Error';
        return reply.status(status).send({ error: message });
      }

      reply.code(result.statusCode);
      const headers = result.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(key, value);
      }
      reply.header('Content-Type', mime);
      return reply.send(result.stream);
    }
  );
}
