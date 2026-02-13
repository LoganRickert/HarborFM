import type { FastifyBaseLogger } from "fastify";
import { deleteTokenFeedTemplateFile, writeRssFile } from "../../services/rss.js";
import { notifyWebSubHub } from "../../services/websub.js";
import { sendMail, buildNewShowEmail } from "../../services/email.js";
import { readSettings } from "../settings/index.js";
import { normalizeHostname } from "../../utils/url.js";
import { db } from "../../db/index.js";

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
  const settings = readSettings();
  if (
    (settings.email_provider === "smtp" ||
      settings.email_provider === "sendgrid") &&
    settings.email_enable_new_show
  ) {
    const owner = db
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(userId) as { email: string | null } | undefined;
    const to = owner?.email?.trim();
    if (to) {
      const baseUrl =
        normalizeHostname(settings.hostname || "") || "http://localhost";
      const showUrl = `${baseUrl}/podcasts/${podcastId}`;
      const showTitle = (_data.title || "Your show").trim() || "Your show";
      const slugEnc = encodeURIComponent(_data.slug);
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
  }
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
