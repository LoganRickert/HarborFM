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
      : settings.sendgrid_from;
  const hostnameRaw = (settings.hostname?.trim() || "localhost")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .trim();
  const hostname = hostnameRaw || "localhost";
  const from = fromRaw?.trim() ? fromRaw.trim() : `noreply@${hostname}`;

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
 * Build invite-to-platform email (someone invited you to join Harbor).
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
        <a href="${signupUrl}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Create account</a>
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
