/**
 * Build ICS calendar payloads and Google Calendar TEMPLATE links for group-call meetings.
 */

import {
  APP_NAME,
  APP_NAME_SLUG,
  MEETING_JOIN_EXPIRES_AFTER_MS,
} from "../../config.js";

export type MeetingCalendarInput = {
  meetingId: string;
  scheduledStartAt: string;
  /** End = start + join-expires window by default. */
  scheduledEndAt?: string;
  podcastTitle: string;
  episodeTitle: string;
  joinUrl: string;
  joinCode: string;
  dialInPhoneNumber?: string | null;
  hostEmail?: string | null;
  hostName?: string | null;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  sequence?: number;
  method?: "REQUEST" | "CANCEL";
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format Date as UTC ICS timestamp: YYYYMMDDTHHMMSSZ */
export function toIcsUtc(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    parts.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return parts.join("\r\n");
}

export function meetingEventEndAt(scheduledStartAt: string): Date {
  return new Date(
    new Date(scheduledStartAt).getTime() + MEETING_JOIN_EXPIRES_AFTER_MS,
  );
}

export function buildMeetingDescription(input: MeetingCalendarInput): string {
  const lines = [
    `Group call for ${input.podcastTitle} - ${input.episodeTitle}`,
    "",
    `Join: ${input.joinUrl}`,
    `Join code: ${input.joinCode}`,
  ];
  if (input.dialInPhoneNumber) {
    lines.push(`Dial-in: ${input.dialInPhoneNumber} (PIN ${input.joinCode})`);
  }
  return lines.join("\n");
}

export function buildMeetingIcs(input: MeetingCalendarInput): {
  filename: string;
  contentType: string;
  body: string;
} {
  const start = new Date(input.scheduledStartAt);
  const end = input.scheduledEndAt
    ? new Date(input.scheduledEndAt)
    : meetingEventEndAt(input.scheduledStartAt);
  const now = new Date();
  const method = input.method ?? "REQUEST";
  const uid = `${APP_NAME_SLUG}-meeting-${input.meetingId}@${APP_NAME_SLUG}`;
  const summary = `${input.podcastTitle} - ${input.episodeTitle} group call`;
  const description = buildMeetingDescription(input);
  const sequence = input.sequence ?? 0;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Group Call Meeting//EN`,
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `URL:${input.joinUrl}`,
    `SEQUENCE:${sequence}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
  ];

  if (input.hostEmail) {
    const cn = escapeIcsText(input.hostName || input.hostEmail);
    lines.push(
      `ORGANIZER;CN=${cn}:mailto:${input.hostEmail}`,
    );
  }
  if (input.attendeeEmail && method === "REQUEST") {
    const cn = escapeIcsText(input.attendeeName || input.attendeeEmail);
    lines.push(
      `ATTENDEE;CN=${cn};RSVP=TRUE:mailto:${input.attendeeEmail}`,
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  const body = lines.map(foldIcsLine).join("\r\n") + "\r\n";
  return {
    filename: `${APP_NAME_SLUG}-meeting.ics`,
    contentType: "text/calendar; charset=utf-8; method=" + method,
    body,
  };
}

/** Google Calendar TEMPLATE link (add-to-calendar only; no RSVP). */
export function buildGoogleCalendarUrl(input: MeetingCalendarInput): string {
  const start = new Date(input.scheduledStartAt);
  const end = input.scheduledEndAt
    ? new Date(input.scheduledEndAt)
    : meetingEventEndAt(input.scheduledStartAt);
  const dates = `${toIcsUtc(start)}/${toIcsUtc(end)}`;
  const text = `${input.podcastTitle} - ${input.episodeTitle} group call`;
  const details = buildMeetingDescription(input);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text,
    dates,
    details,
    location: input.joinUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
