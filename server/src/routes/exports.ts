import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { requireAuth } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { exportCreateSchema, exportUpdateSchema } from '@harborfm/shared';
import { testS3Access } from '../services/s3.js';
import { generateRss } from '../services/rss.js';
import { deployPodcastToS3 } from '../services/s3.js';
import { writeRssFile } from '../services/rss.js';
import { decryptSecret, encryptSecret, isEncryptedSecret, redactAccessKeyId } from '../services/secrets.js';

function canAccessPodcast(userId: string, podcastId: string): boolean {
  const row = db.prepare('SELECT id FROM podcasts WHERE id = ? AND owner_user_id = ?').get(podcastId, userId);
  return !!row;
}

function getExport(userId: string, exportId: string): Record<string, unknown> | null {
  const row = db
    .prepare(
      `SELECT ex.* FROM exports ex
       JOIN podcasts p ON p.id = ex.podcast_id
       WHERE ex.id = ? AND p.owner_user_id = ?`
    )
    .get(exportId, userId) as Record<string, unknown> | undefined;
  return row ?? null;
}

function exportDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    podcast_id: row.podcast_id,
    provider: row.provider,
    name: row.name,
    bucket: row.bucket,
    prefix: row.prefix,
    region: row.region,
    endpoint_url: row.endpoint_url ?? null,
    public_base_url: row.public_base_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_credentials: true,
  };
}

function getDecryptedS3Config(exp: Record<string, unknown>): {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string | null;
  accessKeyId: string;
  secretAccessKey: string;
} {
  const accessKeyEnc = exp.access_key_id_enc as string | null | undefined;
  const secretEnc = exp.secret_access_key_enc as string | null | undefined;
  const endpointUrl = (exp.endpoint_url as string | null | undefined)?.trim() || null;

  // Preferred path: encrypted columns
  if (accessKeyEnc && secretEnc && isEncryptedSecret(accessKeyEnc) && isEncryptedSecret(secretEnc)) {
    return {
      bucket: exp.bucket as string,
      prefix: (exp.prefix as string) ?? '',
      region: exp.region as string,
      endpoint: endpointUrl,
      accessKeyId: decryptSecret(accessKeyEnc, 'harborfm:exports'),
      secretAccessKey: decryptSecret(secretEnc, 'harborfm:exports'),
    };
  }

  // Legacy path (pre-migration): plaintext columns.
  const accessKeyPlain = exp.access_key_id as string;
  const secretPlain = exp.secret_access_key as string;
  if (!accessKeyPlain || !secretPlain) {
    throw new Error('Missing export credentials');
  }

  // Lazy-migrate: encrypt and store, then redact plaintext column values.
  try {
    const nextAccessEnc = encryptSecret(accessKeyPlain, 'harborfm:exports');
    const nextSecretEnc = encryptSecret(secretPlain, 'harborfm:exports');
    db.prepare(
      `UPDATE exports SET
        access_key_id = ?,
        secret_access_key = ?,
        access_key_id_enc = ?,
        secret_access_key_enc = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      redactAccessKeyId(accessKeyPlain),
      '(encrypted)',
      nextAccessEnc,
      nextSecretEnc,
      exp.id
    );
  } catch {
    // Best-effort only; continue using plaintext for this request.
  }

  return {
    bucket: exp.bucket as string,
    prefix: (exp.prefix as string) ?? '',
    region: exp.region as string,
    endpoint: endpointUrl,
    accessKeyId: accessKeyPlain,
    secretAccessKey: secretPlain,
  };
}

export async function exportRoutes(app: FastifyInstance) {
  app.post(
    '/api/podcasts/:id/exports',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const existing = db.prepare('SELECT id FROM exports WHERE podcast_id = ? LIMIT 1').get(podcastId) as { id: string } | undefined;
      if (existing) {
        return reply.status(409).send({ error: 'An export destination is already configured for this podcast.' });
      }
      const parsed = exportCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const expId = nanoid();
      const data = parsed.data;
      const rawBody = request.body as Record<string, unknown>;
      const endpointUrl = (data as Record<string, unknown>).endpoint_url ?? rawBody.endpoint_url ?? null;
      const endpointUrlNorm = typeof endpointUrl === 'string' && endpointUrl.trim() ? endpointUrl.trim() : null;
      const accessKeyIdEnc = encryptSecret(data.access_key_id, 'harborfm:exports');
      const secretAccessKeyEnc = encryptSecret(data.secret_access_key, 'harborfm:exports');
      db.prepare(
        `INSERT INTO exports (
          id, podcast_id, provider, name, bucket, prefix, region, endpoint_url,
          access_key_id, secret_access_key,
          access_key_id_enc, secret_access_key_enc,
          public_base_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        expId,
        podcastId,
        data.provider,
        data.name,
        data.bucket,
        data.prefix ?? '',
        data.region,
        endpointUrlNorm,
        redactAccessKeyId(data.access_key_id),
        '(encrypted)',
        accessKeyIdEnc,
        secretAccessKeyEnc,
        data.public_base_url ?? null
      );
      const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(expId) as Record<string, unknown>;
      return reply.status(201).send(exportDto(row));
    }
  );

  app.get(
    '/api/podcasts/:id/exports',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const rows = db
        .prepare(
          `SELECT id, podcast_id, provider, name, bucket, prefix, region, endpoint_url, public_base_url, created_at, updated_at
           FROM exports WHERE podcast_id = ? ORDER BY updated_at DESC`
        )
        .all(podcastId) as Record<string, unknown>[];
      return { exports: rows.map(exportDto) };
    }
  );

  app.patch(
    '/api/exports/:exportId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: 'Export not found' });

      const parsed = exportUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const data = parsed.data;
      const rawBody = request.body as Record<string, unknown>;
      const endpointUrlRaw = (data as Record<string, unknown>).endpoint_url ?? rawBody.endpoint_url;
      const endpointUrlNorm =
        endpointUrlRaw !== undefined
          ? (typeof endpointUrlRaw === 'string' && endpointUrlRaw.trim() ? endpointUrlRaw.trim() : null)
          : undefined;

      const wantsAccessKey = data.access_key_id !== undefined;
      const wantsSecretKey = data.secret_access_key !== undefined;
      if (wantsAccessKey !== wantsSecretKey) {
        return reply.status(400).send({ error: 'Provide both access_key_id and secret_access_key when updating credentials' });
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      const map: Record<string, unknown> = {
        name: data.name,
        bucket: data.bucket,
        prefix: data.prefix,
        region: data.region,
        ...(endpointUrlNorm !== undefined && { endpoint_url: endpointUrlNorm }),
        public_base_url: data.public_base_url,
      };
      for (const [k, v] of Object.entries(map)) {
        if (v !== undefined) {
          fields.push(`${k} = ?`);
          values.push(v);
        }
      }

      if (wantsAccessKey && wantsSecretKey) {
        const accessKeyId = String(data.access_key_id);
        const secretAccessKey = String(data.secret_access_key);
        const accessKeyIdEnc = encryptSecret(accessKeyId, 'harborfm:exports');
        const secretAccessKeyEnc = encryptSecret(secretAccessKey, 'harborfm:exports');
        fields.push('access_key_id = ?');
        values.push(redactAccessKeyId(accessKeyId));
        fields.push('secret_access_key = ?');
        values.push('(encrypted)');
        fields.push('access_key_id_enc = ?');
        values.push(accessKeyIdEnc);
        fields.push('secret_access_key_enc = ?');
        values.push(secretAccessKeyEnc);
      }

      if (fields.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      fields.push("updated_at = datetime('now')");
      values.push(exportId);
      db.prepare(`UPDATE exports SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(exportId) as Record<string, unknown>;
      return reply.send(exportDto(row));
    }
  );

  app.post(
    '/api/exports/:exportId/test',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: 'Export not found' });
      let config;
      try {
        config = getDecryptedS3Config(exp);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(400).send({ ok: false, error: msg });
      }
      const result = await testS3Access({
        ...config,
      });
      if (!result.ok && result.error) {
        request.log.warn({ exportId, error: result.error }, 'S3 export test failed');
      }
      return result;
    }
  );

  app.post(
    '/api/exports/:exportId/deploy',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: 'Export not found' });
      const podcastId = exp.podcast_id as string;
      const publicBaseUrl = (exp.public_base_url as string) ?? null;
      let config;
      try {
        config = getDecryptedS3Config(exp);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(400).send({ error: msg });
      }
      const runId = nanoid();
      db.prepare(
        `INSERT INTO export_runs (id, export_id, podcast_id, status, started_at) VALUES (?, ?, ?, 'running', datetime('now'))`
      ).run(runId, exportId, podcastId);
      try {
        const xml = generateRss(podcastId, publicBaseUrl);
        const episodes = db
          .prepare(
            `SELECT id, audio_final_path, audio_mime FROM episodes WHERE podcast_id = ? AND status = 'published'
             AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`
          )
          .all(podcastId) as { id: string; audio_final_path: string | null; audio_mime?: string | null }[];
        const { uploaded, skipped, errors } = await deployPodcastToS3(config, publicBaseUrl, xml, episodes);
        const log =
          errors.length > 0
            ? `Uploaded ${uploaded}, skipped ${skipped}. Errors: ${errors.join('; ')}`
            : `Uploaded ${uploaded} file(s), skipped ${skipped} unchanged.`;
        db.prepare(
          `UPDATE export_runs SET status = ?, finished_at = datetime('now'), log = ? WHERE id = ?`
        ).run(errors.length > 0 ? 'failed' : 'success', log, runId);
        writeRssFile(podcastId, publicBaseUrl);
        return {
          run_id: runId,
          status: errors.length > 0 ? 'failed' : 'success',
          uploaded,
          skipped,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.prepare(
          `UPDATE export_runs SET status = 'failed', finished_at = datetime('now'), log = ? WHERE id = ?`
        ).run(message, runId);
        return reply.status(500).send({ error: 'Deploy failed', detail: message });
      }
    }
  );

  app.get(
    '/api/export-runs/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = db
        .prepare(
          `SELECT r.* FROM export_runs r
           JOIN podcasts p ON p.id = r.podcast_id
           WHERE r.id = ? AND p.owner_user_id = ?`
        )
        .get(id, request.userId);
      if (!row) return reply.status(404).send({ error: 'Run not found' });
      return row as Record<string, unknown>;
    }
  );
}
