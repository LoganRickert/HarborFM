import {
  buildGoogleCalendarUrl,
  buildMeetingIcs,
  type MeetingCalendarInput,
} from "./meetingCalendar.js";
import {
  getMeetingContext,
  listEmailedInvites,
  markInviteSent,
  type MeetingInviteRow,
  type MeetingRow,
} from "./meetings.js";
import { buildCallJoinUrl } from "./repo.js";
import { getDialInPublicConfig } from "./dialIn/config.js";
import { readSettings } from "../settings/index.js";
import {
  buildGroupCallMeetingCancelledEmail,
  buildGroupCallMeetingCreatorEmail,
  buildGroupCallMeetingEpisodePublishedEmail,
  buildGroupCallMeetingInviteEmail,
  buildGroupCallMeetingRescheduledEmail,
  sendMail,
  type GroupCallMeetingEmailOptions,
} from "../../services/email.js";
import { API_PREFIX } from "../../config.js";

/** Prefer request origin; fall back to settings hostname so join URLs are always absolute for email/ICS. */
function absoluteOrigin(fallbackOrigin: string): string {
  const trimmed = (fallbackOrigin || "").trim();
  if (trimmed) {
    try {
      return new URL(trimmed).origin;
    } catch {
      /* continue */
    }
  }
  const settings = readSettings();
  const host = (settings.hostname?.trim() || "http://localhost").replace(/\/$/, "");
  try {
    if (/^https?:\/\//i.test(host)) return new URL(host).origin;
    return new URL(`https://${host}`).origin;
  } catch {
    return "http://localhost";
  }
}

function absoluteJoinUrl(
  meeting: MeetingRow,
  fallbackOrigin: string,
  invite?: MeetingInviteRow | null,
): string {
  const origin = absoluteOrigin(fallbackOrigin);
  const base = buildCallJoinUrl(meeting.podcastId, meeting.token, origin);
  const abs = base.startsWith("http")
    ? base
    : `${origin}${base.startsWith("/") ? "" : "/"}${base}`;
  if (!invite) return abs;
  const sep = abs.includes("?") ? "&" : "?";
  return `${abs}${sep}invite=${encodeURIComponent(invite.inviteToken)}`;
}

function calendarInputForMeeting(
  meeting: MeetingRow,
  joinUrl: string,
  extras?: {
    attendeeEmail?: string | null;
    attendeeName?: string | null;
    method?: "REQUEST" | "CANCEL";
  },
): MeetingCalendarInput {
  const ctx = getMeetingContext(meeting);
  const dial = getDialInPublicConfig();
  return {
    meetingId: meeting.id,
    scheduledStartAt: meeting.scheduledStartAt,
    podcastTitle: ctx.podcastTitle,
    episodeTitle: ctx.episodeTitle,
    joinUrl,
    joinCode: meeting.joinCode,
    dialInPhoneNumber: dial.enabled ? dial.phoneNumber : null,
    hostEmail: ctx.hostEmail,
    hostName: ctx.hostName,
    attendeeEmail: extras?.attendeeEmail,
    attendeeName: extras?.attendeeName,
    sequence: meeting.icsSequence ?? 0,
    method: extras?.method,
  };
}

function inviteJoinUrl(
  meeting: MeetingRow,
  fallbackOrigin: string,
  invite?: MeetingInviteRow | null,
): string {
  return absoluteJoinUrl(meeting, fallbackOrigin, invite);
}

function absoluteCoverArtUrl(
  ctx: ReturnType<typeof getMeetingContext>,
  fallbackOrigin: string,
): string | null {
  const origin = absoluteOrigin(fallbackOrigin);
  const remote = ctx.artworkUrl?.trim();
  if (remote && /^https?:\/\//i.test(remote)) return remote;
  const path = ctx.artworkPath?.trim();
  if (!path) return null;
  const filename = path.split(/[/\\]/).pop();
  if (!filename) return null;
  return `${origin}/${API_PREFIX}/public/artwork/${encodeURIComponent(ctx.podcastId)}/${encodeURIComponent(filename)}`;
}

function meetingEmailSharedOpts(
  meeting: MeetingRow,
  fallbackOrigin: string,
  invite?: MeetingInviteRow | null,
): Pick<
  GroupCallMeetingEmailOptions,
  | "podcastTitle"
  | "episodeTitle"
  | "scheduledStartAt"
  | "hostTimeZone"
  | "joinUrl"
  | "joinCode"
  | "dialInPhoneNumber"
  | "coverArtUrl"
> {
  const ctx = getMeetingContext(meeting);
  const dial = getDialInPublicConfig();
  return {
    podcastTitle: ctx.podcastTitle,
    episodeTitle: ctx.episodeTitle,
    scheduledStartAt: meeting.scheduledStartAt,
    hostTimeZone: meeting.hostTimeZone,
    joinUrl: absoluteJoinUrl(meeting, fallbackOrigin, invite),
    joinCode: meeting.joinCode,
    dialInPhoneNumber: dial.enabled ? dial.phoneNumber : null,
    coverArtUrl: absoluteCoverArtUrl(ctx, fallbackOrigin),
  };
}

export async function sendMeetingCreatorConfirmation(
  meeting: MeetingRow,
  fallbackOrigin: string,
): Promise<{ sent: boolean; error?: string }> {
  const ctx = getMeetingContext(meeting);
  if (!ctx.hostEmail) return { sent: false, error: "Host has no email" };
  const joinUrl = absoluteJoinUrl(meeting, fallbackOrigin);
  const cal = calendarInputForMeeting(meeting, joinUrl);
  const gcal = buildGoogleCalendarUrl(cal);
  const ics = buildMeetingIcs(cal);
  const content = buildGroupCallMeetingCreatorEmail({
    ...meetingEmailSharedOpts(meeting, fallbackOrigin),
    googleCalendarUrl: gcal,
  });
  return sendMail({
    to: ctx.hostEmail,
    ...content,
    attachments: [
      {
        filename: ics.filename,
        content: ics.body,
        contentType: ics.contentType,
      },
    ],
  });
}

export async function sendMeetingInviteEmail(
  meeting: MeetingRow,
  invite: MeetingInviteRow,
  fallbackOrigin: string,
): Promise<{ sent: boolean; error?: string }> {
  const email = invite.email?.trim();
  if (!email) return { sent: false, error: "Invite has no email" };
  const ctx = getMeetingContext(meeting);
  const joinUrl = absoluteJoinUrl(meeting, fallbackOrigin, invite);
  const cal = calendarInputForMeeting(meeting, joinUrl, {
    attendeeEmail: email,
    attendeeName: invite.displayName,
  });
  const gcal = buildGoogleCalendarUrl(cal);
  const ics = buildMeetingIcs(cal);
  const content = buildGroupCallMeetingInviteEmail({
    ...meetingEmailSharedOpts(meeting, fallbackOrigin, invite),
    googleCalendarUrl: gcal,
    guestName: invite.displayName,
  });
  const result = await sendMail({
    to: email,
    ...content,
    replyTo: ctx.hostEmail ?? undefined,
    attachments: [
      {
        filename: ics.filename,
        content: ics.body,
        contentType: ics.contentType,
      },
    ],
  });
  if (result.sent) markInviteSent(invite.id);
  return result;
}

export async function notifyEmailedInvitesRescheduled(
  meeting: MeetingRow,
  previousScheduledStartAt: string,
  fallbackOrigin: string,
): Promise<void> {
  const invites = listEmailedInvites(meeting.id);
  const ctx = getMeetingContext(meeting);
  for (const invite of invites) {
    const email = invite.email?.trim();
    if (!email) continue;
    const joinUrl = absoluteJoinUrl(meeting, fallbackOrigin, invite);
    const cal = calendarInputForMeeting(meeting, joinUrl, {
      attendeeEmail: email,
      attendeeName: invite.displayName,
    });
    const gcal = buildGoogleCalendarUrl(cal);
    const ics = buildMeetingIcs(cal);
    const content = buildGroupCallMeetingRescheduledEmail({
      ...meetingEmailSharedOpts(meeting, fallbackOrigin, invite),
      previousScheduledStartAt,
      googleCalendarUrl: gcal,
      guestName: invite.displayName,
    });
    await sendMail({
      to: email,
      ...content,
      replyTo: ctx.hostEmail ?? undefined,
      attachments: [
        {
          filename: ics.filename,
          content: ics.body,
          contentType: ics.contentType,
        },
      ],
    });
  }
}

export async function notifyEmailedInvitesCancelled(
  meeting: MeetingRow,
  fallbackOrigin: string,
): Promise<void> {
  const invites = listEmailedInvites(meeting.id);
  const ctx = getMeetingContext(meeting);
  const joinUrl = absoluteJoinUrl(meeting, fallbackOrigin);
  for (const invite of invites) {
    const email = invite.email?.trim();
    if (!email) continue;
    const cal = calendarInputForMeeting(meeting, joinUrl, {
      attendeeEmail: email,
      attendeeName: invite.displayName,
      method: "CANCEL",
    });
    const ics = buildMeetingIcs(cal);
    const content = buildGroupCallMeetingCancelledEmail({
      podcastTitle: ctx.podcastTitle,
      episodeTitle: ctx.episodeTitle,
      scheduledStartAt: meeting.scheduledStartAt,
      hostTimeZone: meeting.hostTimeZone,
      guestName: invite.displayName,
      joinUrl,
      coverArtUrl: absoluteCoverArtUrl(ctx, fallbackOrigin),
    });
    await sendMail({
      to: email,
      ...content,
      replyTo: ctx.hostEmail ?? undefined,
      attachments: [
        {
          filename: ics.filename,
          content: ics.body,
          contentType: ics.contentType,
        },
      ],
    });
  }
}

export async function notifyEmailedInvitesEpisodePublished(
  meeting: MeetingRow,
  fallbackOrigin: string,
): Promise<void> {
  const invites = listEmailedInvites(meeting.id);
  const ctx = getMeetingContext(meeting);
  const hostEmailLower = ctx.hostEmail?.toLowerCase() ?? null;
  for (const invite of invites) {
    const email = invite.email?.trim();
    if (!email) continue;
    if (hostEmailLower && email.toLowerCase() === hostEmailLower) continue;
    const joinUrl = absoluteJoinUrl(meeting, fallbackOrigin, invite);
    const cal = calendarInputForMeeting(meeting, joinUrl, {
      attendeeEmail: email,
      attendeeName: invite.displayName,
    });
    const gcal = buildGoogleCalendarUrl(cal);
    const ics = buildMeetingIcs(cal);
    const content = buildGroupCallMeetingEpisodePublishedEmail({
      ...meetingEmailSharedOpts(meeting, fallbackOrigin, invite),
      googleCalendarUrl: gcal,
      guestName: invite.displayName,
    });
    await sendMail({
      to: email,
      ...content,
      replyTo: ctx.hostEmail ?? undefined,
      attachments: [
        {
          filename: ics.filename,
          content: ics.body,
          contentType: ics.contentType,
        },
      ],
    });
  }
}

export { inviteJoinUrl, absoluteJoinUrl, absoluteOrigin };
