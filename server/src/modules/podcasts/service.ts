import type { FastifyBaseLogger } from "fastify";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import { sendMail, buildNewShowEmail } from "../../services/email.js";
import { readSettings } from "../settings/index.js";
import { normalizeHostname } from "../../utils/url.js";
import { drizzleDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Sends the configured "congrats on your new show" email to the owner.
 * Does not write RSS or ping WebSub (use {@link afterCreatePodcast} for full create hook).
 */
export function sendNewShowCongratulationsEmail(
  podcastId: string,
  data: { title: string; slug: string },
  userId: string,
  log: FastifyBaseLogger,
): void {
  const settings = readSettings();
  if (
    (settings.email_provider !== "smtp" &&
      settings.email_provider !== "sendgrid" &&
      settings.email_provider !== "webhook") ||
    !settings.email_enable_new_show
  ) {
    return;
  }
  const owner = drizzleDb
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();
  const to = owner?.email?.trim();
  if (!to) return;

  const baseUrl =
    normalizeHostname(settings.hostname || "") || "http://localhost";
  const showUrl = `${baseUrl}/podcasts/${podcastId}`;
  const showTitle = (data.title || "Your show").trim() || "Your show";
  const slugEnc = encodeURIComponent(data.slug);
  const opts = {
    showUrl,
    showTitle,
    ...(settings.public_feeds_enabled && {
      publicFeedUrl: `${baseUrl}/feed/${slugEnc}`,
      rssFeedUrl: `${baseUrl}/public/podcasts/${slugEnc}/rss`,
    }),
  };
  const { subject, text, html } = buildNewShowEmail(opts);
  sendMail({ to, subject, text, html }).then((result) => {
    if (!result.sent) {
      log.warn(
        { error: result.error },
        "New show congratulations email failed",
      );
    }
  });
}

export function afterCreatePodcast(
  podcastId: string,
  _data: { title: string; slug: string },
  userId: string,
  log: FastifyBaseLogger,
): void {
  try {
    writeRssFile(podcastId, null);
    deleteTokenFeedTemplateFile(podcastId);
    notifyWebSubHub(podcastId, null);
  } catch {
    // non-fatal
  }
  sendNewShowCongratulationsEmail(podcastId, _data, userId, log);
}

export function afterUpdatePodcast(podcastId: string): void {
  try {
    writeRssFile(podcastId, null);
    deleteTokenFeedTemplateFile(podcastId);
    notifyWebSubHub(podcastId, null);
  } catch {
    // non-fatal: feed will regenerate on next save or episode change
  }
}
