import nodemailer from 'nodemailer';
import { readSettings } from '../routes/settings.js';
import { APP_NAME } from '../config.js';

/** Site-style colors for email (from web global.css) */
const STYLE = {
  bg: '#0c0e12',
  bgElevated: '#14171e',
  text: '#e8eaef',
  textMuted: '#8b92a3',
  accent: '#00d4aa',
  accentDim: '#00a884',
  border: '#2a2f3d',
  fontSans: "'DM Sans', system-ui, sans-serif",
};

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/**
 * Send an email using configured provider (SMTP or SendGrid). No-op if email is not configured.
 * Returns { sent: true } on success, { sent: false, error } on failure.
 */
export async function sendMail(options: SendMailOptions): Promise<{ sent: boolean; error?: string }> {
  const settings = readSettings();
  if (settings.email_provider === 'none') {
    return { sent: false, error: 'Email is not configured' };
  }

  const from = settings.email_provider === 'smtp' ? settings.smtp_from : settings.sendgrid_from;
  if (!from?.trim()) {
    return { sent: false, error: 'From address is not configured' };
  }

  if (settings.email_provider === 'smtp') {
    try {
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host.trim(),
        port: settings.smtp_port,
        secure: settings.smtp_port === 465 ? settings.smtp_secure : false,
        auth: { user: settings.smtp_user.trim(), pass: settings.smtp_password },
      });
      await transporter.sendMail({
        from: from.trim(),
        to: options.to,
        replyTo: options.replyTo?.trim() || undefined,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      return { sent: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sent: false, error: msg };
    }
  }

  if (settings.email_provider === 'sendgrid') {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.sendgrid_api_key}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: from.trim(), name: APP_NAME },
          ...(options.replyTo?.trim()
            ? { reply_to: { email: options.replyTo.trim() } }
            : {}),
          subject: options.subject,
          content: [
            { type: 'text/plain', value: options.text },
            { type: 'text/html', value: options.html },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = (data as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ?? res.statusText;
        return { sent: false, error: errMsg };
      }
      return { sent: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sent: false, error: msg };
    }
  }

  return { sent: false, error: 'Email is not configured' };
}

/**
 * Build welcome + verification email content (HTML and plain text) matching site style.
 */
export function buildWelcomeVerificationEmail(verifyUrl: string): { subject: string; text: string; html: string } {
  const subject = `Verify your ${APP_NAME} account`;
  const text = [
    `Welcome to ${APP_NAME}!`,
    '',
    'Please verify your email address by clicking the link below:',
    '',
    verifyUrl,
    '',
    'This link expires in 24 hours. If you didn’t create an account, you can ignore this email.',
    '',
    `${APP_NAME}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      <h1 style="margin: 0 0 8px; font-size: 1.5rem; font-weight: 700; color: ${STYLE.text};">${APP_NAME}</h1>
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Welcome! Verify your email to get started.</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Thanks for signing up. Click the button below to verify your email and sign in.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Verify Email</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted};">
        This link expires in 24 hours. If you didn’t create an account, you can ignore this email.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      ${APP_NAME}
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build reset-password email content (HTML and plain text) matching site style.
 */
export function buildResetPasswordEmail(resetUrl: string): { subject: string; text: string; html: string } {
  const subject = `Reset your ${APP_NAME} password`;
  const text = [
    `Someone requested a password reset for your ${APP_NAME} account.`,
    '',
    'Click the link below to set a new password:',
    '',
    resetUrl,
    '',
    'This link expires in 1 hour. If you didn’t request a reset, you can ignore this email.',
    '',
    `${APP_NAME}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      <h1 style="margin: 0 0 8px; font-size: 1.5rem; font-weight: 700; color: ${STYLE.text};">${APP_NAME}</h1>
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Reset your password</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Click the button below to set a new password. If you didn’t request this, you can ignore this email.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Set new password</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted};">
        This link expires in 1 hour.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      ${APP_NAME}
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build contact form notification email (HTML and plain text) for admins.
 */
export function buildContactNotificationEmail(
  name: string,
  email: string,
  message: string,
  context?: { podcastTitle?: string; episodeTitle?: string }
): { subject: string; text: string; html: string } {
  const contextLine =
    context?.episodeTitle && context?.podcastTitle
      ? `${context.podcastTitle} - ${context.episodeTitle}`
      : context?.podcastTitle
        ? context.podcastTitle
        : null;
  const subject = contextLine
    ? `${APP_NAME} Feedback: ${contextLine}`
    : `${APP_NAME} Contact Form: ${name}`;
  const text = [
    `New contact form submission from ${name} (${email}):`,
    contextLine ? `Regarding: ${contextLine}` : '',
    '',
    '---',
    '',
    message,
    '',
    '---',
    '',
    `Reply to: ${email}`,
    '',
    APP_NAME,
  ]
    .filter(Boolean)
    .join('\n');

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');
  const safeContextLine = contextLine ? escapeHtml(contextLine) : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="max-width: 520px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      <h1 style="margin: 0 0 8px; font-size: 1.25rem; font-weight: 700; color: ${STYLE.accent};">${safeContextLine ? 'New Feedback' : 'New Contact Message'}</h1>
      <p style="margin: 0 0 20px; font-size: 0.875rem; color: ${STYLE.textMuted};">${safeContextLine ? `Someone sent feedback about: ${safeContextLine}` : `Someone submitted the contact form on your ${APP_NAME} site.`}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px;">
        <tr>
          <td style="padding: 8px 0; font-size: 0.875rem; color: ${STYLE.textMuted}; width: 80px;">From</td>
          <td style="padding: 8px 0; font-size: 1rem; color: ${STYLE.text};">${safeName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-size: 0.875rem; color: ${STYLE.textMuted};">Email</td>
          <td style="padding: 8px 0; font-size: 1rem;"><a href="mailto:${safeEmail}" style="color: ${STYLE.accent}; text-decoration: none;">${safeEmail}</a></td>
        </tr>
      </table>
      <div style="margin: 0 0 24px; padding: 16px; background: ${STYLE.bg}; border: 1px solid ${STYLE.border}; border-radius: 8px;">
        <p style="margin: 0 0 8px; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-transform: uppercase; letter-spacing: 0.04em;">Message</p>
        <p style="margin: 0; font-size: 1rem; color: ${STYLE.text}; white-space: pre-wrap;">${safeMessage}</p>
      </div>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted};">
        You can reply directly to ${safeEmail} to respond.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      ${APP_NAME}
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
