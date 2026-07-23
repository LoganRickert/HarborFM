import nodemailer from "nodemailer";
import { readSettings } from "../modules/settings/index.js";
import { APP_NAME, SENDGRID_MAIL_SEND_URL } from "../config.js";

/** Site-style colors for email (from web global.css) */
const STYLE = {
  bg: "#0c0e12",
  bgElevated: "#14171e",
  text: "#e8eaef",
  textMuted: "#8b92a3",
  accent: "#00d4aa",
  accentDim: "#00a884",
  border: "#2a2f3d",
  fontSans: "'DM Sans', system-ui, sans-serif",
};

/** Words that stay lowercase in title case unless first/last (e.g. "on", "your" -> "on" in middle). */
const TITLE_CASE_SMALL_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "on", "in", "of", "to", "for", "by", "with", "at", "as", "is", "it",
]);

/**
 * Format a string in Title Case: first letter of each word capitalized, small words lowercase in the middle.
 * Words that already have internal capitals (e.g. HarborFM) are left unchanged.
 */
function toTitleCase(s: string): string {
  const words = s.trim().split(/\s+/);
  if (words.length === 0) return s;
  return words
    .map((word, i) => {
      const isFirst = i === 0;
      const isLast = i === words.length - 1;
      const lower = word.toLowerCase();
      if (!isFirst && !isLast && TITLE_CASE_SMALL_WORDS.has(lower)) return lower;
      if (word.length > 1 && /[A-Z]/.test(word.slice(1))) return word;
      return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export interface SendMailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: SendMailAttachment[];
}

/**
 * Send an email using configured provider (SMTP or SendGrid). No-op if email is not configured.
 * Returns { sent: true } on success, { sent: false, error } on failure.
 */
export async function sendMail(
  options: SendMailOptions,
): Promise<{ sent: boolean; error?: string }> {
  const settings = readSettings();
  if (settings.email_provider === "none") {
    return { sent: false, error: "Email is not configured" };
  }

  const fromRaw =
    settings.email_provider === "smtp"
      ? settings.smtp_from
      : settings.email_provider === "webhook"
        ? ""
        : settings.sendgrid_from;
  const hostnameRaw = (settings.hostname?.trim() || "localhost")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .trim();
  const hostname = hostnameRaw || "localhost";
  const from = fromRaw?.trim() ? fromRaw.trim() : `noreply@${hostname}`;
  const attachments = options.attachments?.filter((a) => a.content?.length) ?? [];

  if (settings.email_provider === "smtp") {
    try {
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host?.trim() || "localhost",
        port: settings.smtp_port,
        secure: settings.smtp_port === 465 ? settings.smtp_secure : false,
        auth: { user: settings.smtp_user.trim(), pass: settings.smtp_password },
      });
      await transporter.sendMail({
        from,
        to: options.to,
        replyTo: options.replyTo?.trim() || undefined,
        subject: toTitleCase(options.subject),
        text: options.text,
        html: options.html,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return { sent: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sent: false, error: msg };
    }
  }

  if (settings.email_provider === "sendgrid") {
    try {
      const res = await fetch(SENDGRID_MAIL_SEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.sendgrid_api_key}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: from, name: APP_NAME },
          ...(options.replyTo?.trim()
            ? { reply_to: { email: options.replyTo.trim() } }
            : {}),
          subject: toTitleCase(options.subject),
          content: [
            { type: "text/plain", value: options.text },
            { type: "text/html", value: options.html },
          ],
          ...(attachments.length > 0
            ? {
                attachments: attachments.map((a) => ({
                  content: Buffer.from(a.content, "utf8").toString("base64"),
                  filename: a.filename,
                  type: a.contentType.split(";")[0]?.trim() || "text/calendar",
                  disposition: "attachment",
                })),
              }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg =
          (data as { errors?: Array<{ message?: string }> })?.errors?.[0]
            ?.message ?? res.statusText;
        return { sent: false, error: errMsg };
      }
      return { sent: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sent: false, error: msg };
    }
  }

  if (settings.email_provider === "webhook") {
    const url = settings.email_webhook_url?.trim();
    if (!url) {
      return { sent: false, error: "Webhook URL is not configured" };
    }
    const fieldKey = (settings.email_webhook_field_key?.trim() || "content").replace(
      /[^\w-]/g,
      "_",
    ) || "content";
    const textContent =
      options.text?.trim() ||
      (options.html
        ? options.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : "");
    const content = `Subject: ${toTitleCase(options.subject)}\n\n${textContent}`.trim();
    try {
      const payload: Record<string, string> = { [fieldKey]: content };
      if (attachments.length > 0) {
        payload.attachments_json = JSON.stringify(
          attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            contentBase64: Buffer.from(a.content, "utf8").toString("base64"),
          })),
        );
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          sent: false,
          error: text ? `${res.status} ${res.statusText}: ${text.slice(0, 200)}` : res.statusText,
        };
      }
      return { sent: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sent: false, error: msg };
    }
  }

  return { sent: false, error: "Email is not configured" };
}

/**
 * Build welcome + verification email content (HTML and plain text) matching site style.
 */
function emailHeaderWithFavicon(urlForOrigin: string): string {
  const baseUrl = new URL(urlForOrigin).origin;
  return `<h1 style="margin: 0 0 8px; font-size: 1.5rem; font-weight: 700; color: ${STYLE.text}; display: flex; align-items: center; gap: 8px;"><img src="${baseUrl}/favicon.svg" alt="" width="28" height="28" style="display: block; flex-shrink: 0;" />${APP_NAME}</h1>`;
}

export function buildWelcomeVerificationEmail(verifyUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Verify your ${APP_NAME} account`;
  const text = [
    `Welcome to ${APP_NAME}!`,
    "",
    "Please verify your email address by clicking the link below:",
    "",
    verifyUrl,
    "",
    "This link expires in 24 hours. If you didn’t create an account, you can ignore this email.",
    "",
    `${APP_NAME}`,
  ].join("\n");

  const origin = new URL(verifyUrl).origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(verifyUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Welcome! Verify your email to get started.</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Thanks for signing up. Click the button below to verify your email and sign in.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Verify Email</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        This link expires in 24 hours. If you didn’t create an account, you can ignore this email.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build review verification email with Verify Email and Delete Review buttons.
 */
export function buildReviewVerificationEmail(
  verifyUrl: string,
  deleteUrl: string,
): { subject: string; text: string; html: string } {
  const subject = `Verify your review on ${APP_NAME}`;
  const text = [
    `You left a review on ${APP_NAME}.`,
    "",
    "Verify your email so others know your review is from a real person:",
    verifyUrl,
    "",
    "To remove your review instead, use this link:",
    deleteUrl,
    "",
    "These links expire in 24 hours.",
    "",
    APP_NAME,
  ].join("\n");

  const origin = new URL(verifyUrl).origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(verifyUrl)}
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        You left a review. Verify your email so others know it's from a real person, or delete it if you prefer.
      </p>
      <p style="margin: 0 0 24px; text-align: center; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Verify Email</a>
        <a href="${deleteUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.border}; color: ${STYLE.text}; font-weight: 600; text-decoration: none; border-radius: 8px;">Delete Review</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        These links expire in 24 hours.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build episode poll email verification (confirm vote email).
 */
export function buildPollVerificationEmail(
  verifyUrl: string,
): { subject: string; text: string; html: string } {
  const subject = `Verify your poll response on ${APP_NAME}`;
  const text = [
    `You submitted a poll response on ${APP_NAME}.`,
    "",
    "Verify your email so your vote is counted as verified:",
    verifyUrl,
    "",
    "This link expires in 24 hours.",
    "",
    APP_NAME,
  ].join("\n");

  const origin = new URL(verifyUrl).origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(verifyUrl)}
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        You submitted a poll response. Verify your email so your vote is counted as verified.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Verify Email</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        This link expires in 24 hours.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

function expiryCopy(hours: number): string {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/**
 * Build reset-password email content (HTML and plain text) matching site style.
 */
export function buildResetPasswordEmail(
  resetUrl: string,
  expiryHours: number,
): { subject: string; text: string; html: string } {
  const expiresIn = expiryCopy(expiryHours);
  const subject = `Reset your ${APP_NAME} password`;
  const text = [
    `Someone requested a password reset for your ${APP_NAME} account.`,
    "",
    "Click the link below to set a new password:",
    "",
    resetUrl,
    "",
    `This link expires in ${expiresIn}. If you didn’t request a reset, you can ignore this email.`,
    "",
    `${APP_NAME}`,
  ].join("\n");

  const origin = new URL(resetUrl).origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(resetUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Reset your password</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Click the button below to set a new password. If you didn’t request this, you can ignore this email.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Set new password</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        This link expires in ${expiresIn}.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build 2FA email code (one-time code for email-based 2FA).
 */
export function build2FAEmailCodeEmail(
  baseUrl: string,
  code: string,
): { subject: string; text: string; html: string } {
  const subject = `Your ${APP_NAME} sign-in code`;
  const origin = new URL(baseUrl).origin;
  const text = [
    `Your sign-in code is: ${code}`,
    "",
    "Enter this code to complete sign-in. This code expires in 10 minutes.",
    "",
    `If you didn't request this, you can ignore this email.`,
    "",
    `${APP_NAME}`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(baseUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Your sign-in code</p>
      <p style="margin: 0 0 24px; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.2em; color: ${STYLE.accent}; text-align: center;">${code}</p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        Enter this code to complete sign-in. It expires in 10 minutes.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build 2FA added notification email.
 */
export function build2FAAddedEmail(
  baseUrl: string,
  method: "totp" | "email",
): { subject: string; text: string; html: string } {
  const methodLabel = method === "totp" ? "authenticator app (TOTP)" : "email codes";
  const subject = `Two-factor authentication enabled on your ${APP_NAME} account`;
  const origin = new URL(baseUrl).origin;
  const dashboardUrl = `${origin}/`;
  const text = [
    "Two-factor authentication has been enabled on your account.",
    "",
    `Method: ${methodLabel}`,
    "",
    "If you didn't make this change, please secure your account immediately by signing in and disabling 2FA, then changing your password.",
    "",
    `Sign in: ${dashboardUrl}`,
    "",
    APP_NAME,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(baseUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Two-factor authentication enabled</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Two-factor authentication has been enabled on your account.
      </p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Method: <strong>${method === "totp" ? "Authenticator app (TOTP)" : "Email codes"}</strong>
      </p>
      <p style="margin: 0 0 24px; font-size: 0.9375rem; color: ${STYLE.textMuted};">
        If you didn't make this change, please secure your account by signing in and disabling 2FA, then changing your password.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Sign in</a>
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build 2FA removed notification email.
 */
export function build2FARemovedEmail(baseUrl: string): { subject: string; text: string; html: string } {
  const subject = `Two-factor authentication disabled on your ${APP_NAME} account`;
  const origin = new URL(baseUrl).origin;
  const dashboardUrl = `${origin}/`;
  const text = [
    "Two-factor authentication has been disabled on your account.",
    "",
    "If you didn't make this change, please secure your account immediately by signing in and changing your password, then re-enabling 2FA.",
    "",
    `Sign in: ${dashboardUrl}`,
    "",
    APP_NAME,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(baseUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Two-factor authentication disabled</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Two-factor authentication has been disabled on your account.
      </p>
      <p style="margin: 0 0 24px; font-size: 0.9375rem; color: ${STYLE.textMuted};">
        If you didn't make this change, please secure your account by signing in, changing your password, and re-enabling 2FA.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Sign in</a>
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build welcome email for admin-created users. Does not include the password; includes a link to the dashboard and a link to set or change password.
 */
export function buildWelcomeSetPasswordEmail(
  resetUrl: string,
  dashboardUrl: string,
  expiryHours: number,
): { subject: string; text: string; html: string } {
  const expiresIn = expiryCopy(expiryHours);
  const subject = `Welcome to ${APP_NAME}`;
  const text = [
    "An administrator has created an account for you.",
    "",
    `${APP_NAME} is an open-source podcast creator. You can record and edit episodes, manage your shows, and publish RSS feeds.`,
    "",
    `Sign in and open your dashboard: ${dashboardUrl}`,
    "",
    "To set or change your password (your password was not sent by email), use the link below:",
    "",
    resetUrl,
    "",
    `This link expires in ${expiresIn}. You can also use "Forgot password" on the sign-in page anytime.`,
    "",
    APP_NAME,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(resetUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Your account was created</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        An administrator has created an account for you.
      </p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        ${APP_NAME} is an open-source podcast creator. You can record and edit episodes, manage your shows, and publish RSS feeds.
      </p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        <a href="${dashboardUrl}" style="color: ${STYLE.accent}; text-decoration: none;">Open your dashboard</a> to sign in and get started.
      </p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        To set or change your password (your password was not sent by email), use the button below.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Set password</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        This link expires in ${expiresIn}. You can also use "Forgot password" on the sign-in page anytime.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${new URL(dashboardUrl).origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build welcome email sent after a user verifies their email (no password reset section).
 */
export function buildWelcomeVerifiedEmail(dashboardUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Welcome to ${APP_NAME}`;
  const text = [
    "You've verified your email. Your account is ready.",
    "",
    `${APP_NAME} is an open-source podcast creator. You can record and edit episodes, manage your shows, and publish RSS feeds.`,
    "",
    `Sign in and open your dashboard: ${dashboardUrl}`,
    "",
    APP_NAME,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(dashboardUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">You're all set</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        You've verified your email. Your account is ready.
      </p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        ${APP_NAME} is an open-source podcast creator. You can record and edit episodes, manage your shows, and publish RSS feeds.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Open Dashboard</a>
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${new URL(dashboardUrl).origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Build invite-to-platform email (someone invited you to join HarborFM).
 */
export function buildInviteToPlatformEmail(signupUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `You're invited to join ${APP_NAME}`;
  const text = [
    `Someone invited you to join ${APP_NAME} to collaborate on a podcast.`,
    "",
    "Create your account to get started:",
    "",
    signupUrl,
    "",
    `If you weren't expecting this, you can ignore this email.`,
    "",
    APP_NAME,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(signupUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">You're invited</p>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Someone invited you to collaborate on a podcast. Create your account to get started.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${signupUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Create Account</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        If you weren't expecting this, you can ignore this email.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${new URL(signupUrl).origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export interface NewShowEmailOptions {
  showUrl: string;
  showTitle: string;
  /** Public feed page URL (e.g. /feed/slug). Only included when public feeds are enabled. */
  publicFeedUrl?: string;
  /** Public RSS feed URL (e.g. /api/public/podcasts/slug/rss). Only included when public feeds are enabled. */
  rssFeedUrl?: string;
}

/**
 * Build "congrats on your new show" email with a few tips and a link to the show.
 * Optionally includes public feed and RSS links when provided.
 */
export function buildNewShowEmail(options: NewShowEmailOptions): {
  subject: string;
  text: string;
  html: string;
} {
  const { showUrl, showTitle, publicFeedUrl, rssFeedUrl } = options;
  const subject = `Congrats on your new show!`;
  const textLines = [
    showTitle,
    "",
    `Congrats on the new show! Here are 3 tips to get started:`,
    "",
    "1. Add artwork and a description so your show stands out in directories.",
    "2. Record your first episode and publish to generate your RSS feed.",
    "3. Share your feed URL with listeners and submit to Apple Podcasts and Spotify.",
    "",
    `Open your show: ${showUrl}`,
  ];
  if (publicFeedUrl) {
    textLines.push("", `Public feed: ${publicFeedUrl}`);
  }
  if (rssFeedUrl) {
    textLines.push("", `RSS feed: ${rssFeedUrl}`);
  }
  textLines.push("", APP_NAME);
  const text = textLines.join("\n");

  const safeTitle = escapeHtml(showTitle);
  const origin = new URL(showUrl).origin;

  const publicLinksHtml =
    publicFeedUrl || rssFeedUrl
      ? `
      <p style="margin: 0 0 24px; font-size: 0.9375rem; color: ${STYLE.text};">
        <strong style="color: ${STYLE.text};">Your public links:</strong>
      </p>
      <ul style="margin: 0 0 24px; padding-left: 1.25rem; font-size: 0.9375rem; color: ${STYLE.text}; line-height: 1.6;">
        ${publicFeedUrl ? `<li style="margin-bottom: 0.5rem;">Feed page: <a href="${publicFeedUrl}" style="color: ${STYLE.accent}; text-decoration: none;">${publicFeedUrl}</a></li>` : ""}
        ${rssFeedUrl ? `<li>RSS feed: <a href="${rssFeedUrl}" style="color: ${STYLE.accent}; text-decoration: none;">${rssFeedUrl}</a></li>` : ""}
      </ul>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(showUrl)}
      <p style="margin: 0 0 8px; font-size: 0.875rem; color: ${STYLE.textMuted};">Your new show</p>
      <h2 style="margin: 0 0 24px; font-size: 1.25rem; font-weight: 700; color: ${STYLE.text}; line-height: 1.3;">${safeTitle}</h2>
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Congrats on the new show! Here are 3 tips to get started:
      </p>
      <ol style="margin: 0 0 24px; padding-left: 1.25rem; font-size: 1rem; color: ${STYLE.text}; line-height: 1.6;">
        <li style="margin-bottom: 0.5rem;">Add artwork and a description so your show stands out in directories.</li>
        <li style="margin-bottom: 0.5rem;">Record your first episode and publish to generate your RSS feed.</li>
        <li>Share your feed URL with listeners and submit to Apple Podcasts and Spotify.</li>
      </ol>
      ${publicLinksHtml}
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${showUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Open ${safeTitle}</a>
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build contact form notification email (HTML and plain text) for admins.
 */
export function buildContactNotificationEmail(
  baseUrl: string,
  name: string,
  email: string,
  message: string,
  context?: { podcastTitle?: string; episodeTitle?: string },
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
    contextLine ? `Regarding: ${contextLine}` : "",
    "",
    "---",
    "",
    message,
    "",
    "---",
    "",
    `Reply to: ${email}`,
    "",
    APP_NAME,
  ]
    .filter(Boolean)
    .join("\n");

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const safeContextLine = contextLine ? escapeHtml(contextLine) : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 520px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      <h1 style="margin: 0 0 8px; font-size: 1.25rem; font-weight: 700; color: ${STYLE.accent};">${safeContextLine ? "New Feedback" : "New Contact Message"}</h1>
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
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        You can reply directly to ${safeEmail} to respond.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${baseUrl}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Email a subscriber their private access token (Stripe recover-token flow).
 */
export function buildSubscriberAccessTokenEmail(options: {
  baseUrl: string;
  podcastTitle: string;
  rawToken: string;
  privateRssUrl: string;
}): { subject: string; text: string; html: string } {
  const { baseUrl, podcastTitle, rawToken, privateRssUrl } = options;
  const safeTitle = escapeHtml(podcastTitle);
  const safeToken = escapeHtml(rawToken);
  const safeRss = escapeHtml(privateRssUrl);
  const subject = `Your ${podcastTitle} subscriber access token`;
  const text = [
    `Here is your subscriber access token for ${podcastTitle}.`,
    "",
    `Token: ${rawToken}`,
    "",
    `Private RSS feed:`,
    privateRssUrl,
    "",
    "Paste the token (or the RSS URL) into the subscribe dialog on the show page to unlock content in your browser.",
    "",
    `If you did not request this, you can ignore this email.`,
    "",
    `${APP_NAME}`,
  ].join("\n");

  const origin = new URL(baseUrl).origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(baseUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">Subscriber access for ${safeTitle}</p>
      <p style="margin: 0 0 16px; font-size: 1rem; color: ${STYLE.text};">
        Use this token to unlock subscriber content, or add the private RSS feed to your podcast app.
      </p>
      <div style="margin: 0 0 20px; padding: 14px 16px; background: ${STYLE.bg}; border: 1px solid ${STYLE.border}; border-radius: 8px;">
        <p style="margin: 0 0 6px; font-size: 0.75rem; color: ${STYLE.textMuted}; text-transform: uppercase; letter-spacing: 0.04em;">Access token</p>
        <p style="margin: 0; font-size: 0.875rem; color: ${STYLE.text}; word-break: break-all; font-family: ui-monospace, monospace;">${safeToken}</p>
      </div>
      <p style="margin: 0 0 8px; font-size: 0.8125rem; color: ${STYLE.textMuted};">Private RSS feed</p>
      <p style="margin: 0 0 24px; font-size: 0.8125rem; word-break: break-all;">
        <a href="${safeRss}" style="color: ${STYLE.accent}; text-decoration: none;">${safeRss}</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted};">
        If you did not request this, you can ignore this email.
      </p>
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

function wrapSubscriberEmail(opts: {
  baseUrl: string;
  subject: string;
  eyebrow: string;
  bodyHtml: string;
}): string {
  const origin = new URL(opts.baseUrl).origin;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${escapeHtml(opts.subject)}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(opts.baseUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">${escapeHtml(opts.eyebrow)}</p>
      ${opts.bodyHtml}
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${origin}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;
}

/**
 * Welcome email after a successful Stripe checkout (includes access token + private RSS).
 */
export function buildStripeWelcomeEmail(options: {
  baseUrl: string;
  podcastTitle: string;
  rawToken: string;
  privateRssUrl: string;
  manageUrl: string;
}): { subject: string; text: string; html: string } {
  const { baseUrl, podcastTitle, rawToken, privateRssUrl, manageUrl } = options;
  const safeTitle = escapeHtml(podcastTitle);
  const safeToken = escapeHtml(rawToken);
  const safeRss = escapeHtml(privateRssUrl);
  const subject = `Welcome to ${podcastTitle}`;
  const text = [
    `Thanks for subscribing to ${podcastTitle}!`,
    "",
    "Here is your private access:",
    "",
    `Private RSS feed:`,
    privateRssUrl,
    "",
    `Access token: ${rawToken}`,
    "",
    `Open the show page (unlocks in your browser): ${manageUrl}`,
    "",
    "Save these somewhere safe. You will need them to unlock subscriber content.",
    "",
    `${APP_NAME}`,
  ].join("\n");

  const bodyHtml = `
      <p style="margin: 0 0 16px; font-size: 1rem; color: ${STYLE.text};">
        Thanks for subscribing to <strong>${safeTitle}</strong>. Here is your private access.
      </p>
      <div style="margin: 0 0 16px; padding: 14px 16px; background: ${STYLE.bg}; border: 1px solid ${STYLE.border}; border-radius: 8px;">
        <p style="margin: 0 0 6px; font-size: 0.75rem; color: ${STYLE.textMuted}; text-transform: uppercase; letter-spacing: 0.04em;">Private RSS feed</p>
        <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.text}; word-break: break-all;">
          <a href="${safeRss}" style="color: ${STYLE.accent}; text-decoration: none;">${safeRss}</a>
        </p>
      </div>
      <div style="margin: 0 0 24px; padding: 14px 16px; background: ${STYLE.bg}; border: 1px solid ${STYLE.border}; border-radius: 8px;">
        <p style="margin: 0 0 6px; font-size: 0.75rem; color: ${STYLE.textMuted}; text-transform: uppercase; letter-spacing: 0.04em;">Access token</p>
        <p style="margin: 0; font-size: 0.875rem; color: ${STYLE.text}; word-break: break-all; font-family: ui-monospace, monospace;">${safeToken}</p>
      </div>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${escapeHtml(manageUrl)}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Open Show Page</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted};">
        Open Show Page unlocks subscriber content in your browser. Save the RSS feed and token for your podcast apps.
      </p>`;

  return {
    subject,
    text,
    html: wrapSubscriberEmail({
      baseUrl,
      subject,
      eyebrow: `Subscriber access for ${podcastTitle}`,
      bodyHtml,
    }),
  };
}

/**
 * Lifecycle notice for Stripe subscribers (pause, cancel, payment, etc.).
 */
export function buildStripeSubscriberNoticeEmail(options: {
  baseUrl: string;
  podcastTitle: string;
  eyebrow: string;
  subject: string;
  paragraphs: string[];
  manageUrl: string;
  /** Defaults to "Manage subscription". */
  ctaLabel?: string;
  invoiceUrl?: string | null;
}): { subject: string; text: string; html: string } {
  const {
    baseUrl,
    podcastTitle,
    eyebrow,
    subject,
    paragraphs,
    manageUrl,
    ctaLabel = "Manage subscription",
    invoiceUrl,
  } = options;

  const textParts = [...paragraphs, "", `${ctaLabel}: ${manageUrl}`];
  if (invoiceUrl) textParts.push(`Invoice: ${invoiceUrl}`);
  textParts.push("", APP_NAME);

  const bodyHtml = [
    ...paragraphs.map(
      (p) =>
        `<p style="margin: 0 0 16px; font-size: 1rem; color: ${STYLE.text};">${escapeHtml(p)}</p>`,
    ),
    `<p style="margin: 8px 0 0; text-align: center;">
        <a href="${escapeHtml(manageUrl)}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">${escapeHtml(ctaLabel)}</a>
      </p>`,
    invoiceUrl
      ? `<p style="margin: 16px 0 0; text-align: center; font-size: 0.8125rem;">
        <a href="${escapeHtml(invoiceUrl)}" style="color: ${STYLE.accent}; text-decoration: none;">View invoice</a>
      </p>`
      : "",
  ].join("\n");

  return {
    subject,
    text: textParts.join("\n"),
    html: wrapSubscriberEmail({
      baseUrl,
      subject,
      eyebrow: `${eyebrow} - ${podcastTitle}`,
      bodyHtml,
    }),
  };
}

export interface GroupCallMeetingEmailOptions {
  podcastTitle: string;
  episodeTitle: string;
  scheduledStartAt: string;
  /** IANA time zone from the host who scheduled (e.g. America/New_York). */
  hostTimeZone?: string | null;
  joinUrl: string;
  joinCode: string;
  dialInPhoneNumber?: string | null;
  googleCalendarUrl?: string | null;
  guestName?: string | null;
  previousScheduledStartAt?: string | null;
  /** Absolute podcast cover URL for the email header. */
  coverArtUrl?: string | null;
}

function meetingTimeZone(timeZone?: string | null): string {
  const tz = timeZone?.trim();
  if (!tz) return "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "UTC";
  }
}

/** Host-local date/time with AM/PM (e.g. Wed, Jul 22, 2026, 3:00 PM EDT). */
function formatMeetingWhen(iso: string, timeZone?: string | null): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    const tz = meetingTimeZone(timeZone);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: tz,
      timeZoneName: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function safeEmailBaseUrl(joinUrl: string): string {
  try {
    return new URL(joinUrl).origin;
  } catch {
    return "http://localhost";
  }
}

function meetingDetailsText(opts: GroupCallMeetingEmailOptions): string[] {
  const when = formatMeetingWhen(opts.scheduledStartAt, opts.hostTimeZone);
  const lines = [
    `Show: ${opts.podcastTitle}`,
    `Episode: ${opts.episodeTitle}`,
    `When: ${when}`,
    "",
    "Join on the web (recommended):",
    opts.joinUrl,
  ];
  if (opts.dialInPhoneNumber) {
    lines.push(
      "",
      "Can't join on the web?",
      `Phone: ${opts.dialInPhoneNumber}`,
      `PIN: ${opts.joinCode}`,
    );
  } else {
    lines.push("", `Join code: ${opts.joinCode}`);
  }
  if (opts.googleCalendarUrl) {
    lines.push("", `Add to Google Calendar: ${opts.googleCalendarUrl}`);
  }
  return lines;
}

function meetingDetailsHtml(opts: GroupCallMeetingEmailOptions): string {
  const when = formatMeetingWhen(opts.scheduledStartAt, opts.hostTimeZone);
  const cover = opts.coverArtUrl?.trim()
    ? `<p style="margin: 0 0 20px; text-align: center;">
        <img src="${escapeHtml(opts.coverArtUrl.trim())}" alt="" width="120" height="120" style="display: inline-block; width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 1px solid ${STYLE.border};" />
      </p>`
    : "";
  const dialIn = opts.dialInPhoneNumber
    ? `<div style="margin: 20px 0 0; padding: 14px 16px; border-radius: 10px; border: 1px solid ${STYLE.border}; background: ${STYLE.bg};">
        <p style="margin: 0 0 8px; font-size: 0.8125rem; font-weight: 600; color: ${STYLE.textMuted};">Can't join on the web?</p>
        <p style="margin: 0; font-size: 0.9375rem; color: ${STYLE.text};">Phone: <strong>${escapeHtml(opts.dialInPhoneNumber)}</strong></p>
        <p style="margin: 4px 0 0; font-size: 0.9375rem; color: ${STYLE.text};">PIN: <strong>${escapeHtml(opts.joinCode)}</strong></p>
      </div>`
    : `<p style="margin: 12px 0 0; font-size: 0.9375rem; color: ${STYLE.text};">Join code: <strong>${escapeHtml(opts.joinCode)}</strong></p>`;
  const gcal = opts.googleCalendarUrl
    ? `<p style="margin: 16px 0 0; text-align: center; font-size: 0.8125rem;">
        <a href="${escapeHtml(opts.googleCalendarUrl)}" style="color: ${STYLE.accent}; text-decoration: none;">Add to Google Calendar</a>
      </p>`
    : "";
  return `
      ${cover}
      <p style="margin: 0 0 8px; font-size: 0.9375rem; color: ${STYLE.text};"><strong>${escapeHtml(opts.podcastTitle)}</strong></p>
      <p style="margin: 0 0 16px; font-size: 0.9375rem; color: ${STYLE.text};">${escapeHtml(opts.episodeTitle)}</p>
      <p style="margin: 0 0 20px; font-size: 0.9375rem; color: ${STYLE.text};">When: <strong>${escapeHtml(when)}</strong></p>
      <p style="margin: 0 0 12px; text-align: center;">
        <a href="${escapeHtml(opts.joinUrl)}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Join on the web</a>
      </p>
      <p style="margin: 0 0 4px; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">Or copy this link:</p>
      <p style="margin: 0 0 8px; font-size: 0.8125rem; word-break: break-all; text-align: center;">
        <a href="${escapeHtml(opts.joinUrl)}" style="color: ${STYLE.accent}; text-decoration: underline;">${escapeHtml(opts.joinUrl)}</a>
      </p>
      ${dialIn}
      ${gcal}
  `;
}

function wrapMeetingEmail(opts: {
  baseUrl: string;
  subject: string;
  eyebrow: string;
  introHtml: string;
  detailsHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${opts.subject}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="width:100%;background-color:${STYLE.bg};margin:0;padding:0;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${emailHeaderWithFavicon(opts.baseUrl)}
      <p style="margin: 0 0 24px; font-size: 0.875rem; color: ${STYLE.textMuted};">${escapeHtml(opts.eyebrow)}</p>
      ${opts.introHtml}
      ${opts.detailsHtml}
    </div>
    <p style="margin: 24px 0 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
      <a href="${escapeHtml(opts.baseUrl)}" style="color: inherit; text-decoration: none;">${APP_NAME}</a>
    </p>
  </div>
  </div>
</body>
</html>`;
}

export function buildGroupCallMeetingCreatorEmail(
  opts: GroupCallMeetingEmailOptions,
): { subject: string; text: string; html: string } {
  const subject = `Group call scheduled: ${opts.podcastTitle} - ${opts.episodeTitle}`;
  const text = [
    `Your group call meeting is scheduled.`,
    "",
    ...meetingDetailsText(opts),
    "",
    "An .ics calendar invite is attached.",
    "",
    APP_NAME,
  ].join("\n");
  const baseUrl = safeEmailBaseUrl(opts.joinUrl);
  const html = wrapMeetingEmail({
    baseUrl,
    subject,
    eyebrow: "Meeting scheduled",
    introHtml: `<p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">Your group call meeting is scheduled. Share the join link or invite guests from the episode editor.</p>`,
    detailsHtml: meetingDetailsHtml(opts),
  });
  return { subject, text, html };
}

export function buildGroupCallMeetingInviteEmail(
  opts: GroupCallMeetingEmailOptions,
): { subject: string; text: string; html: string } {
  const greeting = opts.guestName?.trim()
    ? `Hi ${opts.guestName.trim()},`
    : "Hi,";
  const subject = `You're invited: ${opts.podcastTitle} - ${opts.episodeTitle}`;
  const text = [
    greeting,
    "",
    `You're invited to a group call for ${opts.podcastTitle} - ${opts.episodeTitle}.`,
    "",
    ...meetingDetailsText(opts),
    "",
    "An .ics calendar invite is attached. Replies go to the host.",
    "",
    APP_NAME,
  ].join("\n");
  const baseUrl = safeEmailBaseUrl(opts.joinUrl);
  const html = wrapMeetingEmail({
    baseUrl,
    subject,
    eyebrow: "Group call invite",
    introHtml: `<p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">${escapeHtml(greeting)} You're invited to a group call.</p>`,
    detailsHtml: meetingDetailsHtml(opts),
  });
  return { subject, text, html };
}

export function buildGroupCallMeetingRescheduledEmail(
  opts: GroupCallMeetingEmailOptions,
): { subject: string; text: string; html: string } {
  const greeting = opts.guestName?.trim()
    ? `Hi ${opts.guestName.trim()},`
    : "Hi,";
  const subject = `Meeting rescheduled: ${opts.podcastTitle} - ${opts.episodeTitle}`;
  const prev = opts.previousScheduledStartAt
    ? `Previously: ${formatMeetingWhen(opts.previousScheduledStartAt, opts.hostTimeZone)}`
    : null;
  const text = [
    greeting,
    "",
    `The group call for ${opts.podcastTitle} - ${opts.episodeTitle} has been rescheduled.`,
    prev ?? "",
    "",
    ...meetingDetailsText(opts),
    "",
    "An updated .ics calendar invite is attached.",
    "",
    APP_NAME,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const baseUrl = safeEmailBaseUrl(opts.joinUrl);
  const prevHtml = prev
    ? `<p style="margin: 0 0 16px; font-size: 0.9375rem; color: ${STYLE.textMuted};">${escapeHtml(prev)}</p>`
    : "";
  const html = wrapMeetingEmail({
    baseUrl,
    subject,
    eyebrow: "Meeting rescheduled",
    introHtml: `<p style="margin: 0 0 16px; font-size: 1rem; color: ${STYLE.text};">${escapeHtml(greeting)} The group call has been rescheduled.</p>${prevHtml}`,
    detailsHtml: meetingDetailsHtml(opts),
  });
  return { subject, text, html };
}

export function buildGroupCallMeetingCancelledEmail(
  opts: Pick<
    GroupCallMeetingEmailOptions,
    | "podcastTitle"
    | "episodeTitle"
    | "scheduledStartAt"
    | "hostTimeZone"
    | "guestName"
    | "joinUrl"
    | "coverArtUrl"
  >,
): { subject: string; text: string; html: string } {
  const greeting = opts.guestName?.trim()
    ? `Hi ${opts.guestName.trim()},`
    : "Hi,";
  const subject = `Meeting cancelled: ${opts.podcastTitle} - ${opts.episodeTitle}`;
  const when = formatMeetingWhen(opts.scheduledStartAt, opts.hostTimeZone);
  const text = [
    greeting,
    "",
    `The group call for ${opts.podcastTitle} - ${opts.episodeTitle} has been cancelled.`,
    "",
    `Show: ${opts.podcastTitle}`,
    `Episode: ${opts.episodeTitle}`,
    `Was scheduled for: ${when}`,
    "",
    "You no longer need to join. Sorry for the change.",
    "",
    APP_NAME,
  ].join("\n");
  const baseUrl = safeEmailBaseUrl(opts.joinUrl);
  const cover = opts.coverArtUrl?.trim()
    ? `<p style="margin: 0 0 20px; text-align: center;">
        <img src="${escapeHtml(opts.coverArtUrl.trim())}" alt="" width="120" height="120" style="display: inline-block; width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 1px solid ${STYLE.border};" />
      </p>`
    : "";
  const html = wrapMeetingEmail({
    baseUrl,
    subject,
    eyebrow: "Meeting cancelled",
    introHtml: `<p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">${escapeHtml(greeting)} The group call has been cancelled. You no longer need to join.</p>`,
    detailsHtml: `
      ${cover}
      <p style="margin: 0 0 8px; font-size: 0.9375rem; color: ${STYLE.text};"><strong>${escapeHtml(opts.podcastTitle)}</strong></p>
      <p style="margin: 0 0 16px; font-size: 0.9375rem; color: ${STYLE.text};">${escapeHtml(opts.episodeTitle)}</p>
      <p style="margin: 0; font-size: 0.9375rem; color: ${STYLE.text};">Was scheduled for: <strong>${escapeHtml(when)}</strong></p>
    `,
  });
  return { subject, text, html };
}

export function buildGroupCallMeetingEpisodePublishedEmail(
  opts: GroupCallMeetingEmailOptions,
): { subject: string; text: string; html: string } {
  const greeting = opts.guestName?.trim()
    ? `Hi ${opts.guestName.trim()},`
    : "Hi,";
  const subject = `Episode published: ${opts.episodeTitle}`;
  const text = [
    greeting,
    "",
    `${opts.podcastTitle} just published "${opts.episodeTitle}". Your scheduled group call details are below.`,
    "",
    ...meetingDetailsText(opts),
    "",
    APP_NAME,
  ].join("\n");
  const baseUrl = safeEmailBaseUrl(opts.joinUrl);
  const html = wrapMeetingEmail({
    baseUrl,
    subject,
    eyebrow: "Episode published",
    introHtml: `<p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">${escapeHtml(greeting)} <strong>${escapeHtml(opts.podcastTitle)}</strong> just published <strong>${escapeHtml(opts.episodeTitle)}</strong>. Your scheduled group call details are below.</p>`,
    detailsHtml: meetingDetailsHtml(opts),
  });
  return { subject, text, html };
}
