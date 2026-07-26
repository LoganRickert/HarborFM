import {
  buildGoogleCalendarUrl,
  buildMeetingEventJsonLd,
  buildMeetingIcs,
  type MeetingCalendarInput,
} from "./meetingCalendar.js";
import {
  claimMeetingReminderSent,
  formatMeetingDurationMs,
  getMeetingContext,
  listEmailedInvites,
  markInviteSent,
  MEETING_REMINDER_BEFORE_MS,
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
  buildGroupCallMeetingReminderEmail,
  buildGroupCallMeetingRescheduledEmail,
  getConfiguredFromAddress,
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
    method?: "REQUEST" | "CANCEL" | "PUBLISH";
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
    // Match envelope From so Gmail accepts the invite (host CN still shown).
    organizerEmail: getConfiguredFromAddress(),
    attendeeEmail: extras?.attendeeEmail,
    attendeeName: extras?.attendeeName,
    sequence: meeting.icsSequence ?? 0,
    method: extras?.method,
  };
}

function meetingIcalAndJsonLd(cal: MeetingCalendarInput) {
  const ics = buildMeetingIcs(cal);
  return {
    icalEvent: {
      filename: ics.filename,
      method: ics.method,
      content: ics.body,
    },
    eventJsonLd: buildMeetingEventJsonLd(cal),
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
  // PUBLISH: host confirmation is "add to calendar", not an RSVP to themselves.
  const cal = calendarInputForMeeting(meeting, joinUrl, {
    attendeeEmail: ctx.hostEmail,
    attendeeName: ctx.hostName,
    method: "PUBLISH",
  });
  const gcal = buildGoogleCalendarUrl(cal);
  const { icalEvent, eventJsonLd } = meetingIcalAndJsonLd(cal);
  const content = buildGroupCallMeetingCreatorEmail({
    ...meetingEmailSharedOpts(meeting, fallbackOrigin),
    googleCalendarUrl: gcal,
    eventJsonLd,
  });
  return sendMail({
    to: ctx.hostEmail,
    ...content,
    icalEvent,
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
  const { icalEvent, eventJsonLd } = meetingIcalAndJsonLd(cal);
  const content = buildGroupCallMeetingInviteEmail({
    ...meetingEmailSharedOpts(meeting, fallbackOrigin, invite),
    googleCalendarUrl: gcal,
    guestName: invite.displayName,
    eventJsonLd,
  });
  const result = await sendMail({
    to: email,
    ...content,
    replyTo: ctx.hostEmail ?? undefined,
    icalEvent,
  });
  if (result.sent) markInviteSent(invite.id);
  return result;
}

/**
 * Send "REMINDER: … In just N hours" to every invitee with an email.
 * Caller should claim reminder_sent_at first (see sendDueMeetingReminder).
 */
export async function notifyEmailedInvitesReminder(
  meeting: MeetingRow,
  fallbackOrigin: string,
): Promise<void> {
  const invites = listEmailedInvites(meeting.id);
  if (invites.length === 0) return;
  const ctx = getMeetingContext(meeting);
  const leadPhrase = formatMeetingDurationMs(MEETING_REMINDER_BEFORE_MS);
  for (const invite of invites) {
    const email = invite.email?.trim();
    if (!email) continue;
    const joinUrl = absoluteJoinUrl(meeting, fallbackOrigin, invite);
    const cal = calendarInputForMeeting(meeting, joinUrl, {
      attendeeEmail: email,
      attendeeName: invite.displayName,
    });
    const gcal = buildGoogleCalendarUrl(cal);
    const { icalEvent, eventJsonLd } = meetingIcalAndJsonLd(cal);
    const content = buildGroupCallMeetingReminderEmail({
      ...meetingEmailSharedOpts(meeting, fallbackOrigin, invite),
      googleCalendarUrl: gcal,
      guestName: invite.displayName,
      eventJsonLd,
      reminderLeadPhrase: leadPhrase,
    });
    await sendMail({
      to: email,
      ...content,
      replyTo: ctx.hostEmail ?? undefined,
      icalEvent,
    });
  }
}

/**
 * Claim and send the 4-hour reminder for one due meeting (idempotent).
 * Uses settings hostname when fallbackOrigin is empty (background poller).
 * Meetings with no emailed invites are claimed without sending so the poller
 * does not retry forever.
 */
export async function sendDueMeetingReminder(
  meeting: MeetingRow,
  fallbackOrigin = "",
): Promise<void> {
  const invites = listEmailedInvites(meeting.id);
  if (!claimMeetingReminderSent(meeting.id)) return;
  if (invites.length === 0) return;
  await notifyEmailedInvitesReminder(meeting, fallbackOrigin);
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
    const { icalEvent, eventJsonLd } = meetingIcalAndJsonLd(cal);
    const content = buildGroupCallMeetingRescheduledEmail({
      ...meetingEmailSharedOpts(meeting, fallbackOrigin, invite),
      previousScheduledStartAt,
      googleCalendarUrl: gcal,
      guestName: invite.displayName,
      eventJsonLd,
    });
    await sendMail({
      to: email,
      ...content,
      replyTo: ctx.hostEmail ?? undefined,
      icalEvent,
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
    const { icalEvent, eventJsonLd } = meetingIcalAndJsonLd(cal);
    const content = buildGroupCallMeetingCancelledEmail({
      podcastTitle: ctx.podcastTitle,
      episodeTitle: ctx.episodeTitle,
      scheduledStartAt: meeting.scheduledStartAt,
      hostTimeZone: meeting.hostTimeZone,
      guestName: invite.displayName,
      joinUrl,
      coverArtUrl: absoluteCoverArtUrl(ctx, fallbackOrigin),
      eventJsonLd,
    });
    await sendMail({
      to: email,
      ...content,
      replyTo: ctx.hostEmail ?? undefined,
      icalEvent,
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
    const { icalEvent, eventJsonLd } = meetingIcalAndJsonLd(cal);
    const content = buildGroupCallMeetingEpisodePublishedEmail({
      ...meetingEmailSharedOpts(meeting, fallbackOrigin, invite),
      googleCalendarUrl: gcal,
      guestName: invite.displayName,
      eventJsonLd,
    });
    await sendMail({
      to: email,
      ...content,
      replyTo: ctx.hostEmail ?? undefined,
      icalEvent,
    });
  }
}

export { inviteJoinUrl, absoluteJoinUrl, absoluteOrigin };
