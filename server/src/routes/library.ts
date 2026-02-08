import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'fs';
import { dirname, basename } from 'path';
import send from '@fastify/send';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../plugins/auth.js';
import { libraryDir, libraryAssetPath } from '../services/paths.js';
import { assertPathUnder } from '../services/paths.js';
import * as audioService from '../services/audio.js';
import { FileTooLargeError, streamToFileWithLimit } from '../services/uploads.js';

const ALLOWED_MIME = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg'];
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per library asset

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/api/library', { preHandler: [requireAuth] }, async (request) => {
    const rows = db
      .prepare(
        `SELECT id, name, tag, duration_sec, created_at FROM reusable_assets
         WHERE owner_user_id = ? ORDER BY name`
      )
      .all(request.userId) as Record<string, unknown>[];
    return { assets: rows };
  });

  app.get('/api/library/user/:userId', { preHandler: [requireAdmin] }, async (request) => {
    const { userId } = request.params as { userId: string };
    const rows = db
      .prepare(
        `SELECT id, name, tag, duration_sec, created_at FROM reusable_assets
         WHERE owner_user_id = ? ORDER BY name`
      )
      .all(userId) as Record<string, unknown>[];
    return { assets: rows };
  });

  app.post(
    '/api/library',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });
      const mimetype = data.mimetype || '';
      if (!ALLOWED_MIME.includes(mimetype) && !mimetype.startsWith('audio/')) {
        return reply.status(400).send({ error: 'Invalid file type. Use WAV, MP3, or WebM.' });
      }
      const name = (data.fields?.name as { value?: string })?.value?.trim() || data.filename?.replace(/\.[^.]+$/, '') || 'Untitled';
      const tag = (data.fields?.tag as { value?: string })?.value?.trim() || null;
      const id = nanoid();
      const ext = mimetype.includes('wav') ? 'wav' : mimetype.includes('webm') ? 'webm' : mimetype.includes('ogg') ? 'ogg' : 'mp3';
      const destPath = libraryAssetPath(request.userId, id, ext);
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
      const dir = libraryDir(request.userId);
      try {
        const probe = await audioService.probeAudio(destPath, dir);
        durationSec = probe.durationSec;
      } catch {
        // keep 0
      }

      db.prepare(
        `INSERT INTO reusable_assets (id, owner_user_id, name, tag, audio_path, duration_sec)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, request.userId, name, tag, destPath, durationSec);

      // Track disk usage (best-effort)
      db.prepare(
        `UPDATE users
         SET disk_bytes_used = COALESCE(disk_bytes_used, 0) + ?
         WHERE id = ?`
      ).run(bytesWritten, request.userId);

      const row = db.prepare('SELECT * FROM reusable_assets WHERE id = ?').get(id) as Record<string, unknown>;
      return reply.status(201).send(row);
    }
  );

  app.patch('/api/library/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; tag?: string | null } | undefined;
    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (body?.name !== undefined) {
      const name = body.name.trim();
      if (!name) return reply.status(400).send({ error: 'Name is required' });
      updates.push('name = ?');
      values.push(name);
    }
    if (body?.tag !== undefined) {
      const tag = body.tag === null ? null : body.tag.trim();
      updates.push('tag = ?');
      values.push(tag || null);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    values.push(id);
    values.push(request.userId);
    db.prepare(`UPDATE reusable_assets SET ${updates.join(', ')} WHERE id = ? AND owner_user_id = ?`).run(...values);
    const row = db
      .prepare('SELECT id, name, tag, duration_sec, created_at FROM reusable_assets WHERE id = ? AND owner_user_id = ?')
      .get(id, request.userId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Asset not found' });
    return reply.send(row);
  });

  app.delete('/api/library/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db
      .prepare('SELECT * FROM reusable_assets WHERE id = ? AND owner_user_id = ?')
      .get(id, request.userId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Asset not found' });
    const { unlinkSync } = await import('fs');
    const path = row.audio_path as string;
    let bytesFreed = 0;
    if (path && existsSync(path)) {
      const base = libraryDir(request.userId);
      assertPathUnder(path, base);
      try {
        bytesFreed = statSync(path).size;
      } catch {
        bytesFreed = 0;
      }
      unlinkSync(path);
    }
    db.prepare('DELETE FROM reusable_assets WHERE id = ?').run(id);

    if (bytesFreed > 0) {
      db.prepare(
        `UPDATE users
         SET disk_bytes_used =
           CASE
             WHEN COALESCE(disk_bytes_used, 0) - ? < 0 THEN 0
             ELSE COALESCE(disk_bytes_used, 0) - ?
           END
         WHERE id = ?`
      ).run(bytesFreed, bytesFreed, request.userId);
    }

    return reply.status(204).send();
  });

  app.patch('/api/library/user/:userId/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const body = request.body as { name?: string; tag?: string | null } | undefined;
    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (body?.name !== undefined) {
      const name = body.name.trim();
      if (!name) return reply.status(400).send({ error: 'Name is required' });
      updates.push('name = ?');
      values.push(name);
    }
    if (body?.tag !== undefined) {
      const tag = body.tag === null ? null : body.tag.trim();
      updates.push('tag = ?');
      values.push(tag || null);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    values.push(id);
    values.push(userId);
    db.prepare(`UPDATE reusable_assets SET ${updates.join(', ')} WHERE id = ? AND owner_user_id = ?`).run(...values);
    const row = db
      .prepare('SELECT id, name, tag, duration_sec, created_at FROM reusable_assets WHERE id = ? AND owner_user_id = ?')
      .get(id, userId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Asset not found' });
    return reply.send(row);
  });

  app.delete('/api/library/user/:userId/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const row = db
      .prepare('SELECT * FROM reusable_assets WHERE id = ? AND owner_user_id = ?')
      .get(id, userId) as Record<string, unknown> | undefined;
    if (!row) return reply.status(404).send({ error: 'Asset not found' });
    const { unlinkSync } = await import('fs');
    const path = row.audio_path as string;
    let bytesFreed = 0;
    if (path && existsSync(path)) {
      const base = libraryDir(userId);
      assertPathUnder(path, base);
      try {
        bytesFreed = statSync(path).size;
      } catch {
        bytesFreed = 0;
      }
      unlinkSync(path);
    }
    db.prepare('DELETE FROM reusable_assets WHERE id = ?').run(id);

    if (bytesFreed > 0) {
      db.prepare(
        `UPDATE users
         SET disk_bytes_used =
           CASE
             WHEN COALESCE(disk_bytes_used, 0) - ? < 0 THEN 0
             ELSE COALESCE(disk_bytes_used, 0) - ?
           END
         WHERE id = ?`
      ).run(bytesFreed, bytesFreed, userId);
    }

    return reply.status(204).send();
  });

  function libraryStreamContentType(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.webm')) return 'audio/webm';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
    return 'audio/mpeg';
  }

  async function sendLibraryStream(
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
    safePath: string,
    contentType: string
  ) {
    const result = await send(request.raw, basename(safePath), {
      root: dirname(safePath),
      contentType: false,
      acceptRanges: true,
      cacheControl: false,
    });

    if (result.type === 'error') {
      const err = result.metadata.error as Error & { status?: number };
      return reply.status(err.status ?? 500).send({ error: err.message ?? 'Internal Server Error' });
    }

    reply.code(result.statusCode);
    const headers = result.headers as Record<string, string>;
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) reply.header(key, value);
    }
    reply.header('Content-Type', contentType);
    return reply.send(result.stream);
  }

  app.get(
    '/api/library/:id/stream',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = db
        .prepare('SELECT * FROM reusable_assets WHERE id = ? AND owner_user_id = ?')
        .get(id, request.userId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: 'Asset not found' });
      const path = row.audio_path as string;
      if (!path || !existsSync(path)) return reply.status(404).send({ error: 'File not found' });
      const base = libraryDir(request.userId);
      const safePath = assertPathUnder(path, base);
      const contentType = libraryStreamContentType(path);
      return sendLibraryStream(request, reply, safePath, contentType);
    }
  );

  app.get(
    '/api/library/user/:userId/:id/stream',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const row = db
        .prepare('SELECT * FROM reusable_assets WHERE id = ? AND owner_user_id = ?')
        .get(id, userId) as Record<string, unknown> | undefined;
      if (!row) return reply.status(404).send({ error: 'Asset not found' });
      const path = row.audio_path as string;
      if (!path || !existsSync(path)) return reply.status(404).send({ error: 'File not found' });
      const base = libraryDir(userId);
      const safePath = assertPathUnder(path, base);
      const contentType = libraryStreamContentType(path);
      return sendLibraryStream(request, reply, safePath, contentType);
    }
  );
}
