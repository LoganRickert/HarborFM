import { getActiveMeetingForEpisode, setEpisodePublishedNotified } from "./meetings.js";
import { notifyEmailedInvitesEpisodePublished } from "./meetingMail.js";
import { getCallJoinOrigin } from "./repo.js";

/**
 * When an episode first becomes published, notify emailed meeting invitees once.
 * Does not email the host. Ignores meta-only edits (caller should only invoke on publish transition).
 */
export async function notifyMeetingInvitesOnEpisodePublish(
  episodeId: string,
  fallbackOrigin: string,
): Promise<void> {
  const meeting = getActiveMeetingForEpisode(episodeId);
  if (!meeting) return;
  if (meeting.episodePublishedNotifiedAt) return;

  const origin = getCallJoinOrigin(meeting.podcastId, fallbackOrigin);
  await notifyEmailedInvitesEpisodePublished(meeting, origin);
  setEpisodePublishedNotified(meeting.id);
}
