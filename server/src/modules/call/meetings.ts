import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../db/index.js";
import {
  MEETING_JOIN_EXPIRES_AFTER_MS,
  MEETING_JOIN_OPENS_BEFORE_MS,
  MEETING_REMINDER_BEFORE_MS,
  MEETING_REMINDER_MIN_LEAD_MS,
  MAX_ACTIVE_MEETINGS_PER_USER,
  MAX_SCHEDULE_AHEAD_MS,
} from "../../config.js";
import {
  episodeGroupCallMeetingInvites,
  episodeGroupCallMeetings,
  episodes,
  podcastCast,
  podcasts,
  users,
} from "../../db/schema.js";

export {
  MEETING_JOIN_OPENS_BEFORE_MS,
  MEETING_JOIN_EXPIRES_AFTER_MS,
  MEETING_REMINDER_BEFORE_MS,
  MEETING_REMINDER_MIN_LEAD_MS,
  MAX_ACTIVE_MEETINGS_PER_USER,
  MAX_SCHEDULE_AHEAD_MS,
};

/** Human duration for meeting window copy (e.g. "1 hour", "90 minutes"). */
export function formatMeetingDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 minutes";
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export type MeetingRowStatus =
  | "scheduled"
  | "live"
  | "ended"
  | "cancelled"
  | "expired";

export type MeetingRow = typeof episodeGroupCallMeetings.$inferSelect;
export type MeetingInviteRow = typeof episodeGroupCallMeetingInvites.$inferSelect;

export function joinOpensAtMs(scheduledStartAtIso: string): number {
  return new Date(scheduledStartAtIso).getTime() - MEETING_JOIN_OPENS_BEFORE_MS;
}

export function joinExpiresAtMs(scheduledStartAtIso: string): number {
  return new Date(scheduledStartAtIso).getTime() + MEETING_JOIN_EXPIRES_AFTER_MS;
}

export function isMeetingWindowActive(
  scheduledStartAtIso: string,
  nowMs: number = Date.now(),
): boolean {
  return nowMs < joinExpiresAtMs(scheduledStartAtIso);
}

export function isWithinJoinWindow(
  scheduledStartAtIso: string,
  nowMs: number = Date.now(),
): boolean {
  return (
    nowMs >= joinOpensAtMs(scheduledStartAtIso) &&
    nowMs < joinExpiresAtMs(scheduledStartAtIso)
  );
}

/** Active = scheduled|live and not past expiry window. */
export function isActiveMeetingRow(
  row: Pick<MeetingRow, "status" | "scheduledStartAt">,
  nowMs: number = Date.now(),
): boolean {
  if (row.status !== "scheduled" && row.status !== "live") return false;
  return isMeetingWindowActive(row.scheduledStartAt, nowMs);
}

export function expireStaleMeetings(nowMs: number = Date.now()): void {
  const nowIso = new Date(nowMs).toISOString();
  const candidates = drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(inArray(episodeGroupCallMeetings.status, ["scheduled", "live"]))
    .all();
  for (const row of candidates) {
    if (!isMeetingWindowActive(row.scheduledStartAt, nowMs)) {
      drizzleDb
        .update(episodeGroupCallMeetings)
        .set({
          status: "expired",
          updatedAt: nowIso,
          endedAt: row.endedAt ?? nowIso,
        })
        .where(eq(episodeGroupCallMeetings.id, row.id))
        .run();
    }
  }
}

export function listReservedJoinCodes(nowMs: number = Date.now()): Set<string> {
  expireStaleMeetings(nowMs);
  const rows = drizzleDb
    .select({
      joinCode: episodeGroupCallMeetings.joinCode,
      status: episodeGroupCallMeetings.status,
      scheduledStartAt: episodeGroupCallMeetings.scheduledStartAt,
    })
    .from(episodeGroupCallMeetings)
    .where(inArray(episodeGroupCallMeetings.status, ["scheduled", "live"]))
    .all();
  const codes = new Set<string>();
  for (const row of rows) {
    if (isActiveMeetingRow(row, nowMs)) codes.add(row.joinCode);
  }
  return codes;
}

export function isJoinCodeReserved(
  code: string,
  nowMs: number = Date.now(),
): boolean {
  return listReservedJoinCodes(nowMs).has(code);
}

export function allocateMeetingJoinCode(nowMs: number = Date.now()): string {
  const reserved = listReservedJoinCodes(nowMs);
  for (let i = 0; i < 40; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (reserved.has(code)) continue;
    return code;
  }
  throw new Error("Could not allocate a free join code");
}

export function countActiveMeetingsForUser(
  userId: string,
  nowMs: number = Date.now(),
): number {
  expireStaleMeetings(nowMs);
  const rows = drizzleDb
    .select({
      status: episodeGroupCallMeetings.status,
      scheduledStartAt: episodeGroupCallMeetings.scheduledStartAt,
    })
    .from(episodeGroupCallMeetings)
    .where(
      and(
        eq(episodeGroupCallMeetings.createdByUserId, userId),
        inArray(episodeGroupCallMeetings.status, ["scheduled", "live"]),
      ),
    )
    .all();
  return rows.filter((r) => isActiveMeetingRow(r, nowMs)).length;
}

export function getActiveMeetingForEpisode(
  episodeId: string,
  nowMs: number = Date.now(),
): MeetingRow | undefined {
  expireStaleMeetings(nowMs);
  const rows = drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(
      and(
        eq(episodeGroupCallMeetings.episodeId, episodeId),
        inArray(episodeGroupCallMeetings.status, ["scheduled", "live"]),
      ),
    )
    .all();
  return rows.find((r) => isActiveMeetingRow(r, nowMs));
}

/**
 * Prefer an active scheduled/live meeting; otherwise the most recently updated
 * meeting for the episode (including ended/expired/cancelled). Used for
 * post-call guest review emails when the live window has closed.
 */
export function getLatestMeetingForEpisode(
  episodeId: string,
  nowMs: number = Date.now(),
): MeetingRow | undefined {
  const active = getActiveMeetingForEpisode(episodeId, nowMs);
  if (active) return active;
  expireStaleMeetings(nowMs);
  const rows = drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(eq(episodeGroupCallMeetings.episodeId, episodeId))
    .all();
  if (rows.length === 0) return undefined;
  return [...rows].sort((a, b) => {
    const aT = Date.parse(a.updatedAt || a.createdAt || "") || 0;
    const bT = Date.parse(b.updatedAt || b.createdAt || "") || 0;
    return bT - aT;
  })[0];
}

export function getMeetingById(id: string): MeetingRow | undefined {
  expireStaleMeetings();
  return drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(eq(episodeGroupCallMeetings.id, id))
    .limit(1)
    .get();
}

export function getMeetingByToken(token: string): MeetingRow | undefined {
  expireStaleMeetings();
  return drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(eq(episodeGroupCallMeetings.token, token))
    .limit(1)
    .get();
}

export function getMeetingByJoinCode(code: string): MeetingRow | undefined {
  expireStaleMeetings();
  if (!/^\d{4}$/.test(code)) return undefined;
  const rows = drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(eq(episodeGroupCallMeetings.joinCode, code))
    .all();
  return rows.find((r) => isActiveMeetingRow(r) || r.status === "ended" || r.status === "expired" || r.status === "cancelled");
}

export function getActiveMeetingByJoinCode(
  code: string,
  nowMs: number = Date.now(),
): MeetingRow | undefined {
  expireStaleMeetings(nowMs);
  if (!/^\d{4}$/.test(code)) return undefined;
  const rows = drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(eq(episodeGroupCallMeetings.joinCode, code))
    .all();
  return rows.find((r) => isActiveMeetingRow(r, nowMs));
}

/** Normalize and validate an IANA time zone from the host browser. */
export function normalizeHostTimeZone(
  timeZone: string | null | undefined,
): string | null {
  const tz = timeZone?.trim() || "";
  if (!tz || tz.length > 64) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

export function createMeeting(input: {
  episodeId: string;
  podcastId: string;
  createdByUserId: string;
  scheduledStartAt: string;
  hostTimeZone?: string | null;
}): MeetingRow {
  const nowIso = new Date().toISOString();
  const id = nanoid();
  const token = nanoid(16);
  const joinCode = allocateMeetingJoinCode();
  drizzleDb
    .insert(episodeGroupCallMeetings)
    .values({
      id,
      episodeId: input.episodeId,
      podcastId: input.podcastId,
      createdByUserId: input.createdByUserId,
      scheduledStartAt: input.scheduledStartAt,
      hostTimeZone: normalizeHostTimeZone(input.hostTimeZone),
      token,
      joinCode,
      status: "scheduled",
      icsSequence: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();
  const row = getMeetingById(id);
  if (!row) throw new Error("Failed to create meeting");
  return row;
}

export function updateMeetingSchedule(
  id: string,
  scheduledStartAt: string,
  hostTimeZone?: string | null,
): MeetingRow | undefined {
  const existing = getMeetingById(id);
  if (!existing) return undefined;
  const nowIso = new Date().toISOString();
  const nextTz = normalizeHostTimeZone(hostTimeZone);
  drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      scheduledStartAt,
      ...(nextTz ? { hostTimeZone: nextTz } : {}),
      icsSequence: (existing.icsSequence ?? 0) + 1,
      // New start time: allow a fresh 4-hour reminder when eligible.
      reminderSentAt: null,
      updatedAt: nowIso,
    })
    .where(eq(episodeGroupCallMeetings.id, id))
    .run();
  return getMeetingById(id);
}

/** Set or refresh host time zone from the browser (used when inviting / scheduling). */
export function ensureMeetingHostTimeZone(
  id: string,
  hostTimeZone?: string | null,
): MeetingRow | undefined {
  const existing = getMeetingById(id);
  if (!existing) return undefined;
  const nextTz = normalizeHostTimeZone(hostTimeZone);
  if (!nextTz) return existing;
  if (existing.hostTimeZone?.trim() === nextTz) return existing;
  drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      hostTimeZone: nextTz,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(episodeGroupCallMeetings.id, id))
    .run();
  return getMeetingById(id);
}

export function cancelMeeting(id: string): MeetingRow | undefined {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      status: "cancelled",
      cancelledAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(episodeGroupCallMeetings.id, id))
    .run();
  return getMeetingById(id);
}

export function markMeetingLive(
  id: string,
  liveSessionId: string,
): MeetingRow | undefined {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      status: "live",
      liveSessionId,
      updatedAt: nowIso,
    })
    .where(eq(episodeGroupCallMeetings.id, id))
    .run();
  return getMeetingById(id);
}

export function markMeetingEnded(id: string): MeetingRow | undefined {
  const meeting = getMeetingById(id);
  if (!meeting) return undefined;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  // Within window: back to scheduled so host can restart; otherwise ended.
  const nextStatus = isWithinJoinWindow(meeting.scheduledStartAt, nowMs)
    ? "scheduled"
    : "ended";
  drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      status: nextStatus,
      liveSessionId: null,
      endedAt: nextStatus === "ended" ? nowIso : meeting.endedAt,
      updatedAt: nowIso,
    })
    .where(eq(episodeGroupCallMeetings.id, id))
    .run();
  return getMeetingById(id);
}

export function markMeetingEndedBySessionId(liveSessionId: string): void {
  const row = drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(eq(episodeGroupCallMeetings.liveSessionId, liveSessionId))
    .limit(1)
    .get();
  if (row) markMeetingEnded(row.id);
}

export function setEpisodePublishedNotified(id: string): void {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      episodePublishedNotifiedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(episodeGroupCallMeetings.id, id))
    .run();
}

export function setGuestReviewNotified(id: string): void {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      guestReviewNotifiedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(episodeGroupCallMeetings.id, id))
    .run();
}

/**
 * Meetings due for a 4-hour invitee reminder:
 * scheduled, not yet reminded, originally scheduled 5+ hours out,
 * and currently in the catch window ending at T-4h (default ~1 hour wide)
 * so a 15-minute poller can send without a late "in just 4 hours" email.
 */
export function listDueMeetingReminders(limit = 50): MeetingRow[] {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  const now = Date.now();
  const windowMs = Math.max(60_000, Math.round(MEETING_REMINDER_BEFORE_MS / 4));
  const dueEndMs = now + MEETING_REMINDER_BEFORE_MS;
  const dueStartMs = dueEndMs - windowMs;
  const candidates = drizzleDb
    .select()
    .from(episodeGroupCallMeetings)
    .where(
      and(
        eq(episodeGroupCallMeetings.status, "scheduled"),
        isNull(episodeGroupCallMeetings.reminderSentAt),
      ),
    )
    .all();
  const due: MeetingRow[] = [];
  for (const row of candidates) {
    const startMs = new Date(row.scheduledStartAt).getTime();
    const createdMs = new Date(row.createdAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(createdMs)) continue;
    if (startMs - createdMs < MEETING_REMINDER_MIN_LEAD_MS) continue;
    if (startMs <= dueStartMs || startMs > dueEndMs) continue;
    due.push(row);
    if (due.length >= safeLimit) break;
  }
  return due;
}

/** Atomically claim reminder send for a meeting. Returns false if already claimed. */
export function claimMeetingReminderSent(meetingId: string): boolean {
  const nowIso = new Date().toISOString();
  const result = drizzleDb
    .update(episodeGroupCallMeetings)
    .set({
      reminderSentAt: nowIso,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(episodeGroupCallMeetings.id, meetingId),
        eq(episodeGroupCallMeetings.status, "scheduled"),
        isNull(episodeGroupCallMeetings.reminderSentAt),
      ),
    )
    .run();
  return (result.changes ?? 0) > 0;
}

export function listInvites(meetingId: string): MeetingInviteRow[] {
  return drizzleDb
    .select()
    .from(episodeGroupCallMeetingInvites)
    .where(eq(episodeGroupCallMeetingInvites.meetingId, meetingId))
    .all();
}

export function listEmailedInvites(meetingId: string): MeetingInviteRow[] {
  return listInvites(meetingId).filter(
    (i) => i.email != null && i.email.trim() !== "",
  );
}

export function getInviteById(inviteId: string): MeetingInviteRow | undefined {
  return drizzleDb
    .select()
    .from(episodeGroupCallMeetingInvites)
    .where(eq(episodeGroupCallMeetingInvites.id, inviteId))
    .limit(1)
    .get();
}

export function getInviteByToken(
  inviteToken: string,
): MeetingInviteRow | undefined {
  return drizzleDb
    .select()
    .from(episodeGroupCallMeetingInvites)
    .where(eq(episodeGroupCallMeetingInvites.inviteToken, inviteToken))
    .limit(1)
    .get();
}

/** True when castId exists on the given podcast (public or private). */
export function castBelongsToPodcast(
  castId: string,
  podcastId: string,
): boolean {
  const row = drizzleDb
    .select({ id: podcastCast.id })
    .from(podcastCast)
    .where(and(eq(podcastCast.id, castId), eq(podcastCast.podcastId, podcastId)))
    .limit(1)
    .get();
  return Boolean(row);
}

export function createInvite(input: {
  meetingId: string;
  email?: string | null;
  displayName?: string | null;
  castId?: string | null;
}): MeetingInviteRow {
  const nowIso = new Date().toISOString();
  const id = nanoid();
  const inviteToken = nanoid(16);
  drizzleDb
    .insert(episodeGroupCallMeetingInvites)
    .values({
      id,
      meetingId: input.meetingId,
      email: input.email?.trim() || null,
      displayName: input.displayName?.trim() || null,
      castId: input.castId?.trim() || null,
      inviteToken,
      createdAt: nowIso,
      lastSentAt: null,
    })
    .run();
  const row = getInviteById(id);
  if (!row) throw new Error("Failed to create invite");
  return row;
}

export function markInviteSent(inviteId: string): void {
  const nowIso = new Date().toISOString();
  drizzleDb
    .update(episodeGroupCallMeetingInvites)
    .set({ lastSentAt: nowIso })
    .where(eq(episodeGroupCallMeetingInvites.id, inviteId))
    .run();
}

/** Rotate invite open-tracking token and clear prior open timestamp. Returns the new token. */
export function rotateInviteOpenToken(inviteId: string): string {
  const token = nanoid(24);
  drizzleDb
    .update(episodeGroupCallMeetingInvites)
    .set({ inviteOpenToken: token, inviteOpenedAt: null })
    .where(eq(episodeGroupCallMeetingInvites.id, inviteId))
    .run();
  return token;
}

/** Rotate reminder open-tracking token and clear prior open timestamp. Returns the new token. */
export function rotateReminderOpenToken(inviteId: string): string {
  const token = nanoid(24);
  drizzleDb
    .update(episodeGroupCallMeetingInvites)
    .set({ reminderOpenToken: token, reminderOpenedAt: null })
    .where(eq(episodeGroupCallMeetingInvites.id, inviteId))
    .run();
  return token;
}

export type MeetingEmailOpenKind = "invite" | "reminder";

/**
 * Record first open for invite or reminder tracking token.
 * Returns the kind recorded, or null if token unknown / already opened.
 */
export function recordMeetingEmailOpen(
  token: string,
): MeetingEmailOpenKind | null {
  const raw = token.trim();
  if (!raw) return null;
  const nowIso = new Date().toISOString();

  const byInvite = drizzleDb
    .select()
    .from(episodeGroupCallMeetingInvites)
    .where(eq(episodeGroupCallMeetingInvites.inviteOpenToken, raw))
    .limit(1)
    .get();
  if (byInvite) {
    if (!byInvite.inviteOpenedAt) {
      drizzleDb
        .update(episodeGroupCallMeetingInvites)
        .set({ inviteOpenedAt: nowIso })
        .where(eq(episodeGroupCallMeetingInvites.id, byInvite.id))
        .run();
      return "invite";
    }
    return "invite";
  }

  const byReminder = drizzleDb
    .select()
    .from(episodeGroupCallMeetingInvites)
    .where(eq(episodeGroupCallMeetingInvites.reminderOpenToken, raw))
    .limit(1)
    .get();
  if (byReminder) {
    if (!byReminder.reminderOpenedAt) {
      drizzleDb
        .update(episodeGroupCallMeetingInvites)
        .set({ reminderOpenedAt: nowIso })
        .where(eq(episodeGroupCallMeetingInvites.id, byReminder.id))
        .run();
      return "reminder";
    }
    return "reminder";
  }

  return null;
}

export function deleteInvite(inviteId: string): boolean {
  const result = drizzleDb
    .delete(episodeGroupCallMeetingInvites)
    .where(eq(episodeGroupCallMeetingInvites.id, inviteId))
    .run();
  return (result.changes ?? 0) > 0;
}

export function getMeetingContext(meeting: MeetingRow): {
  podcastId: string;
  podcastTitle: string;
  episodeTitle: string;
  hostEmail: string | null;
  hostName: string | null;
  artworkUrl: string | null;
  artworkPath: string | null;
} {
  const podcast = drizzleDb
    .select({
      title: podcasts.title,
      artworkUrl: podcasts.artworkUrl,
      artworkPath: podcasts.artworkPath,
    })
    .from(podcasts)
    .where(eq(podcasts.id, meeting.podcastId))
    .limit(1)
    .get();
  const episode = drizzleDb
    .select({ title: episodes.title })
    .from(episodes)
    .where(eq(episodes.id, meeting.episodeId))
    .limit(1)
    .get();
  const host = drizzleDb
    .select({ email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, meeting.createdByUserId))
    .limit(1)
    .get();
  return {
    podcastId: meeting.podcastId,
    podcastTitle: podcast?.title?.trim() || "Podcast",
    episodeTitle: episode?.title?.trim() || "Episode",
    hostEmail: host?.email?.trim() || null,
    hostName: host?.username?.trim() || null,
    artworkUrl: podcast?.artworkUrl?.trim() || null,
    artworkPath: podcast?.artworkPath?.trim() || null,
  };
}

export function validateScheduledStartAt(
  scheduledStartAt: string,
  nowMs: number = Date.now(),
): { ok: true; iso: string } | { ok: false; error: string } {
  const ms = new Date(scheduledStartAt).getTime();
  if (!Number.isFinite(ms)) {
    return { ok: false, error: "Invalid scheduled start time" };
  }
  if (ms > nowMs + MAX_SCHEDULE_AHEAD_MS) {
    return {
      ok: false,
      error: "Meetings cannot be scheduled more than 1 year ahead",
    };
  }
  return { ok: true, iso: new Date(ms).toISOString() };
}

export type GuestMeetingStatus =
  | "too_early"
  | "waiting_for_host"
  | "live"
  | "ended"
  | "expired"
  | "cancelled";

export function resolveGuestMeetingStatus(
  meeting: MeetingRow,
  liveSessionExists: boolean,
  nowMs: number = Date.now(),
): GuestMeetingStatus {
  if (meeting.status === "cancelled") return "cancelled";
  if (meeting.status === "expired") return "expired";
  if (meeting.status === "ended") return "ended";
  if (!isMeetingWindowActive(meeting.scheduledStartAt, nowMs)) {
    return "expired";
  }
  if (nowMs < joinOpensAtMs(meeting.scheduledStartAt)) return "too_early";
  if (liveSessionExists || meeting.status === "live") return "live";
  return "waiting_for_host";
}
