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
  organizerEmail?: string | null;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  sequence?: number;
  method?: "REQUEST" | "CANCEL" | "PUBLISH";
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
  method: "REQUEST" | "CANCEL" | "PUBLISH";
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
  const organizerEmail = (input.organizerEmail || input.hostEmail || "")
    .trim()
    .toLowerCase();

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
    `LOCATION:${escapeIcsText(input.joinUrl)}`,
    `URL:${input.joinUrl}`,
    `SEQUENCE:${sequence}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
  ];

  if (organizerEmail) {
    const cn = escapeIcsText(input.hostName || input.hostEmail || organizerEmail);
    lines.push(`ORGANIZER;CN=${cn}:mailto:${organizerEmail}`);
  }
  if (input.attendeeEmail && (method === "REQUEST" || method === "CANCEL")) {
    const cn = escapeIcsText(input.attendeeName || input.attendeeEmail);
    const rsvp = method === "REQUEST" ? ";RSVP=TRUE" : "";
    lines.push(
      `ATTENDEE;CN=${cn}${rsvp};PARTSTAT=${method === "CANCEL" ? "DECLINED" : "NEEDS-ACTION"}:mailto:${input.attendeeEmail}`,
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  const body = lines.map(foldIcsLine).join("\r\n") + "\r\n";
  return {
    filename: `${APP_NAME_SLUG}-meeting.ics`,
    contentType: `text/calendar; charset=utf-8; method=${method}`,
    method,
    body,
  };
}

/**
 * schema.org EventReservation JSON-LD for Gmail event chips / highlight.
 * @see https://developers.google.com/gmail/markup/reference/event-reservation
 */
export function buildMeetingEventJsonLd(
  input: MeetingCalendarInput,
): Record<string, unknown> {
  const start = new Date(input.scheduledStartAt);
  const end = input.scheduledEndAt
    ? new Date(input.scheduledEndAt)
    : meetingEventEndAt(input.scheduledStartAt);
  const cancelled = input.method === "CANCEL";
  const underEmail = (input.attendeeEmail || input.hostEmail || "").trim();
  const underName = (
    input.attendeeName ||
    input.hostName ||
    underEmail ||
    "Guest"
  ).trim();
  const eventName = `${input.podcastTitle} - ${input.episodeTitle} group call`;
  return {
    "@context": "https://schema.org",
    "@type": "EventReservation",
    reservationNumber: input.meetingId,
    reservationStatus: cancelled
      ? "https://schema.org/ReservationCancelled"
      : "https://schema.org/ReservationConfirmed",
    ...(underEmail
      ? {
          underName: {
            "@type": "Person",
            name: underName,
            email: underEmail,
          },
        }
      : {}),
    reservationFor: {
      "@type": "Event",
      name: eventName,
      description: buildMeetingDescription(input),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
      eventStatus: cancelled
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
      location: {
        "@type": "VirtualLocation",
        url: input.joinUrl,
      },
      url: input.joinUrl,
      ...(input.hostEmail || input.hostName
        ? {
            organizer: {
              "@type": "Person",
              name: (input.hostName || input.hostEmail || "").trim(),
              ...(input.hostEmail ? { email: input.hostEmail } : {}),
            },
          }
        : {}),
    },
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
