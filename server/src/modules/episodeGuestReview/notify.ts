import {
  getLatestMeetingForEpisode,
  getMeetingContext,
  listEmailedInvites,
  setGuestReviewNotified,
  type MeetingRow,
} from "../call/meetings.js";
import { getCallJoinOrigin } from "../call/repo.js";
import {
  buildEpisodeAlertArtworkUrl,
  buildEpisodeAlertEpisodeUrl,
  getEpisodeAlertPublicOrigin,
} from "../episodeAlerts/publicUrls.js";
import type { EpisodeForAlert } from "../episodeAlerts/repo.js";
import { getEpisodeCast } from "../episodes/repo.js";
import {
  buildEpisodeGuestReviewInviteEmail,
  buildEpisodeGuestReviewResponseEmail,
  sendMail,
} from "../../services/email.js";
import {
  createGuestReview,
  findActiveReviewByEpisodeAndEmail,
  generateReviewToken,
  getEpisodeReviewContext,
  markReviewSent,
  rotateReviewToken,
  type EpisodeReviewContext,
  type GuestReviewRow,
} from "./repo.js";

function coverArtForEpisode(episode: EpisodeReviewContext): string | null {
  return buildEpisodeAlertArtworkUrl({
    id: episode.id,
    podcastId: episode.podcastId,
    title: episode.title,
    description: null,
    slug: episode.slug,
    publishAt: episode.publishAt,
    status: episode.status,
    unlisted: episode.unlisted,
    subscriberOnly: false,
    subscriberOnlyStartsAt: null,
    subscriberOnlyEndsAt: null,
    episodeAlertsSentAt: null,
    seasonNumber: null,
    episodeNumber: null,
    artworkPath: episode.artworkPath,
    artworkUrl: episode.artworkUrl,
    podcastArtworkPath: episode.podcastArtworkPath,
    podcastArtworkUrl: episode.podcastArtworkUrl,
  } satisfies EpisodeForAlert);
}

type Recipient = {
  email: string;
  displayName: string | null;
  isHost: boolean;
};

function collectRecipients(meeting: MeetingRow, episodeId: string): Recipient[] {
  const ctx = getMeetingContext(meeting);
  const byEmail = new Map<string, Recipient>();
  const hostEmail = ctx.hostEmail?.trim();
  if (hostEmail) {
    byEmail.set(hostEmail.toLowerCase(), {
      email: hostEmail,
      displayName: ctx.hostName,
      isHost: true,
    });
  }
  for (const invite of listEmailedInvites(meeting.id)) {
    const email = invite.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (byEmail.has(key)) continue;
    byEmail.set(key, {
      email,
      displayName: invite.displayName,
      isHost: false,
    });
  }
  // Episode cast with email who were not already meeting recipients.
  for (const member of getEpisodeCast(episodeId)) {
    const email = member.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (byEmail.has(key)) continue;
    byEmail.set(key, {
      email,
      displayName: member.name || null,
      isHost: false,
    });
  }
  return [...byEmail.values()];
}

function buildPreviewUrl(
  episode: NonNullable<ReturnType<typeof getEpisodeReviewContext>>,
  rawToken: string,
): string {
  const base = buildEpisodeAlertEpisodeUrl(
    episode.podcastId,
    episode.podcastSlug,
    episode.slug,
  );
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}review=${encodeURIComponent(rawToken)}`;
}

function ensureReviewRow(
  episodeId: string,
  meetingId: string,
  recipient: Recipient,
): { row: GuestReviewRow; rawToken: string } {
  const existing = findActiveReviewByEpisodeAndEmail(
    episodeId,
    recipient.email,
  );
  const { raw, hash } = generateReviewToken();
  if (existing) {
    rotateReviewToken(existing.id, hash);
    return {
      row: { ...existing, tokenHash: hash, revokedAt: null },
      rawToken: raw,
    };
  }
  const row = createGuestReview({
    episodeId,
    meetingId,
    email: recipient.email,
    displayName: recipient.displayName,
    tokenHash: hash,
  });
  return { row, rawToken: raw };
}

/**
 * When an episode first becomes preview-eligible (scheduled, or published and
 * unlisted), email the meeting host, emailed invitees, and episode cast members
 * who have an email a review preview link. Idempotent via guestReviewNotifiedAt.
 */
export async function notifyGuestReviewOnPreviewEligible(
  episodeId: string,
  fallbackOrigin: string,
): Promise<void> {
  const episode = getEpisodeReviewContext(episodeId);
  if (!episode || episode.status === "draft") return;

  // Listed + published is public; guests get the normal "episode published" path instead.
  if (episode.status === "published" && !episode.unlisted) {
    return;
  }

  const meeting = getLatestMeetingForEpisode(episodeId);
  if (!meeting) return;
  if (meeting.guestReviewNotifiedAt) return;

  const recipients = collectRecipients(meeting, episodeId);
  if (recipients.length === 0) {
    setGuestReviewNotified(meeting.id);
    return;
  }

  const origin =
    getCallJoinOrigin(meeting.podcastId, fallbackOrigin) ||
    getEpisodeAlertPublicOrigin(episode.podcastId);
  const ctx = getMeetingContext(meeting);

  for (const recipient of recipients) {
    const { row, rawToken } = ensureReviewRow(
      episodeId,
      meeting.id,
      recipient,
    );
    const previewUrl = buildPreviewUrl(episode, rawToken);
    const content = buildEpisodeGuestReviewInviteEmail({
      guestName: recipient.displayName,
      podcastTitle: episode.podcastTitle,
      episodeTitle: episode.title,
      previewUrl,
      baseUrl: origin,
      coverArtUrl: coverArtForEpisode(episode),
    });
    await sendMail({
      to: recipient.email,
      ...content,
      replyTo: recipient.isHost
        ? undefined
        : (ctx.hostEmail ?? undefined),
    });
    markReviewSent(row.id);
  }

  setGuestReviewNotified(meeting.id);
}

export async function notifyHostOfGuestReviewResponse(opts: {
  review: GuestReviewRow;
  kind: "approved" | "feedback";
  feedbackText?: string | null;
}): Promise<void> {
  const episode = getEpisodeReviewContext(opts.review.episodeId);
  if (!episode) return;

  const meeting = getLatestMeetingForEpisode(opts.review.episodeId);
  if (!meeting) return;
  const ctx = getMeetingContext(meeting);
  const hostEmail = ctx.hostEmail?.trim();
  if (!hostEmail) return;

  const responderEmail = opts.review.email.trim();
  if (responderEmail.toLowerCase() === hostEmail.toLowerCase()) return;

  const episodeUrl = buildEpisodeAlertEpisodeUrl(
    episode.podcastId,
    episode.podcastSlug,
    episode.slug,
  );
  const content = buildEpisodeGuestReviewResponseEmail({
    responderName: opts.review.displayName,
    responderEmail,
    podcastTitle: episode.podcastTitle,
    episodeTitle: episode.title,
    episodeUrl,
    kind: opts.kind,
    feedbackText: opts.feedbackText,
    baseUrl: getEpisodeAlertPublicOrigin(episode.podcastId),
    coverArtUrl: coverArtForEpisode(episode),
  });
  await sendMail({
    to: hostEmail,
    ...content,
    replyTo: responderEmail,
  });
}
