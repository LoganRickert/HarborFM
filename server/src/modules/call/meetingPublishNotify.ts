import { getActiveMeetingForEpisode, setEpisodePublishedNotified } from "./meetings.js";
import { notifyEmailedInvitesEpisodePublished } from "./meetingMail.js";
import { getCallJoinOrigin } from "./repo.js";
import {
  getEpisodeForAlert,
  isEpisodeAlertable,
} from "../episodeAlerts/repo.js";

/**
 * When an episode first becomes alertable (released and not unlisted), notify
 * emailed meeting invitees once. Does not email the host. Ignores meta-only
 * edits (caller should only invoke on the alertable transition). Skips unlisted
 * without stamping so clearing Unlisted later can still notify.
 */
export async function notifyMeetingInvitesOnEpisodePublish(
  episodeId: string,
  fallbackOrigin: string,
): Promise<void> {
  const episode = getEpisodeForAlert(episodeId);
  if (!episode || !isEpisodeAlertable(episode)) return;

  const meeting = getActiveMeetingForEpisode(episodeId);
  if (!meeting) return;
  if (meeting.episodePublishedNotifiedAt) return;

  const origin = getCallJoinOrigin(meeting.podcastId, fallbackOrigin);
  await notifyEmailedInvitesEpisodePublished(meeting, origin);
  setEpisodePublishedNotified(meeting.id);
}
