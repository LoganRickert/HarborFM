import { randomBytes } from "crypto";
import { VERIFICATION_EXPIRY_HOURS, VERIFICATION_TOKEN_BYTES } from "../../config.js";
import { sha256Hex } from "../../utils/hash.js";
import { buildVars } from "./alertVars.js";
import { dispatchCommunity } from "./channels.js";
import {
  buildEpisodeAlertEmail,
  buildEpisodeAlertVerifyEmail,
} from "./emailBuilders.js";
import {
  destinationMatchesEpisode,
  pickEmailTransport,
  sendAlertEmail,
} from "./emailTransport.js";
import {
  buildEpisodeAlertArtworkUrl,
  getEpisodeAlertPublicOrigin,
} from "./publicUrls.js";
import * as repo from "./repo.js";

export type { AlertVars } from "./alertVars.js";
export { renderTemplate } from "./alertVars.js";
export { episodeAlertsEmailAvailable } from "./emailTransport.js";

/**
 * Dispatch alerts for a released episode. Idempotent via episode_alerts_sent_at.
 */
export async function dispatchEpisodeAlerts(episodeId: string): Promise<void> {
  const episode = repo.getEpisodeForAlert(episodeId);
  if (!episode) return;
  if (!repo.isEpisodeReleased(episode)) return;
  if (episode.episodeAlertsSentAt) return;

  const podcast = repo.getPodcastAlertSettings(episode.podcastId);
  if (!podcast?.episodeAlertsEnabled) return;

  // Atomic claim: publish hook and 15-minute poller (or multiple processes) can
  // both enter dispatch; only the first UPDATE wins and is allowed to send.
  if (!repo.claimEpisodeAlertsSend(episodeId)) return;

  const destinations = repo.listDestinations(podcast.id).filter((d) => d.enabled);
  if (destinations.length === 0) return;

  const baseUrl = getEpisodeAlertPublicOrigin(podcast.id);
  const vars = buildVars(podcast, episode);
  const episodeIsPremium = Boolean(episode.subscriberOnly);

  // Community / webhook destinations (respect per-destination episode scope)
  for (const dest of destinations) {
    if (
      dest.type === "builtin" ||
      dest.type === "byo_email" ||
      dest.type === "byo_sendgrid"
    ) {
      continue;
    }
    if (!destinationMatchesEpisode(dest, episodeIsPremium)) continue;
    try {
      await dispatchCommunity(dest, vars);
    } catch (err) {
      console.warn(
        `[episodeAlerts] destination ${dest.id} (${dest.type}) failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const emailDest = pickEmailTransport(destinations, episodeIsPremium);
  if (!emailDest) return;

  // General list = public feed signups; subscribers list = premium-episode alerts only.
  const lists: Array<"general" | "subscribers"> = episodeIsPremium
    ? ["subscribers"]
    : ["general"];
  const subscribers = repo.listVerifiedEmails(podcast.id, lists);
  if (subscribers.length === 0) return;

  console.info(
    `[episodeAlerts] email via ${emailDest.type} "${emailDest.name || emailDest.id}" scope=${emailDest.episodeScope} episodePremium=${episodeIsPremium} lists=${lists.join(",")}`,
  );

  const { rotateUnsubscribeToken } = await import("./subscribers.js");
  for (const sub of subscribers) {
    try {
      const rawUnsub = rotateUnsubscribeToken(sub.id);
      const unsubUrl = `${baseUrl}/api/public/episode-alerts/unsubscribe?token=${encodeURIComponent(rawUnsub)}`;
      const content = buildEpisodeAlertEmail({
        podcastTitle: podcast.title,
        episodeTitle: episode.title,
        episodeUrl: vars.episodeUrl,
        unsubscribeUrl: unsubUrl,
        mailingAddress: podcast.episodeAlertsMailingAddress,
        baseUrl,
        description: episode.description,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        artworkUrl: buildEpisodeAlertArtworkUrl(episode),
      });
      const result = await sendAlertEmail(emailDest, {
        to: sub.email,
        ...content,
      });
      if (!result.sent) {
        console.warn(
          `[episodeAlerts] email to ${sub.email} failed:`,
          result.error,
        );
      }
    } catch (err) {
      console.warn(
        `[episodeAlerts] email to ${sub.email} error:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/** Create pending subscriber and send verification email. */
export async function startSubscriberSignup(opts: {
  podcastId: string;
  email: string;
  list: "general" | "subscribers";
  source: "feed" | "checkout";
}): Promise<{ ok: true; alreadyVerified?: boolean } | { ok: false; error: string }> {
  const podcast = repo.getPodcastAlertSettings(opts.podcastId);
  if (!podcast?.episodeAlertsEnabled) {
    return { ok: false, error: "Episode alerts are not enabled" };
  }
  if (!repo.hasEnabledEmailDestination(opts.podcastId)) {
    return { ok: false, error: "Email alerts are not configured" };
  }

  const verifyToken = randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");
  const unsubToken = randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");
  const { hashUnsubscribeToken } = await import("./subscribers.js");
  const expiresAt = new Date(
    Date.now() + VERIFICATION_EXPIRY_HOURS * 3600 * 1000,
  ).toISOString();

  const { alreadyVerified } = repo.upsertPendingSubscriber({
    podcastId: opts.podcastId,
    email: opts.email,
    list: opts.list,
    source: opts.source,
    verifyTokenHash: sha256Hex(verifyToken),
    verifyExpiresAt: expiresAt,
    unsubscribeTokenHash: hashUnsubscribeToken(unsubToken),
  });

  if (alreadyVerified) {
    return { ok: true, alreadyVerified: true };
  }

  const destinations = repo.listDestinations(opts.podcastId);
  // Verification mail: any enabled email destination (ignore episode scope)
  const emailDest = pickEmailTransport(
    destinations.filter((d) => d.enabled),
    true,
  );
  if (!emailDest) {
    return { ok: false, error: "Email alerts are not configured" };
  }

  const baseUrl = getEpisodeAlertPublicOrigin(opts.podcastId);
  const verifyUrl = `${baseUrl}/api/public/episode-alerts/verify?token=${encodeURIComponent(verifyToken)}`;
  const content = buildEpisodeAlertVerifyEmail({
    podcastTitle: podcast.title,
    verifyUrl,
    mailingAddress: podcast.episodeAlertsMailingAddress,
    baseUrl,
  });

  const result = await sendAlertEmail(emailDest, {
    to: opts.email.trim().toLowerCase(),
    ...content,
  });
  if (!result.sent) {
    return { ok: false, error: result.error || "Failed to send verification email" };
  }
  return { ok: true };
}
