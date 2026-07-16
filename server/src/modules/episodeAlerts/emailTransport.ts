import nodemailer from "nodemailer";
import { APP_NAME, SENDGRID_MAIL_SEND_URL } from "../../config.js";
import { sendMail } from "../../services/email.js";
import { readSettings } from "../settings/index.js";
import { decryptConfigSecret } from "./configSecrets.js";
import * as repo from "./repo.js";
import type { DestinationRow } from "./repo.js";

async function sendViaBuiltin(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ sent: boolean; error?: string }> {
  return sendMail(opts);
}

async function sendViaByoEmail(
  dest: DestinationRow,
  opts: { to: string; subject: string; text: string; html: string },
): Promise<{ sent: boolean; error?: string }> {
  const host = String(dest.config.smtpHost ?? "").trim();
  const from = String(dest.config.smtpFrom ?? "").trim();
  const user = String(dest.config.smtpUser ?? "").trim();
  const pass = decryptConfigSecret(dest.config, "smtpPassword") ?? "";
  const port = Number(dest.config.smtpPort) || 587;
  const secure =
    dest.config.smtpSecure === true || dest.config.smtpSecure === 1;
  if (!host || !from) {
    return { sent: false, error: "BYO email SMTP host/from not configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465 ? secure : false,
      auth: user ? { user, pass } : undefined,
    });
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendViaByoSendgrid(
  dest: DestinationRow,
  opts: { to: string; subject: string; text: string; html: string },
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = decryptConfigSecret(dest.config, "sendgridApiKey");
  const from = String(dest.config.sendgridFrom ?? "").trim();
  if (!apiKey || !from) {
    return { sent: false, error: "BYO SendGrid API key/from not configured" };
  }
  try {
    const res = await fetch(SENDGRID_MAIL_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: opts.to }] }],
        from: { email: from, name: APP_NAME },
        subject: opts.subject,
        content: [
          { type: "text/plain", value: opts.text },
          { type: "text/html", value: opts.html },
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
    return {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendAlertEmail(
  dest: DestinationRow,
  opts: { to: string; subject: string; text: string; html: string },
): Promise<{ sent: boolean; error?: string }> {
  if (dest.type === "builtin") return sendViaBuiltin(opts);
  if (dest.type === "byo_email") return sendViaByoEmail(dest, opts);
  if (dest.type === "byo_sendgrid") return sendViaByoSendgrid(dest, opts);
  return { sent: false, error: "Not an email destination" };
}

export function destinationMatchesEpisode(
  dest: DestinationRow,
  episodeIsPremium: boolean,
): boolean {
  if (dest.episodeScope === "premium" && !episodeIsPremium) return false;
  return true;
}

export function pickEmailTransport(
  destinations: DestinationRow[],
  episodeIsPremium: boolean,
): DestinationRow | null {
  const priority = ["builtin", "byo_sendgrid", "byo_email"] as const;
  for (const type of priority) {
    const found = destinations.find(
      (d) =>
        d.enabled &&
        d.type === type &&
        destinationMatchesEpisode(d, episodeIsPremium),
    );
    if (found) return found;
  }
  return null;
}

export function episodeAlertsEmailAvailable(podcastId: string): boolean {
  const settings = repo.getPodcastAlertSettings(podcastId);
  if (!settings?.episodeAlertsEnabled) return false;
  if (!repo.hasEnabledEmailDestination(podcastId)) return false;
  // builtin needs server email configured
  const dests = repo.listDestinations(podcastId).filter((d) => d.enabled);
  const hasByo = dests.some(
    (d) => d.type === "byo_email" || d.type === "byo_sendgrid",
  );
  if (hasByo) return true;
  const hasBuiltin = dests.some((d) => d.type === "builtin");
  if (!hasBuiltin) return false;
  const s = readSettings();
  return s.email_provider !== "none";
}
