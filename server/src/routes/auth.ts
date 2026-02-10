import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { requireAuth } from '../plugins/auth.js';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { registerBodySchema, loginBodySchema } from '@harborfm/shared';
import { readSettings } from './settings.js';
import { randomBytes } from 'crypto';
import { getCookieSecureFlag } from '../services/cookies.js';
import { clearFailures, getClientIp, getIpBan, getUserAgent, recordFailureAndMaybeBan } from '../services/loginAttempts.js';
import { getLocationForIp } from '../services/geolocation.js';
import { verifyCaptcha } from '../services/captcha.js';
import { sendMail, buildWelcomeVerificationEmail, buildResetPasswordEmail } from '../services/email.js';
import { normalizeHostname } from '../utils/url.js';

const COOKIE_NAME = 'harborfm_jwt';
const VERIFICATION_TOKEN_BYTES = 24;
const VERIFICATION_EXPIRY_HOURS = 24;
const CSRF_COOKIE_NAME = 'harborfm_csrf';
// In production, cookies are Secure by default (HTTPS only). Set COOKIE_SECURE=false when using HTTP (e.g. Docker on localhost).
const COOKIE_SECURE = getCookieSecureFlag();
const COOKIE_OPTS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};
const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    // Setup gate: if there are no users, the server must be bootstrapped first.
    // This prevents "first registrant becomes admin" on fresh installs.
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (userCount.count === 0) {
      return reply.status(403).send({ error: 'Server is not set up yet. Check server logs for the setup URL.' });
    }

    // Check if registration is enabled
    const settings = readSettings();
    if (!settings.registration_enabled) {
      return reply.status(403).send({ error: 'Registration is currently disabled' });
    }

    const body = request.body as Record<string, unknown>;
    const parsed = registerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const captchaToken = typeof body?.captchaToken === 'string' ? body.captchaToken.trim() : undefined;

    if (settings.captcha_provider && settings.captcha_provider !== 'none') {
      if (!captchaToken || !captchaToken.trim()) {
        return reply.status(400).send({ error: 'CAPTCHA is required. Please complete the challenge.' });
      }
      const ip = getClientIp(request);
      const verify = await verifyCaptcha(
        settings.captcha_provider,
        settings.captcha_secret_key,
        captchaToken,
        ip
      );
      if (!verify.ok) {
        return reply.status(400).send({ error: verify.error ?? 'CAPTCHA verification failed' });
      }
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const id = nanoid();
    const userRole = 'user';
    const password_hash = await argon2.hash(password);
    const max_podcasts = (settings.default_max_podcasts == null || settings.default_max_podcasts === 0) ? null : settings.default_max_podcasts;
    const max_storage_mb = (settings.default_storage_mb == null || settings.default_storage_mb === 0) ? null : settings.default_storage_mb;
    const max_episodes = (settings.default_max_episodes == null || settings.default_max_episodes === 0) ? null : settings.default_max_episodes;

    const requiresVerification = settings.email_provider === 'smtp' || settings.email_provider === 'sendgrid';
    let email_verified = 1;
    let email_verification_token: string | null = null;
    let email_verification_expires_at: string | null = null;

    if (requiresVerification) {
      email_verified = 0;
      email_verification_token = randomBytes(VERIFICATION_TOKEN_BYTES).toString('base64url');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + VERIFICATION_EXPIRY_HOURS);
      email_verification_expires_at = expiresAt.toISOString();
    }

    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, max_podcasts, max_storage_mb, max_episodes, email_verified, email_verification_token, email_verification_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      email,
      password_hash,
      userRole,
      max_podcasts,
      max_storage_mb,
      max_episodes,
      email_verified,
      email_verification_token,
      email_verification_expires_at
    );

    if (requiresVerification) {
      const baseUrl = normalizeHostname(settings.hostname || '') || 'http://localhost';
      const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(email_verification_token!)}`;
      const { subject, text, html } = buildWelcomeVerificationEmail(verifyUrl);
      const sendResult = await sendMail({ to: email, subject, text, html });
      if (!sendResult.sent) {
        request.log.warn({ email, err: sendResult.error }, 'Welcome/verification email failed to send');
      }
      return reply.status(201).send({
        requiresVerification: true,
        message: 'Check your email to verify your account, then sign in.',
      });
    }

    // No email verification: log in immediately.
    const ip = getClientIp(request);
    const userAgent = getUserAgent(request);
    const location = await getLocationForIp(ip).catch(() => null);
    db.prepare(
      `UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, last_login_user_agent = ?, last_login_location = ? WHERE id = ?`
    ).run(ip, userAgent, location ?? null, id);
    const token = app.jwt.sign(
      { sub: id, email },
      { expiresIn: '7d' }
    );
    return reply
      .setCookie(COOKIE_NAME, token, COOKIE_OPTS)
      .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
      .send({ user: { id, email } });
  });

  app.get('/api/auth/verify-email', async (request, reply) => {
    const token = (request.query as { token?: string }).token?.trim();
    if (!token) {
      return reply.status(400).send({ error: 'Missing verification token' });
    }
    const row = db
      .prepare(
        `SELECT id FROM users WHERE email_verification_token = ? AND email_verification_expires_at > datetime('now')`
      )
      .get(token) as { id: string } | undefined;
    if (!row) {
      return reply.status(400).send({ error: 'Invalid or expired verification link. You can request a new one by registering again or contact support.' });
    }
    db.prepare(
      `UPDATE users SET email_verified = 1, email_verification_token = NULL, email_verification_expires_at = NULL WHERE id = ?`
    ).run(row.id);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const ip = getClientIp(request);
    const userAgent = getUserAgent(request);
    const ban = getIpBan(ip, 'auth_login');
    if (ban.banned) {
      return reply
        .status(429)
        .header('Retry-After', String(ban.retryAfterSec))
        .send({ error: 'Too many failed login attempts. Try again in a few minutes.' });
    }

    const body = request.body as Record<string, unknown>;
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn(
        { err: parsed.error.flatten(), ip },
        'Login validation failed'
      );
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const captchaToken = typeof body?.captchaToken === 'string' ? body.captchaToken.trim() : undefined;

    const settings = readSettings();
    if (settings.captcha_provider && settings.captcha_provider !== 'none') {
      if (!captchaToken || !captchaToken.trim()) {
        request.log.warn(
          { email, ip, captchaProvider: settings.captcha_provider },
          'Login rejected: CAPTCHA required but no token received'
        );
        return reply.status(400).send({ error: 'CAPTCHA is required. Please complete the challenge.' });
      }
      const verify = await verifyCaptcha(
        settings.captcha_provider,
        settings.captcha_secret_key,
        captchaToken,
        ip
      );
      if (!verify.ok) {
        request.log.warn(
          { email, ip, captchaProvider: settings.captcha_provider, verifyError: verify.error },
          'Login rejected: CAPTCHA verification failed'
        );
        return reply.status(400).send({ error: verify.error ?? 'CAPTCHA verification failed' });
      }
    }
    const row = db
      .prepare(
        'SELECT id, password_hash, COALESCE(disabled, 0) as disabled, COALESCE(email_verified, 1) as email_verified FROM users WHERE email = ?'
      )
      .get(email) as
      | { id: string; password_hash: string; disabled: number; email_verified: number }
      | undefined;
    if (!row || !(await argon2.verify(row.password_hash, password))) {
      request.log.warn({ email, ip }, 'Login failed: invalid credentials');
      // Record failed attempt unless banned (checked above).
      const after = recordFailureAndMaybeBan(ip, 'auth_login', { attemptedEmail: email, userAgent });
      if (after.bannedNow) {
        return reply
          .status(429)
          .header('Retry-After', String(after.retryAfterSec))
          .send({ error: 'Too many failed login attempts. Try again in a few minutes.' });
      }
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    if (row.disabled === 1) {
      request.log.warn({ userId: row.id, email, ip }, 'Login rejected: account disabled');
      return reply.status(403).send({ error: 'Account is disabled' });
    }
    if (
      (settings.email_provider === 'smtp' || settings.email_provider === 'sendgrid') &&
      row.email_verified === 0
    ) {
      request.log.warn({ userId: row.id, email, ip }, 'Login rejected: email not verified');
      return reply.status(403).send({
        error: 'Please verify your email before signing in. Check your inbox for the verification link.',
      });
    }

    // Successful login: clear failures for this IP/context (best-effort).
    clearFailures(ip, 'auth_login');

    // Record last login metadata (best-effort).
    try {
      const location = await getLocationForIp(ip).catch(() => null);
      db.prepare(
        `UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, last_login_user_agent = ?, last_login_location = ? WHERE id = ?`
      ).run(ip, userAgent, location ?? null, row.id);
    } catch {
      // ignore
    }

    const token = app.jwt.sign(
      { sub: row.id, email },
      { expiresIn: '7d' }
    );
    return reply
      .setCookie(COOKIE_NAME, token, COOKIE_OPTS)
      .setCookie(CSRF_COOKIE_NAME, newCsrfToken(), CSRF_COOKIE_OPTS)
      .send({ user: { id: row.id, email } });
  });

  const FORGOT_PASSWORD_RATE_MINUTES = 5;
  const RESET_TOKEN_EXPIRY_HOURS = 1;
  const RESET_TOKEN_BYTES = 32;

  app.post('/api/auth/forgot-password', async (request, reply) => {
    const settings = readSettings();
    if (settings.email_provider !== 'smtp' && settings.email_provider !== 'sendgrid') {
      return reply.status(503).send({
        error: 'Password reset is not available. No email service is configured.',
      });
    }
    const body = request.body as { email?: string };
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) {
      return reply.status(400).send({ error: 'Email is required' });
    }

    const lastRequest = db.prepare(
      'SELECT created_at FROM password_reset_tokens WHERE email = ? ORDER BY created_at DESC LIMIT 1'
    ).get(email) as { created_at: string } | undefined;
    if (lastRequest) {
      const last = new Date(lastRequest.created_at).getTime();
      const minInterval = FORGOT_PASSWORD_RATE_MINUTES * 60 * 1000;
      if (Date.now() - last < minInterval) {
        return reply.status(429).send({
          error: 'You can only request a password reset once every 5 minutes.',
        });
      }
    }

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) {
      return reply.send({ ok: true });
    }

    const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO password_reset_tokens (email, token, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(email, token, expiresAt.toISOString(), now);

    const baseUrl = normalizeHostname(settings.hostname || '') || 'http://localhost';
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const { subject, text, html } = buildResetPasswordEmail(resetUrl);
    const sendResult = await sendMail({ to: email, subject, text, html });
    if (!sendResult.sent) {
      request.log.warn({ email, err: sendResult.error }, 'Password reset email failed to send');
    }
    return reply.send({ ok: true });
  });

  app.get('/api/auth/validate-reset-token', async (request, reply) => {
    const query = request.query as { token?: string };
    const token = typeof query?.token === 'string' ? query.token.trim() : '';
    if (!token) {
      return reply.status(400).send({ error: 'Token is required' });
    }
    const row = db.prepare(
      'SELECT 1 FROM password_reset_tokens WHERE token = ? AND expires_at > datetime(\'now\')'
    ).get(token);
    if (!row) {
      return reply.status(400).send({ error: 'Invalid or expired reset link. Request a new one from the reset password page.' });
    }
    return reply.send({ ok: true });
  });

  app.post('/api/auth/reset-password', async (request, reply) => {
    const body = request.body as { token?: string; password?: string };
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!token) {
      return reply.status(400).send({ error: 'Token is required' });
    }
    if (!password || password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' });
    }

    const row = db.prepare(
      'SELECT email FROM password_reset_tokens WHERE token = ? AND expires_at > datetime(\'now\')'
    ).get(token) as { email: string } | undefined;
    if (!row) {
      return reply.status(400).send({ error: 'Invalid or expired reset link. Request a new one from the reset password page.' });
    }

    const password_hash = await argon2.hash(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(password_hash, row.email);
    db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    return reply
      .clearCookie(COOKIE_NAME, { path: '/' })
      .clearCookie(CSRF_COOKIE_NAME, { path: '/' })
      .send({ ok: true });
  });

  app.get('/api/auth/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = db.prepare('SELECT id, email, role, max_podcasts, max_episodes, max_storage_mb, COALESCE(disk_bytes_used, 0) AS disk_bytes_used FROM users WHERE id = ?').get(request.userId) as {
      id: string;
      email: string;
      role: string;
      max_podcasts: number | null;
      max_episodes: number | null;
      max_storage_mb: number | null;
      disk_bytes_used: number;
    } | undefined;
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    const podcastCount = db.prepare('SELECT COUNT(*) as count FROM podcasts WHERE owner_user_id = ?').get(request.userId) as { count: number };
    const episodeCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id WHERE p.owner_user_id = ?`
      )
      .get(request.userId) as { count: number };
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        max_podcasts: user.max_podcasts ?? null,
        max_episodes: user.max_episodes ?? null,
        max_storage_mb: user.max_storage_mb ?? null,
        disk_bytes_used: user.disk_bytes_used ?? 0,
      },
      podcast_count: podcastCount.count,
      episode_count: episodeCount.count,
    };
  });
}
