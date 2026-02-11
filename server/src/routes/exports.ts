import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { requireAuth, requireNotReadOnly } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { canAccessPodcast } from '../services/access.js';
import { exportCreateSchema, exportUpdateSchema, type ExportCreate } from '@harborfm/shared';
import { testS3Access, deployPodcastToS3 } from '../services/s3.js';
import { testFtpAccess, deployPodcastToFtp } from '../services/ftp.js';
import { testSftpAccess, deployPodcastToSftp } from '../services/sftp.js';
import { testWebdavAccess, deployPodcastToWebdav } from '../services/webdav.js';
import { testIpfsAccess, deployPodcastToIpfs } from '../services/ipfs.js';
import { testSmbAccess, deployPodcastToSmb } from '../services/smb.js';
import { generateRss } from '../services/rss.js';
import { writeRssFile } from '../services/rss.js';
import { buildConfigEnc, getDecryptedConfigFromEnc, mergeAndEncryptConfig, type ExportMode } from '../services/export-config.js';

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
  const mode = (row.mode as string) ?? 'S3';
  let bucket: string | null = null;
  let prefix: string | null = null;
  let region: string | null = null;
  let endpoint_url: string | null = null;
  if (mode === 'S3') {
    try {
      const out = getDecryptedConfigFromEnc(row);
      if (out.mode === 'S3') {
        bucket = out.config.bucket ?? null;
        prefix = out.config.prefix ?? null;
        region = out.config.region ?? null;
        endpoint_url = null;
      }
    } catch {
      // config missing or invalid
    }
  }
  return {
    id: row.id,
    podcast_id: row.podcast_id,
    provider: mode.toLowerCase(),
    mode,
    name: row.name,
    bucket,
    prefix,
    region,
    endpoint_url,
    public_base_url: row.public_base_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_credentials: true,
  };
}

type DeployParams = {
  publicBaseUrl: string | null;
  xml: string;
  episodes: { id: string; audio_final_path: string | null; audio_mime?: string | null; artwork_path?: string | null }[];
  artworkPath: string | null;
  podcastId: string;
};

async function runDeploy(
  mode: string,
  config: unknown,
  params: DeployParams
): Promise<{ uploaded: number; skipped: number; errors: string[] }> {
  const { publicBaseUrl, xml, episodes, artworkPath, podcastId } = params;
  switch (mode) {
    case 'S3':
      return deployPodcastToS3(config as Parameters<typeof deployPodcastToS3>[0], publicBaseUrl, xml, episodes, artworkPath);
    case 'FTP':
      return deployPodcastToFtp(config as Parameters<typeof deployPodcastToFtp>[0], publicBaseUrl, xml, episodes, artworkPath);
    case 'SFTP':
      return deployPodcastToSftp(config as Parameters<typeof deployPodcastToSftp>[0], publicBaseUrl, xml, episodes, artworkPath);
    case 'WebDAV':
      return deployPodcastToWebdav(config as Parameters<typeof deployPodcastToWebdav>[0], publicBaseUrl, xml, episodes, artworkPath);
    case 'IPFS':
      return deployPodcastToIpfs(config as Parameters<typeof deployPodcastToIpfs>[0], publicBaseUrl, xml, episodes, artworkPath, podcastId);
    case 'SMB':
      return deployPodcastToSmb(config as Parameters<typeof deployPodcastToSmb>[0], publicBaseUrl, xml, episodes, artworkPath);
    default:
      return { uploaded: 0, skipped: 0, errors: [`Unsupported mode: ${mode}`] };
  }
}

function runTest(mode: string, config: unknown): Promise<{ ok: boolean; error?: string }> {
  switch (mode) {
    case 'S3':
      return testS3Access(config as Parameters<typeof testS3Access>[0]);
    case 'FTP':
      return testFtpAccess(config as Parameters<typeof testFtpAccess>[0]);
    case 'SFTP':
      return testSftpAccess(config as Parameters<typeof testSftpAccess>[0]);
    case 'WebDAV':
      return testWebdavAccess(config as Parameters<typeof testWebdavAccess>[0]);
    case 'IPFS':
      return testIpfsAccess(config as Parameters<typeof testIpfsAccess>[0]);
    case 'SMB':
      return testSmbAccess(config as Parameters<typeof testSmbAccess>[0]);
    default:
      return Promise.resolve({ ok: false, error: `Unsupported mode: ${mode}` });
  }
}

export async function exportRoutes(app: FastifyInstance) {
  app.post(
    '/api/podcasts/:id/exports',
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Exports'],
        summary: 'Create export',
        description: 'Add a delivery destination (S3, FTP, SFTP, WebDAV, IPFS, SMB) for a podcast.',
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        body: { type: 'object', description: 'Export config (mode, name, credentials)' },
        response: { 201: { description: 'Created export' }, 400: { description: 'Validation failed' }, 404: { description: 'Podcast not found' } },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const parsed = exportCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const expId = nanoid();
      const data = parsed.data as ExportCreate;
      const mode = ('mode' in data ? (data as { mode: string }).mode : 'S3') as ExportMode;
      const name = (data as { name: string }).name;
      const publicBaseUrl = (data as Record<string, unknown>).public_base_url ?? null;
      const configEnc = buildConfigEnc(mode, data as unknown as Record<string, unknown>);

      db.prepare(
        `INSERT INTO exports (id, podcast_id, name, public_base_url, mode, config_enc)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(expId, podcastId, name, publicBaseUrl, mode, configEnc);
      const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(expId) as Record<string, unknown>;
      return reply.status(201).send(exportDto(row));
    }
  );

  app.get(
    '/api/podcasts/:id/exports',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Exports'],
        summary: 'List exports',
        description: 'List delivery destinations for a podcast.',
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        response: { 200: { description: 'List of exports' }, 404: { description: 'Podcast not found' } },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const rows = db
        .prepare(
          `SELECT id, podcast_id, mode, name, public_base_url, config_enc, created_at, updated_at
           FROM exports WHERE podcast_id = ? ORDER BY updated_at DESC`
        )
        .all(podcastId) as Record<string, unknown>[];
      return { exports: rows.map(exportDto) };
    }
  );

  app.post(
    '/api/podcasts/:id/exports/deploy',
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Exports'],
        summary: 'Deploy to all exports',
        description: 'Deploy podcast feed and published episodes to all configured destinations.',
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        response: { 200: { description: 'results per export' }, 400: { description: 'No destinations' }, 404: { description: 'Podcast not found' } },
      },
    },
    async (request, reply) => {
      const { id: podcastId } = request.params as { id: string };
      if (!canAccessPodcast(request.userId, podcastId)) {
        return reply.status(404).send({ error: 'Podcast not found' });
      }
      const rows = db
        .prepare(
          `SELECT ex.* FROM exports ex
           JOIN podcasts p ON p.id = ex.podcast_id
           WHERE ex.podcast_id = ? AND p.owner_user_id = ? ORDER BY ex.updated_at DESC`
        )
        .all(podcastId, request.userId) as Record<string, unknown>[];
      if (rows.length === 0) {
        return reply.status(400).send({ error: 'No delivery destinations configured. Add at least one to deploy.' });
      }
      const podcastRow = db
        .prepare('SELECT artwork_path FROM podcasts WHERE id = ?')
        .get(podcastId) as { artwork_path: string | null } | undefined;
      const episodes = db
        .prepare(
          `SELECT id, audio_final_path, audio_mime, artwork_path FROM episodes WHERE podcast_id = ? AND status = 'published'
           AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`
        )
        .all(podcastId) as { id: string; audio_final_path: string | null; audio_mime?: string | null; artwork_path?: string | null }[];
      const results: { export_id: string; name: string; status: string; uploaded: number; skipped: number; errors?: string[] }[] = [];
      let lastPublicBaseUrl: string | null = null;
      for (const exp of rows) {
        const exportId = exp.id as string;
        const name = (exp.name as string) ?? 'Export';
        const publicBaseUrl = (exp.public_base_url as string) ?? null;
        lastPublicBaseUrl = publicBaseUrl;
        const mode = (exp.mode as string) || 'S3';
        let config: unknown;
        try {
          ({ config } = getDecryptedConfigFromEnc(exp));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ export_id: exportId, name, status: 'failed', uploaded: 0, skipped: 0, errors: [msg] });
          continue;
        }
        const runId = nanoid();
        db.prepare(
          `INSERT INTO export_runs (id, export_id, podcast_id, status, started_at) VALUES (?, ?, ?, 'running', datetime('now'))`
        ).run(runId, exportId, podcastId);
        try {
          const xml = generateRss(podcastId, publicBaseUrl);
          const result = await runDeploy(mode, config, {
            publicBaseUrl,
            xml,
            episodes,
            artworkPath: podcastRow?.artwork_path ?? null,
            podcastId,
          });
          const { uploaded, skipped, errors } = result;
          const status = errors.length > 0 ? 'failed' : 'success';
          const log =
            errors.length > 0
              ? `Uploaded ${uploaded}, skipped ${skipped}. Errors: ${errors.join('; ')}`
              : `Uploaded ${uploaded} file(s), skipped ${skipped} unchanged.`;
          db.prepare(
            `UPDATE export_runs SET status = ?, finished_at = datetime('now'), log = ? WHERE id = ?`
          ).run(status, log, runId);
          results.push({
            export_id: exportId,
            name,
            status,
            uploaded,
            skipped,
            errors: errors.length > 0 ? errors : undefined,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          db.prepare(
            `UPDATE export_runs SET status = 'failed', finished_at = datetime('now'), log = ? WHERE id = ?`
          ).run(message, runId);
          results.push({ export_id: exportId, name, status: 'failed', uploaded: 0, skipped: 0, errors: [message] });
        }
      }
      if (lastPublicBaseUrl != null) {
        writeRssFile(podcastId, lastPublicBaseUrl);
      }
      return reply.send({ results });
    }
  );

  app.delete(
    '/api/exports/:exportId',
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Exports'],
        summary: 'Delete export',
        description: 'Remove a delivery destination.',
        params: { type: 'object', properties: { exportId: { type: 'string' } }, required: ['exportId'] },
        response: { 204: { description: 'Deleted' }, 404: { description: 'Export not found' } },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: 'Export not found' });
      db.prepare('DELETE FROM exports WHERE id = ?').run(exportId);
      return reply.status(204).send();
    }
  );

  app.patch(
    '/api/exports/:exportId',
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Exports'],
        summary: 'Update export',
        description: 'Update export config or credentials.',
        params: { type: 'object', properties: { exportId: { type: 'string' } }, required: ['exportId'] },
        body: { type: 'object', description: 'Partial export config' },
        response: { 200: { description: 'Updated export' }, 400: { description: 'Validation failed' }, 404: { description: 'Export not found' } },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: 'Export not found' });

      const parsed = exportUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const data = parsed.data as Record<string, unknown>;

      const wantsAccessKey = data.access_key_id !== undefined;
      const wantsSecretKey = data.secret_access_key !== undefined;
      if (wantsAccessKey !== wantsSecretKey) {
        return reply.status(400).send({ error: 'Provide both access_key_id and secret_access_key when updating credentials' });
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      const configKeys = ['bucket', 'prefix', 'region', 'endpoint_url', 'access_key_id', 'secret_access_key', 'host', 'port', 'username', 'password', 'path', 'secure', 'private_key', 'url', 'api_url', 'api_key', 'gateway_url', 'share', 'domain'];
      const hasConfigUpdate = configKeys.some((k) => data[k] !== undefined);
      const newMode = data.mode as string | undefined;
      const modeChanged = newMode != null && newMode !== (exp.mode as string);

      const map: Record<string, unknown> = {
        name: data.name,
        public_base_url: data.public_base_url,
      };
      if (newMode !== undefined) {
        map.mode = newMode;
      }
      if (modeChanged && newMode != null) {
        try {
          map.config_enc = buildConfigEnc(newMode as ExportMode, data);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return reply.status(400).send({ error: msg });
        }
      } else if (hasConfigUpdate) {
        try {
          map.config_enc = mergeAndEncryptConfig(exp, data);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return reply.status(400).send({ error: msg });
        }
      }

      for (const [k, v] of Object.entries(map)) {
        if (v !== undefined) {
          fields.push(`${k} = ?`);
          values.push(v);
        }
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
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Exports'],
        summary: 'Test export connection',
        description: 'Verify credentials and connectivity for a destination.',
        params: { type: 'object', properties: { exportId: { type: 'string' } }, required: ['exportId'] },
        response: { 200: { description: 'ok and optional error' }, 400: { description: 'Test failed' }, 404: { description: 'Export not found' } },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: 'Export not found' });
      const mode = (exp.mode as string) || 'S3';
      try {
        const { config } = getDecryptedConfigFromEnc(exp);
        const result = await runTest(mode, config);
        if (!result.ok && result.error) {
          request.log.warn({ exportId, mode, error: result.error }, 'Export test failed');
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(400).send({ ok: false, error: msg });
      }
    }
  );

  app.post(
    '/api/exports/:exportId/deploy',
    {
      preHandler: [requireAuth, requireNotReadOnly],
      schema: {
        tags: ['Exports'],
        summary: 'Deploy single export',
        description: 'Deploy podcast feed and episodes to one destination.',
        params: { type: 'object', properties: { exportId: { type: 'string' } }, required: ['exportId'] },
        response: { 200: { description: 'run_id, status, uploaded, skipped' }, 400: { description: 'Config error' }, 404: { description: 'Export not found' }, 500: { description: 'Deploy failed' } },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const exp = getExport(request.userId, exportId);
      if (!exp) return reply.status(404).send({ error: 'Export not found' });
      const podcastId = exp.podcast_id as string;
      const publicBaseUrl = (exp.public_base_url as string) ?? null;
      const mode = (exp.mode as string) || 'S3';
      let config: unknown;
      try {
        ({ config } = getDecryptedConfigFromEnc(exp));
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
        const podcastRow = db
          .prepare('SELECT artwork_path FROM podcasts WHERE id = ?')
          .get(podcastId) as { artwork_path: string | null } | undefined;
        const episodes = db
          .prepare(
            `SELECT id, audio_final_path, audio_mime, artwork_path FROM episodes WHERE podcast_id = ? AND status = 'published'
             AND (publish_at IS NULL OR datetime(publish_at) <= datetime('now'))`
          )
          .all(podcastId) as { id: string; audio_final_path: string | null; audio_mime?: string | null; artwork_path?: string | null }[];
        const result = await runDeploy(mode, config, {
          publicBaseUrl,
          xml,
          episodes,
          artworkPath: podcastRow?.artwork_path ?? null,
          podcastId,
        });
        const { uploaded, skipped, errors } = result;
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
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Exports'],
        summary: 'Get export run',
        description: 'Get status and log for a deploy run.',
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        response: { 200: { description: 'Run record' }, 404: { description: 'Run not found' } },
      },
    },
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
