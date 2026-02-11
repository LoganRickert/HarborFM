import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import nodemailer from 'nodemailer';
import { getDataDir } from '../services/paths.js';
import { requireAdmin } from '../plugins/auth.js';
import { db } from '../db/index.js';
import { userRateLimitPreHandler } from '../services/rateLimit.js';
import { normalizeHostname } from '../utils/url.js';
import { runGeoIPUpdate } from '../services/geoipupdate.js';

const SETTINGS_FILENAME = 'settings.json';

function validateOllamaBaseUrl(input: string): string {
  const raw = (input || '').trim() || 'http://localhost:11434';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid Ollama URL');
  }

  // Allow only http/https schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Ollama URL must use http or https');
  }

  // Basic safeguard: disallow URLs without a hostname
  if (!url.hostname) {
    throw new Error('Ollama URL must include a hostname');
  }

  // Normalize by removing any trailing slash from pathname
  const normalized = new URL(url.toString());
  normalized.pathname = normalizeHostname(normalized.pathname);

  return normalized.toString();
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
  maxmind_account_id: string;
  maxmind_license_key: string;
  /** Default max podcasts for new users. null/empty = no limit. */
  default_max_podcasts: number | null;
  /** Default storage space in MB for new users. null/empty = no limit. */
  default_storage_mb: number | null;
  /** Default max episodes for new users. null/empty = no limit. */
  default_max_episodes: number | null;
  /** CAPTCHA provider for sign-in and registration. */
  captcha_provider: 'none' | 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';
  /** Site key for the selected CAPTCHA provider. */
  captcha_site_key: string;
  /** Secret key for the selected CAPTCHA provider. */
  captcha_secret_key: string;
  /** Email provider for sending mail (e.g. notifications). */
  email_provider: 'none' | 'smtp' | 'sendgrid';
  /** SMTP host. */
  smtp_host: string;
  /** SMTP port (e.g. 587). */
  smtp_port: number;
  /** SMTP use TLS. */
  smtp_secure: boolean;
  /** SMTP username. */
  smtp_user: string;
  /** SMTP password. */
  smtp_password: string;
  /** From address for SMTP. */
  smtp_from: string;
  /** SendGrid API key. */
  sendgrid_api_key: string;
  /** From address for SendGrid. */
  sendgrid_from: string;
  /** Optional message shown above the sign-in form. Newlines are preserved. */
  welcome_banner: string;
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
  maxmind_account_id: '',
  maxmind_license_key: '',
  default_max_podcasts: null,
  default_storage_mb: null,
  default_max_episodes: null,
  captcha_provider: 'none',
  captcha_site_key: '',
  captcha_secret_key: '',
  email_provider: 'none',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: true,
  smtp_user: '',
  smtp_password: '',
  smtp_from: '',
  sendgrid_api_key: '',
  sendgrid_from: '',
  welcome_banner: '',
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
    stmt.run('maxmind_account_id', settings.maxmind_account_id ?? '');
    stmt.run('maxmind_license_key', settings.maxmind_license_key ?? '');
    stmt.run('default_max_podcasts', settings.default_max_podcasts == null ? '' : String(settings.default_max_podcasts));
    stmt.run('default_storage_mb', settings.default_storage_mb == null ? '' : String(settings.default_storage_mb));
    stmt.run('default_max_episodes', settings.default_max_episodes == null ? '' : String(settings.default_max_episodes));
    stmt.run('captcha_provider', (settings as Partial<AppSettings>).captcha_provider ?? 'none');
    stmt.run('captcha_site_key', (settings as Partial<AppSettings>).captcha_site_key ?? '');
    stmt.run('captcha_secret_key', (settings as Partial<AppSettings>).captcha_secret_key ?? '');
    stmt.run('email_provider', (settings as Partial<AppSettings>).email_provider ?? 'none');
    stmt.run('smtp_host', (settings as Partial<AppSettings>).smtp_host ?? '');
    stmt.run('smtp_port', String((settings as Partial<AppSettings>).smtp_port ?? 587));
    stmt.run('smtp_secure', String((settings as Partial<AppSettings>).smtp_secure ?? true));
    stmt.run('smtp_user', (settings as Partial<AppSettings>).smtp_user ?? '');
    stmt.run('smtp_password', (settings as Partial<AppSettings>).smtp_password ?? '');
    stmt.run('smtp_from', (settings as Partial<AppSettings>).smtp_from ?? '');
    stmt.run('sendgrid_api_key', (settings as Partial<AppSettings>).sendgrid_api_key ?? '');
    stmt.run('sendgrid_from', (settings as Partial<AppSettings>).sendgrid_from ?? '');

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
    else if (row.key === 'maxmind_account_id') settings.maxmind_account_id = row.value;
    else if (row.key === 'maxmind_license_key') settings.maxmind_license_key = row.value;
    else if (row.key === 'default_max_podcasts') {
      const v = row.value.trim();
      settings.default_max_podcasts = v === '' ? null : (Number(row.value) || null);
    }
    else if (row.key === 'default_storage_mb') {
      const v = row.value.trim();
      settings.default_storage_mb = v === '' ? null : (Number(row.value) || null);
    }
    else if (row.key === 'default_max_episodes') {
      const v = row.value.trim();
      settings.default_max_episodes = v === '' ? null : (Number(row.value) || null);
    }
    else if (row.key === 'captcha_provider') {
      const v = row.value as AppSettings['captcha_provider'];
      if (v === 'recaptcha_v2' || v === 'recaptcha_v3' || v === 'hcaptcha' || v === 'none') settings.captcha_provider = v;
    }
    else if (row.key === 'captcha_site_key') settings.captcha_site_key = row.value;
    else if (row.key === 'captcha_secret_key') settings.captcha_secret_key = row.value;
    else if (row.key === 'email_provider') {
      const v = row.value as AppSettings['email_provider'];
      if (v === 'smtp' || v === 'sendgrid' || v === 'none') settings.email_provider = v;
    }
    else if (row.key === 'smtp_host') settings.smtp_host = row.value;
    else if (row.key === 'smtp_port') {
      const v = Number(row.value);
      if (!Number.isNaN(v)) settings.smtp_port = v;
    }
    else if (row.key === 'smtp_secure') settings.smtp_secure = row.value === 'true';
    else if (row.key === 'smtp_user') settings.smtp_user = row.value;
    else if (row.key === 'smtp_password') settings.smtp_password = row.value;
    else if (row.key === 'smtp_from') settings.smtp_from = row.value;
    else if (row.key === 'sendgrid_api_key') settings.sendgrid_api_key = row.value;
    else if (row.key === 'sendgrid_from') settings.sendgrid_from = row.value;
    else if (row.key === 'welcome_banner') settings.welcome_banner = row.value;
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
    maxmind_account_id: settings.maxmind_account_id ?? DEFAULTS.maxmind_account_id,
    maxmind_license_key: settings.maxmind_license_key ?? DEFAULTS.maxmind_license_key,
    default_max_podcasts: settings.default_max_podcasts ?? DEFAULTS.default_max_podcasts,
    default_storage_mb: settings.default_storage_mb ?? DEFAULTS.default_storage_mb,
    default_max_episodes: settings.default_max_episodes ?? DEFAULTS.default_max_episodes,
    captcha_provider: settings.captcha_provider ?? DEFAULTS.captcha_provider,
    captcha_site_key: settings.captcha_site_key ?? DEFAULTS.captcha_site_key,
    captcha_secret_key: settings.captcha_secret_key ?? DEFAULTS.captcha_secret_key,
    email_provider: settings.email_provider ?? DEFAULTS.email_provider,
    smtp_host: settings.smtp_host ?? DEFAULTS.smtp_host,
    smtp_port: settings.smtp_port ?? DEFAULTS.smtp_port,
    smtp_secure: settings.smtp_secure ?? DEFAULTS.smtp_secure,
    smtp_user: settings.smtp_user ?? DEFAULTS.smtp_user,
    smtp_password: settings.smtp_password ?? DEFAULTS.smtp_password,
    smtp_from: settings.smtp_from ?? DEFAULTS.smtp_from,
    sendgrid_api_key: settings.sendgrid_api_key ?? DEFAULTS.sendgrid_api_key,
    sendgrid_from: settings.sendgrid_from ?? DEFAULTS.sendgrid_from,
    welcome_banner: settings.welcome_banner ?? DEFAULTS.welcome_banner,
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
  stmt.run('maxmind_account_id', settings.maxmind_account_id);
  stmt.run('maxmind_license_key', settings.maxmind_license_key);
  stmt.run('default_max_podcasts', settings.default_max_podcasts == null ? '' : String(settings.default_max_podcasts));
  stmt.run('default_storage_mb', settings.default_storage_mb == null ? '' : String(settings.default_storage_mb));
  stmt.run('default_max_episodes', settings.default_max_episodes == null ? '' : String(settings.default_max_episodes));
  stmt.run('captcha_provider', settings.captcha_provider);
  stmt.run('captcha_site_key', settings.captcha_site_key);
  stmt.run('captcha_secret_key', settings.captcha_secret_key);
  stmt.run('email_provider', settings.email_provider);
  stmt.run('smtp_host', settings.smtp_host);
  stmt.run('smtp_port', String(settings.smtp_port));
  stmt.run('smtp_secure', String(settings.smtp_secure));
  stmt.run('smtp_user', settings.smtp_user);
  stmt.run('smtp_password', settings.smtp_password);
  stmt.run('smtp_from', settings.smtp_from);
  stmt.run('sendgrid_api_key', settings.sendgrid_api_key);
  stmt.run('sendgrid_from', settings.sendgrid_from);
  stmt.run('welcome_banner', settings.welcome_banner);
}

/** Redact API keys from error messages before sending to client. */
export function redactError(msg: string): string {
  return msg.replace(/sk-[a-zA-Z0-9._-]+/gi, '[REDACTED]');
}

const SMTP_TEST_TIMEOUT_MS = 15_000;

/**
 * Verify SMTP credentials by connecting, optionally upgrading to TLS via STARTTLS, and authenticating.
 * Does not send any email. Uses Nodemailer for protocol handling.
 */
async function verifySmtpCredentials(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { host, port, secure, user, password } = options;
  if (!host?.trim() || !user?.trim() || !password) {
    return { ok: false, error: 'Host, username, and password are required' };
  }

  const transporter = nodemailer.createTransport({
    host: host.trim(),
    port,
    secure: port === 465 ? secure : false,
    auth: { user: user.trim(), pass: password },
    connectionTimeout: SMTP_TEST_TIMEOUT_MS,
    greetingTimeout: SMTP_TEST_TIMEOUT_MS,
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Get settings',
      description: 'Returns app settings (secrets redacted). Admin only.',
      response: { 200: { description: 'Settings object' } },
    },
  }, async () => {
    const settings = readSettings();
    return {
      ...settings,
      openai_api_key: settings.openai_api_key ? '(set)' : '',
      maxmind_license_key: settings.maxmind_license_key ? '(set)' : '',
      captcha_secret_key: settings.captcha_secret_key ? '(set)' : '',
      smtp_password: settings.smtp_password ? '(set)' : '',
      sendgrid_api_key: settings.sendgrid_api_key ? '(set)' : '',
    };
  });

  app.patch(
    '/api/settings',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: 'Update settings',
        description: 'Update app settings. Admin only. Use (set) for existing secrets to leave unchanged.',
        body: { type: 'object', description: 'Partial settings' },
        response: { 200: { description: 'Updated settings (secrets redacted)' } },
      },
    },
    async (request, _reply) => {
      const body = request.body as Partial<AppSettings>;
      const current = readSettings();

      const whisper_asr_url =
        body.whisper_asr_url !== undefined
          ? normalizeHostname(String(body.whisper_asr_url))
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
      const maxmind_account_id =
        body.maxmind_account_id !== undefined ? String(body.maxmind_account_id).trim() : current.maxmind_account_id;
      let maxmind_license_key = current.maxmind_license_key;
      if (body.maxmind_license_key !== undefined) {
        const v = String(body.maxmind_license_key).trim();
        maxmind_license_key = v === '(set)' ? current.maxmind_license_key : v;
      }
      const parseOptionalNum = (v: unknown): number | null => {
        if (v === '' || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const default_max_podcasts =
        body.default_max_podcasts !== undefined ? parseOptionalNum(body.default_max_podcasts) : current.default_max_podcasts;
      const default_storage_mb =
        body.default_storage_mb !== undefined ? parseOptionalNum(body.default_storage_mb) : current.default_storage_mb;
      const default_max_episodes =
        body.default_max_episodes !== undefined ? parseOptionalNum(body.default_max_episodes) : current.default_max_episodes;
      const captcha_provider =
        body.captcha_provider === 'recaptcha_v2' || body.captcha_provider === 'recaptcha_v3' || body.captcha_provider === 'hcaptcha'
          ? body.captcha_provider
          : body.captcha_provider === 'none' ? 'none' : current.captcha_provider;
      let captcha_site_key =
        body.captcha_site_key !== undefined ? String(body.captcha_site_key).trim() : current.captcha_site_key;
      let captcha_secret_key = current.captcha_secret_key;
      if (body.captcha_secret_key !== undefined) {
        const v = String(body.captcha_secret_key).trim();
        captcha_secret_key = v === '(set)' ? current.captcha_secret_key : v;
      }
      if (captcha_provider === 'none') {
        captcha_site_key = '';
        captcha_secret_key = '';
      }
      const email_provider =
        body.email_provider === 'smtp' ? 'smtp'
          : body.email_provider === 'sendgrid' ? 'sendgrid'
            : 'none';
      const smtp_host = body.smtp_host !== undefined ? String(body.smtp_host).trim() : current.smtp_host;
      const smtp_port =
        body.smtp_port !== undefined
          ? Math.min(65535, Math.max(1, Number(body.smtp_port) || DEFAULTS.smtp_port))
          : current.smtp_port;
      const smtp_secure = body.smtp_secure !== undefined ? Boolean(body.smtp_secure) : current.smtp_secure;
      const smtp_user = body.smtp_user !== undefined ? String(body.smtp_user).trim() : current.smtp_user;
      let smtp_password = current.smtp_password;
      if (body.smtp_password !== undefined) {
        const v = String(body.smtp_password).trim();
        smtp_password = v === '(set)' ? current.smtp_password : v;
      }
      const smtp_from = body.smtp_from !== undefined ? String(body.smtp_from).trim() : current.smtp_from;
      let sendgrid_api_key = current.sendgrid_api_key;
      if (body.sendgrid_api_key !== undefined) {
        const v = String(body.sendgrid_api_key).trim();
        sendgrid_api_key = v === '(set)' ? current.sendgrid_api_key : v;
      }
      const sendgrid_from = body.sendgrid_from !== undefined ? String(body.sendgrid_from).trim() : current.sendgrid_from;
      const welcome_banner = body.welcome_banner !== undefined ? String(body.welcome_banner) : current.welcome_banner;

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
        maxmind_account_id,
        maxmind_license_key,
        default_max_podcasts,
        default_storage_mb,
        default_max_episodes,
        captcha_provider,
        captcha_site_key,
        captcha_secret_key,
        email_provider,
        smtp_host,
        smtp_port,
        smtp_secure,
        smtp_user,
        smtp_password,
        smtp_from,
        sendgrid_api_key,
        sendgrid_from,
        welcome_banner,
      };
      const maxmindKeysChanged =
        next.maxmind_account_id !== current.maxmind_account_id ||
        next.maxmind_license_key !== current.maxmind_license_key;

      writeSettings(next);

      if (maxmindKeysChanged && next.maxmind_account_id && next.maxmind_license_key) {
        runGeoIPUpdate(next.maxmind_account_id, next.maxmind_license_key)
          .then((result) => {
            if (result.ok) {
              console.log('GeoLite2 databases (Country, City) updated successfully in', getDataDir());
            } else {
              console.error('GeoLite2 update failed:', result.error);
            }
          })
          .catch((err) => console.error('GeoLite2 update error:', err));
      }

      return {
        ...next,
        openai_api_key: next.openai_api_key ? '(set)' : '',
        maxmind_license_key: next.maxmind_license_key ? '(set)' : '',
        captcha_secret_key: next.captcha_secret_key ? '(set)' : '',
        smtp_password: next.smtp_password ? '(set)' : '',
        sendgrid_api_key: next.sendgrid_api_key ? '(set)' : '',
      };
    }
  );

  app.post(
    '/api/settings/test-llm',
    {
      preHandler: [requireAdmin, userRateLimitPreHandler({ bucket: 'llm', windowMs: 1000 })],
      schema: {
        tags: ['Settings'],
        summary: 'Test LLM connection',
        description: 'Verify LLM provider (Ollama/OpenAI) is reachable. Admin only.',
        body: { type: 'object', properties: { llm_provider: { type: 'string' }, ollama_url: { type: 'string' }, openai_api_key: { type: 'string' } } },
        response: { 200: { description: 'ok and optional error' } },
      },
    },
    async (request, reply) => {
      const body = request.body as Partial<AppSettings> | undefined;
      const current = readSettings();
      const provider = body?.llm_provider ?? current.llm_provider;

      if (provider === 'none') {
        return reply.send({ ok: false, error: 'No LLM provider selected' });
      }

      if (provider === 'ollama') {
        let ollama_url: string;
        try {
          ollama_url = validateOllamaBaseUrl(body?.ollama_url ?? current.ollama_url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Invalid Ollama URL';
          return reply.send({ ok: false, error: msg });
        }
        try {
          const base = validateOllamaBaseUrl(ollama_url);
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
        const openai_api_key = body?.openai_api_key !== undefined && body.openai_api_key !== '(set)'
          ? String(body.openai_api_key).trim()
          : current.openai_api_key;
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

  app.post(
    '/api/settings/test-whisper',
    {
      preHandler: [requireAdmin, userRateLimitPreHandler({ bucket: 'whisper', windowMs: 1000 })],
      schema: {
        tags: ['Settings'],
        summary: 'Test Whisper ASR',
        description: 'Verify Whisper ASR URL is reachable. Admin only.',
        body: { type: 'object', properties: { whisper_asr_url: { type: 'string' } } },
        response: { 200: { description: 'ok and optional error' } },
      },
    },
    async (request, reply) => {
      const body = request.body as { whisper_asr_url?: string } | undefined;
      const current = readSettings();
      const raw = normalizeHostname(body?.whisper_asr_url ?? current.whisper_asr_url ?? '');
      if (!raw) {
        return reply.send({ ok: false, error: 'Whisper ASR URL is not set' });
      }
      let openapiUrl: string;
      try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return reply.send({ ok: false, error: 'Whisper ASR URL must use http or https' });
        }
        const path = normalizeHostname(u.pathname || '');
        u.pathname = path ? `${path}/openapi.json` : '/openapi.json';
        openapiUrl = u.toString();
      } catch {
        return reply.send({ ok: false, error: 'Invalid Whisper ASR URL' });
      }
      try {
        const res = await fetch(openapiUrl, { method: 'HEAD' });
        if (res.ok) {
          return reply.send({ ok: true });
        }
        return reply.send({ ok: false, error: `openapi.json returned ${res.status}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg });
      }
    }
  );

  app.post(
    '/api/settings/test-smtp',
    {
      preHandler: [requireAdmin, userRateLimitPreHandler({ bucket: 'smtp', windowMs: 2000 })],
      schema: {
        tags: ['Settings'],
        summary: 'Test SMTP',
        description: 'Verify SMTP credentials. Admin only.',
        body: { type: 'object', properties: { smtp_host: { type: 'string' }, smtp_port: { type: 'number' }, smtp_user: { type: 'string' }, smtp_password: { type: 'string' } } },
        response: { 200: { description: 'ok and optional error' } },
      },
    },
    async (request, reply) => {
      const body = request.body as Partial<AppSettings> | undefined;
      const current = readSettings();
      const host = (body?.smtp_host !== undefined ? String(body.smtp_host).trim() : current.smtp_host) || '';
      const port =
        body?.smtp_port !== undefined
          ? Math.min(65535, Math.max(1, Number(body.smtp_port) || 587))
          : current.smtp_port;
      const secure = body?.smtp_secure !== undefined ? Boolean(body.smtp_secure) : current.smtp_secure;
      const user = (body?.smtp_user !== undefined ? String(body.smtp_user).trim() : current.smtp_user) || '';
      let password = current.smtp_password ?? '';
      if (body?.smtp_password !== undefined && body.smtp_password !== '(set)') {
        const v = String(body.smtp_password).trim();
        if (v) password = v;
      }
      if (!host || !user || !password) {
        return reply.send({ ok: false, error: 'Host, username, and password are required' });
      }
      const result = await verifySmtpCredentials({ host, port, secure, user, password });
      return reply.send(result);
    }
  );

  app.post(
    '/api/settings/test-sendgrid',
    {
      preHandler: [requireAdmin, userRateLimitPreHandler({ bucket: 'sendgrid', windowMs: 2000 })],
      schema: {
        tags: ['Settings'],
        summary: 'Test SendGrid',
        description: 'Verify SendGrid API key. Admin only.',
        body: { type: 'object', properties: { sendgrid_api_key: { type: 'string' } } },
        response: { 200: { description: 'ok and optional error' } },
      },
    },
    async (request, reply) => {
      const body = request.body as Partial<AppSettings> | undefined;
      const current = readSettings();
      let apiKey = current.sendgrid_api_key ?? '';
      if (body?.sendgrid_api_key !== undefined && body.sendgrid_api_key !== '(set)') {
        const v = String(body.sendgrid_api_key).trim();
        if (v) apiKey = v;
      }
      if (!apiKey) {
        return reply.send({ ok: false, error: 'SendGrid API key is required' });
      }
      try {
        const res = await fetch('https://api.sendgrid.com/v3/scopes', {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          return reply.send({ ok: true });
        }
        const data = await res.json().catch(() => ({}));
        const msg = (data as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ?? res.statusText ?? `SendGrid returned ${res.status}`;
        return reply.send({ ok: false, error: msg });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.send({ ok: false, error: msg });
      }
    }
  );
}
