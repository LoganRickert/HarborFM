import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDataDir } from '../services/paths.js';
import { requireAdmin } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { userRateLimitPreHandler } from '../services/rateLimit.js';

const SETTINGS_FILENAME = 'settings.json';

function normalizeHostname(input: string): string {
  const v = input.trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
}

function normalizeWhisperUrl(input: string): string {
  const v = input.trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
}

export interface AppSettings {
  whisper_asr_url: string;
  llm_provider: 'none' | 'ollama' | 'openai';
  ollama_url: string;
  openai_api_key: string;
  model: string;
  registration_enabled: boolean;
  public_feeds_enabled: boolean;
  hostname: string;
  final_bitrate_kbps: number;
  final_channels: 'mono' | 'stereo';
  final_format: 'mp3' | 'm4a';
}

const DEFAULTS: AppSettings = {
  whisper_asr_url: '',
  llm_provider: 'none',
  ollama_url: 'http://localhost:11434',
  openai_api_key: '',
  model: 'llama3.2:latest',
  registration_enabled: true,
  public_feeds_enabled: true,
  hostname: '',
  final_bitrate_kbps: 128,
  final_channels: 'mono',
  final_format: 'mp3',
};

const OPENAI_DEFAULT_MODEL = 'gpt5-mini';

function getSettingsPath(): string {
  return join(getDataDir(), SETTINGS_FILENAME);
}

/**
 * Migrate settings from file to database if file exists and database is empty
 * This should be called after database migrations have run
 */
export function migrateSettingsFromFile(): void {
  const path = getSettingsPath();
  if (!existsSync(path)) return;
  
  try {
    // Check if database already has settings
    const existing = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
    if (existing.count > 0) return;
    
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const settings: AppSettings = {
      ...DEFAULTS,
      ...parsed,
      model:
        parsed.model ??
        (parsed.llm_provider === 'openai' ? OPENAI_DEFAULT_MODEL : parsed.llm_provider === 'ollama' ? DEFAULTS.model : ''),
      registration_enabled: parsed.registration_enabled ?? DEFAULTS.registration_enabled,
      public_feeds_enabled: (parsed as Partial<AppSettings>).public_feeds_enabled ?? DEFAULTS.public_feeds_enabled,
    };
    
    // Write to database
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))');
    stmt.run('whisper_asr_url', settings.whisper_asr_url);
    stmt.run('llm_provider', settings.llm_provider);
    stmt.run('ollama_url', settings.ollama_url);
    stmt.run('openai_api_key', settings.openai_api_key);
    stmt.run('model', settings.model);
    stmt.run('registration_enabled', String(settings.registration_enabled ?? true));
    stmt.run('public_feeds_enabled', String(settings.public_feeds_enabled ?? true));
    stmt.run('hostname', settings.hostname ?? '');
    stmt.run('final_bitrate_kbps', String(settings.final_bitrate_kbps ?? DEFAULTS.final_bitrate_kbps));
    stmt.run('final_channels', settings.final_channels ?? DEFAULTS.final_channels);
    stmt.run('final_format', settings.final_format ?? DEFAULTS.final_format);
    
    console.log('Migrated settings from file to database');
  } catch (err) {
    // Table might not exist yet, that's okay
    if ((err as Error).message?.includes('no such table')) {
      return;
    }
    console.error('Failed to migrate settings from file:', err);
  }
}

export function readSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  
  if (rows.length === 0) {
    // No settings in database, return defaults
    return { ...DEFAULTS };
  }
  
  const settings: Partial<AppSettings> = {};
  for (const row of rows) {
    if (row.key === 'whisper_asr_url') settings.whisper_asr_url = row.value;
    else if (row.key === 'llm_provider') settings.llm_provider = row.value as AppSettings['llm_provider'];
    else if (row.key === 'ollama_url') settings.ollama_url = row.value;
    else if (row.key === 'openai_api_key') settings.openai_api_key = row.value;
    else if (row.key === 'model') settings.model = row.value;
    else if (row.key === 'registration_enabled') settings.registration_enabled = row.value === 'true';
    else if (row.key === 'public_feeds_enabled') settings.public_feeds_enabled = row.value === 'true';
    else if (row.key === 'hostname') settings.hostname = row.value;
    else if (row.key === 'final_bitrate_kbps') {
      const v = Number(row.value);
      if (!Number.isNaN(v)) settings.final_bitrate_kbps = v;
    }
    else if (row.key === 'final_channels') settings.final_channels = row.value as AppSettings['final_channels'];
    else if (row.key === 'final_format') settings.final_format = row.value as AppSettings['final_format'];
  }
  
  return {
    ...DEFAULTS,
    ...settings,
    model:
      settings.model ??
      (settings.llm_provider === 'openai' ? OPENAI_DEFAULT_MODEL : settings.llm_provider === 'ollama' ? DEFAULTS.model : ''),
    registration_enabled: settings.registration_enabled ?? DEFAULTS.registration_enabled,
    public_feeds_enabled: settings.public_feeds_enabled ?? DEFAULTS.public_feeds_enabled,
    hostname: settings.hostname ?? DEFAULTS.hostname,
  };
}

function writeSettings(settings: AppSettings): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))');
  stmt.run('whisper_asr_url', settings.whisper_asr_url);
  stmt.run('llm_provider', settings.llm_provider);
  stmt.run('ollama_url', settings.ollama_url);
  stmt.run('openai_api_key', settings.openai_api_key);
  stmt.run('model', settings.model);
  stmt.run('registration_enabled', String(settings.registration_enabled));
  stmt.run('public_feeds_enabled', String(settings.public_feeds_enabled));
  stmt.run('hostname', settings.hostname);
  stmt.run('final_bitrate_kbps', String(settings.final_bitrate_kbps));
  stmt.run('final_channels', settings.final_channels);
  stmt.run('final_format', settings.final_format);
}

/** Redact API keys from error messages before sending to client. */
export function redactError(msg: string): string {
  return msg.replace(/sk-[a-zA-Z0-9._-]+/gi, '[REDACTED]');
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', { preHandler: [requireAdmin] }, async () => {
    const settings = readSettings();
    return {
      ...settings,
      openai_api_key: settings.openai_api_key ? '(set)' : '',
    };
  });

  app.patch(
    '/api/settings',
    { preHandler: [requireAdmin] },
    async (request, _reply) => {
      const body = request.body as Partial<AppSettings>;
      const current = readSettings();

      const whisper_asr_url =
        body.whisper_asr_url !== undefined
          ? normalizeWhisperUrl(String(body.whisper_asr_url))
          : current.whisper_asr_url;
      const llm_provider =
        body.llm_provider === 'openai' ? 'openai' : body.llm_provider === 'ollama' ? 'ollama' : 'none';
      const ollama_url = body.ollama_url !== undefined ? String(body.ollama_url).trim() : current.ollama_url;
      let openai_api_key = current.openai_api_key;
      if (body.openai_api_key !== undefined) {
        const v = String(body.openai_api_key).trim();
        openai_api_key = v === '(set)' ? current.openai_api_key : v;
      }
      const model =
        body.model !== undefined
          ? String(body.model).trim()
          : llm_provider === 'openai'
            ? OPENAI_DEFAULT_MODEL
            : llm_provider === 'ollama'
              ? DEFAULTS.model
              : current.model;
      const registration_enabled = body.registration_enabled !== undefined ? Boolean(body.registration_enabled) : current.registration_enabled;
      const public_feeds_enabled =
        body.public_feeds_enabled !== undefined ? Boolean(body.public_feeds_enabled) : current.public_feeds_enabled;
      const hostname =
        body.hostname !== undefined ? normalizeHostname(String(body.hostname)) : current.hostname;
      const final_bitrate_kbps =
        body.final_bitrate_kbps !== undefined
          ? Math.min(320, Math.max(16, Number(body.final_bitrate_kbps) || DEFAULTS.final_bitrate_kbps))
          : current.final_bitrate_kbps;
      const final_channels =
        body.final_channels === 'stereo' ? 'stereo' : body.final_channels === 'mono' ? 'mono' : current.final_channels;
      const final_format =
        body.final_format === 'm4a' ? 'm4a' : body.final_format === 'mp3' ? 'mp3' : current.final_format;

      const next: AppSettings = {
        whisper_asr_url,
        llm_provider,
        ollama_url,
        openai_api_key,
        model:
          model ||
          (llm_provider === 'openai' ? OPENAI_DEFAULT_MODEL : llm_provider === 'ollama' ? DEFAULTS.model : current.model),
        registration_enabled,
        public_feeds_enabled,
        hostname,
        final_bitrate_kbps,
        final_channels,
        final_format,
      };
      writeSettings(next);
      return {
        ...next,
        openai_api_key: next.openai_api_key ? '(set)' : '',
      };
    }
  );

  app.post(
    '/api/settings/test-llm',
    { preHandler: [requireAdmin, userRateLimitPreHandler({ bucket: 'llm', windowMs: 1000 })] },
    async (request, reply) => {
      const body = request.body as Partial<AppSettings> | undefined;
      const current = readSettings();
      const provider = body?.llm_provider ?? current.llm_provider;
      const ollama_url = (body?.ollama_url ?? current.ollama_url).trim() || 'http://localhost:11434';
      const openai_api_key = body?.openai_api_key !== undefined && body.openai_api_key !== '(set)'
        ? String(body.openai_api_key).trim()
        : current.openai_api_key;

      if (provider === 'none') {
        return reply.send({ ok: false, error: 'No LLM provider selected' });
      }

      if (provider === 'ollama') {
        try {
          const base = ollama_url.replace(/\/$/, '');
          const res = await fetch(`${base}/api/tags`, { method: 'GET' });
          if (!res.ok) {
            const text = await res.text();
            return reply.send({ ok: false, error: text || `Ollama returned ${res.status}` });
          }
          return reply.send({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.send({ ok: false, error: msg });
        }
      }

      if (provider === 'openai') {
        if (!openai_api_key) {
          return reply.send({ ok: false, error: 'OpenAI API key is not set' });
        }
        try {
          const res = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: { Authorization: `Bearer ${openai_api_key}` },
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const msg = (data as { error?: { message?: string } })?.error?.message || await res.text() || `OpenAI returned ${res.status}`;
            return reply.send({ ok: false, error: redactError(msg) });
          }
          return reply.send({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.send({ ok: false, error: redactError(msg) });
        }
      }

      return reply.send({ ok: false, error: 'Invalid provider' });
    }
  );
}
