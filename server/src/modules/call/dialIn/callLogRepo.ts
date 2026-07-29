import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../../db/index.js";
import { dialInCallLogs } from "../../../db/schema.js";

const MAX_RETAINED_ROWS = 200;

export type DialInCallOutcome =
  | "rejected_no_call"
  | "rejected_disabled"
  | "rate_limited"
  | "busy"
  | "pin_failed"
  | "join_failed"
  | "bridged"
  | "abandoned";

export type DialInCallLogRow = {
  id: string;
  callControlId: string;
  callLegId: string | null;
  callSessionId: string | null;
  connectionId: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  direction: string | null;
  callerIdName: string | null;
  telnyxState: string | null;
  outcome: string | null;
  joinCode: string | null;
  sessionId: string | null;
  episodeId: string | null;
  podcastId: string | null;
  hangupCause: string | null;
  sipHangupCause: string | null;
  hangupSource: string | null;
  startedAt: string;
  answeredAt: string | null;
  bridgedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  pinAttempts: number;
  rawInitiatedJson: string | null;
  rawHangupJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertDialInCallLogPatch = {
  callControlId: string;
  callLegId?: string | null;
  callSessionId?: string | null;
  connectionId?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  direction?: string | null;
  callerIdName?: string | null;
  telnyxState?: string | null;
  outcome?: DialInCallOutcome | string | null;
  joinCode?: string | null;
  sessionId?: string | null;
  episodeId?: string | null;
  podcastId?: string | null;
  hangupCause?: string | null;
  sipHangupCause?: string | null;
  hangupSource?: string | null;
  startedAt?: string;
  answeredAt?: string | null;
  bridgedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  pinAttempts?: number;
  rawInitiatedJson?: string | null;
  rawHangupJson?: string | null;
};

function pruneOldLogs(): void {
  drizzleDb.run(sql`
    DELETE FROM dial_in_call_logs
    WHERE id NOT IN (
      SELECT id FROM dial_in_call_logs
      ORDER BY created_at DESC, rowid DESC
      LIMIT ${MAX_RETAINED_ROWS}
    )
  `);
}

function nowIso(): string {
  return new Date().toISOString();
}

function asOptionalString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** Extract common Telnyx payload fields for logging. */
export function telnyxPayloadFields(payload: Record<string, unknown>): {
  callLegId: string | null;
  callSessionId: string | null;
  connectionId: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  direction: string | null;
  callerIdName: string | null;
  telnyxState: string | null;
  startTime: string | null;
  hangupCause: string | null;
  sipHangupCause: string | null;
  hangupSource: string | null;
} {
  return {
    callLegId: asOptionalString(payload.call_leg_id),
    callSessionId: asOptionalString(payload.call_session_id),
    connectionId: asOptionalString(payload.connection_id),
    fromNumber: asOptionalString(payload.from),
    toNumber: asOptionalString(payload.to),
    direction: asOptionalString(payload.direction),
    callerIdName: asOptionalString(payload.caller_id_name),
    telnyxState: asOptionalString(payload.state),
    startTime: asOptionalString(payload.start_time),
    hangupCause: asOptionalString(payload.hangup_cause),
    sipHangupCause: asOptionalString(payload.sip_hangup_cause),
    hangupSource: asOptionalString(payload.hangup_source),
  };
}

const TERMINAL_FAILURE_OUTCOMES = new Set<string>([
  "rejected_no_call",
  "rejected_disabled",
  "rate_limited",
  "busy",
  "pin_failed",
  "join_failed",
]);

/**
 * Upsert by call_control_id. Creates a row on first sight; later patches merge.
 * Duration is computed when endedAt is set and startedAt is known.
 */
export function upsertDialInCallLog(patch: UpsertDialInCallLogPatch): void {
  const callControlId = patch.callControlId.trim();
  if (!callControlId) return;

  const existing = drizzleDb
    .select({
      id: dialInCallLogs.id,
      startedAt: dialInCallLogs.startedAt,
      outcome: dialInCallLogs.outcome,
      answeredAt: dialInCallLogs.answeredAt,
      bridgedAt: dialInCallLogs.bridgedAt,
      endedAt: dialInCallLogs.endedAt,
    })
    .from(dialInCallLogs)
    .where(eq(dialInCallLogs.callControlId, callControlId))
    .limit(1)
    .get();

  const updatedAt = nowIso();
  const startedAt = patch.startedAt ?? existing?.startedAt ?? updatedAt;

  let outcome = patch.outcome ?? existing?.outcome ?? null;
  // Never downgrade a successful bridge or an earlier terminal failure.
  if (existing?.outcome === "bridged" && outcome && outcome !== "bridged") {
    outcome = "bridged";
  } else if (
    existing?.outcome &&
    TERMINAL_FAILURE_OUTCOMES.has(existing.outcome) &&
    outcome === "abandoned"
  ) {
    outcome = existing.outcome;
  }

  const answeredAt =
    patch.answeredAt !== undefined
      ? patch.answeredAt
      : (existing?.answeredAt ?? null);
  const bridgedAt =
    patch.bridgedAt !== undefined
      ? patch.bridgedAt
      : (existing?.bridgedAt ?? null);
  const endedAt =
    patch.endedAt !== undefined ? patch.endedAt : (existing?.endedAt ?? null);

  let durationMs =
    patch.durationMs !== undefined ? patch.durationMs : null;
  if (durationMs == null && endedAt) {
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(endedAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      durationMs = endMs - startMs;
    }
  }

  if (!existing) {
    drizzleDb
      .insert(dialInCallLogs)
      .values({
        id: nanoid(),
        callControlId,
        callLegId: patch.callLegId ?? null,
        callSessionId: patch.callSessionId ?? null,
        connectionId: patch.connectionId ?? null,
        fromNumber: patch.fromNumber ?? null,
        toNumber: patch.toNumber ?? null,
        direction: patch.direction ?? null,
        callerIdName: patch.callerIdName ?? null,
        telnyxState: patch.telnyxState ?? null,
        outcome,
        joinCode: patch.joinCode ?? null,
        sessionId: patch.sessionId ?? null,
        episodeId: patch.episodeId ?? null,
        podcastId: patch.podcastId ?? null,
        hangupCause: patch.hangupCause ?? null,
        sipHangupCause: patch.sipHangupCause ?? null,
        hangupSource: patch.hangupSource ?? null,
        startedAt,
        answeredAt,
        bridgedAt,
        endedAt,
        durationMs,
        pinAttempts: patch.pinAttempts ?? 0,
        rawInitiatedJson: patch.rawInitiatedJson ?? null,
        rawHangupJson: patch.rawHangupJson ?? null,
        createdAt: updatedAt,
        updatedAt,
      })
      .run();
  } else {
    const set: Record<string, unknown> = { updatedAt, outcome };
    if (patch.callLegId !== undefined) set.callLegId = patch.callLegId;
    if (patch.callSessionId !== undefined) set.callSessionId = patch.callSessionId;
    if (patch.connectionId !== undefined) set.connectionId = patch.connectionId;
    if (patch.fromNumber !== undefined) set.fromNumber = patch.fromNumber;
    if (patch.toNumber !== undefined) set.toNumber = patch.toNumber;
    if (patch.direction !== undefined) set.direction = patch.direction;
    if (patch.callerIdName !== undefined) set.callerIdName = patch.callerIdName;
    if (patch.telnyxState !== undefined) set.telnyxState = patch.telnyxState;
    if (patch.joinCode !== undefined) set.joinCode = patch.joinCode;
    if (patch.sessionId !== undefined) set.sessionId = patch.sessionId;
    if (patch.episodeId !== undefined) set.episodeId = patch.episodeId;
    if (patch.podcastId !== undefined) set.podcastId = patch.podcastId;
    if (patch.hangupCause !== undefined) set.hangupCause = patch.hangupCause;
    if (patch.sipHangupCause !== undefined) set.sipHangupCause = patch.sipHangupCause;
    if (patch.hangupSource !== undefined) set.hangupSource = patch.hangupSource;
    if (patch.answeredAt !== undefined) set.answeredAt = patch.answeredAt;
    if (patch.bridgedAt !== undefined) set.bridgedAt = patch.bridgedAt;
    if (patch.endedAt !== undefined) set.endedAt = patch.endedAt;
    if (durationMs != null) set.durationMs = durationMs;
    if (patch.pinAttempts !== undefined) set.pinAttempts = patch.pinAttempts;
    if (patch.rawInitiatedJson !== undefined) {
      set.rawInitiatedJson = patch.rawInitiatedJson;
    }
    if (patch.rawHangupJson !== undefined) set.rawHangupJson = patch.rawHangupJson;

    drizzleDb
      .update(dialInCallLogs)
      .set(set)
      .where(eq(dialInCallLogs.callControlId, callControlId))
      .run();
  }

  try {
    pruneOldLogs();
  } catch {
    /* non-fatal */
  }
}

export function listDialInCallLogs(limit = 10): DialInCallLogRow[] {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 10));
  return drizzleDb
    .select({
      id: dialInCallLogs.id,
      callControlId: dialInCallLogs.callControlId,
      callLegId: dialInCallLogs.callLegId,
      callSessionId: dialInCallLogs.callSessionId,
      connectionId: dialInCallLogs.connectionId,
      fromNumber: dialInCallLogs.fromNumber,
      toNumber: dialInCallLogs.toNumber,
      direction: dialInCallLogs.direction,
      callerIdName: dialInCallLogs.callerIdName,
      telnyxState: dialInCallLogs.telnyxState,
      outcome: dialInCallLogs.outcome,
      joinCode: dialInCallLogs.joinCode,
      sessionId: dialInCallLogs.sessionId,
      episodeId: dialInCallLogs.episodeId,
      podcastId: dialInCallLogs.podcastId,
      hangupCause: dialInCallLogs.hangupCause,
      sipHangupCause: dialInCallLogs.sipHangupCause,
      hangupSource: dialInCallLogs.hangupSource,
      startedAt: dialInCallLogs.startedAt,
      answeredAt: dialInCallLogs.answeredAt,
      bridgedAt: dialInCallLogs.bridgedAt,
      endedAt: dialInCallLogs.endedAt,
      durationMs: dialInCallLogs.durationMs,
      pinAttempts: dialInCallLogs.pinAttempts,
      rawInitiatedJson: dialInCallLogs.rawInitiatedJson,
      rawHangupJson: dialInCallLogs.rawHangupJson,
      createdAt: dialInCallLogs.createdAt,
      updatedAt: dialInCallLogs.updatedAt,
    })
    .from(dialInCallLogs)
    .orderBy(desc(dialInCallLogs.createdAt))
    .limit(safeLimit)
    .all()
    .map((r) => ({
      ...r,
      durationMs: r.durationMs == null ? null : Number(r.durationMs) || 0,
      pinAttempts: Number(r.pinAttempts) || 0,
    }));
}
