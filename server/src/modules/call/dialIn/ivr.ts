import { APP_NAME, DIAL_IN_IVR_NAME } from "../../../config.js";
import {
  getActiveSessionCount,
  getSessionByCode,
  getSessionById,
  removeParticipant,
} from "../../../services/callSession.js";
import { broadcastToSession } from "../shared.js";
import { getPodcastForJoinInfo } from "../repo.js";
import {
  getCallControlClient,
  getFakeCallControl,
  type CallControlClient,
} from "./callControl.js";
import {
  admitPhoneByJoinCode,
  leaveWebrtcDialIn,
  phoneDisplayNameFromCaller,
} from "./admitPhone.js";
import {
  getDialInConsentPrompt,
  getDialInStreamingPrefs,
  hasTelnyxApiKey,
  isDialInProductEnabled,
} from "./config.js";
import {
  isConcurrentDialInLimited,
  isInboundRateLimited,
  isPinRateLimited,
  recordInboundAttempt,
  recordPinFailure,
  resetPinRateLimit,
} from "./pinRateLimit.js";

/** Max wrong PIN attempts before hangup. */
export const DIAL_IN_MAX_PIN_ATTEMPTS = 3;

const PROMPT_INVALID =
  "That code was not recognized. Please enter the four-digit call code again.";
const PROMPT_NO_CALL =
  "There is no active call for that code. Please try again later.";
const PROMPT_JOIN_FAILED =
  "We found that call, but could not connect your phone. Please try again.";
const PROMPT_TOO_MANY = "Too many incorrect attempts. Goodbye.";
const PROMPT_DISABLED =
  "Phone dial-in is not available right now. Goodbye.";
const PROMPT_RATE_LIMITED =
  "Too many attempts from this number. Please try again later. Goodbye.";
const PROMPT_BUSY =
  "All dial-in lines are busy. Please try again later. Goodbye.";

/** Keep TTS payloads short and free of characters that confuse speak engines. */
function sanitizeForTts(name: string): string {
  return name
    .replace(/[<>{}[\]\\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Spoken brand for "Welcome to ..." (DIAL_IN_IVR_NAME, default APP_NAME). */
export function getDialInIvrName(): string {
  return sanitizeForTts(DIAL_IN_IVR_NAME) || `${APP_NAME} Podcasting`;
}

/** Opening gather prompt (instance DID is shared across shows). */
export function getEnterCodePrompt(): string {
  return `Welcome to ${getDialInIvrName()}. Please enter the four-digit call code.`;
}

/** Spoken after a valid join code, naming the show when known. */
export function getJoiningPrompt(podcastId: string | undefined): string {
  if (podcastId) {
    const podcast = getPodcastForJoinInfo(podcastId);
    const title = podcast?.title?.trim();
    if (title) {
      return `Connecting you to ${sanitizeForTts(title)}.`;
    }
  }
  return "Connecting you to the call.";
}

export type DialInLegStatus =
  | "initiated"
  | "gathering"
  | "bridging"
  | "awaiting_speak_end"
  | "awaiting_hangup"
  | "bridged"
  | "ended";

export type DialInLeg = {
  callControlId: string;
  from: string;
  to: string;
  pinAttempts: number;
  status: DialInLegStatus;
  participantId?: string;
  dialInId?: string;
  sessionId?: string;
  displayName?: string;
  mediaMode?: "fake" | "live";
  /** Set after admit; streaming starts on call.speak.ended so IVR TTS is not bridged. */
  pendingStreamUrl?: string;
};

export type TelnyxWebhookEnvelope = {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    record_type?: string;
    payload?: Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
};

const legsByCallControlId = new Map<string, DialInLeg>();

export function getDialInLeg(callControlId: string): DialInLeg | undefined {
  return legsByCallControlId.get(callControlId);
}

export function listDialInLegs(): DialInLeg[] {
  return [...legsByCallControlId.values()];
}

export function resetDialInIvrState(): void {
  legsByCallControlId.clear();
  getFakeCallControl().clear();
  resetPinRateLimit();
}

function ensureLeg(
  callControlId: string,
  from: string,
  to: string,
): DialInLeg {
  let leg = legsByCallControlId.get(callControlId);
  if (!leg) {
    leg = {
      callControlId,
      from,
      to,
      pinAttempts: 0,
      status: "initiated",
    };
    legsByCallControlId.set(callControlId, leg);
  }
  return leg;
}

async function startGather(
  cc: CallControlClient,
  callControlId: string,
  prompt: string,
): Promise<void> {
  await cc.gatherUsingSpeak(callControlId, {
    payload: prompt,
    minimumDigits: 4,
    maximumDigits: 4,
    timeoutMillis: 15_000,
    validDigits: "0123456789",
  });
}

async function finishHangup(
  cc: CallControlClient,
  leg: DialInLeg,
): Promise<void> {
  if (leg.status === "ended") return;
  try {
    await cc.hangup(leg.callControlId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Caller may have already hung up while TTS was playing.
    if (!/already ended|no longer active/i.test(msg)) {
      throw err;
    }
  }
  leg.status = "ended";
}

/**
 * Speak a goodbye then hang up after TTS finishes (call.speak.ended).
 * Fake Call Control never emits speak.ended, so hang up immediately when not live.
 */
async function speakAndHangup(
  cc: CallControlClient,
  leg: DialInLeg,
  prompt: string,
): Promise<void> {
  await cc.speak(leg.callControlId, { payload: prompt });
  if (!hasTelnyxApiKey()) {
    await finishHangup(cc, leg);
    return;
  }
  leg.status = "awaiting_hangup";
  const speakCallId = leg.callControlId;
  setTimeout(() => {
    const pending = legsByCallControlId.get(speakCallId);
    if (pending && pending.status === "awaiting_hangup") {
      void finishHangup(cc, pending).catch((err) => {
        console.warn("[dial-in] delayed hangup after speak failed:", err);
      });
    }
  }, 45_000);
}

/**
 * After answer: rate limits or start PIN gather.
 * No-active-call is handled on call.initiated via reject (before answer).
 */
async function afterAnswerStartIvr(
  cc: CallControlClient,
  leg: DialInLeg,
): Promise<void> {
  if (!isDialInProductEnabled()) {
    await speakAndHangup(cc, leg, PROMPT_DISABLED);
    return;
  }
  if (isPinRateLimited(leg.from) || isInboundRateLimited(leg.from)) {
    await speakAndHangup(cc, leg, PROMPT_RATE_LIMITED);
    return;
  }
  if (isConcurrentDialInLimited(leg.from, listDialInLegs())) {
    await speakAndHangup(cc, leg, PROMPT_BUSY);
    return;
  }
  // Count this answered inbound toward the per-caller inbound cap.
  if (recordInboundAttempt(leg.from)) {
    await speakAndHangup(cc, leg, PROMPT_RATE_LIMITED);
    return;
  }
  // Race: session ended between initiated check and answer.
  if (getActiveSessionCount() === 0) {
    await finishHangup(cc, leg);
    return;
  }
  leg.status = "gathering";
  await startGather(cc, leg.callControlId, getEnterCodePrompt());
}

async function rejectPinAndMaybeHangup(
  cc: CallControlClient,
  leg: DialInLeg,
  prompt: string,
): Promise<void> {
  const rateLimited = recordPinFailure(leg.from);
  leg.pinAttempts += 1;
  if (rateLimited || leg.pinAttempts >= DIAL_IN_MAX_PIN_ATTEMPTS) {
    await speakAndHangup(
      cc,
      leg,
      rateLimited ? PROMPT_RATE_LIMITED : PROMPT_TOO_MANY,
    );
    return;
  }
  leg.status = "gathering";
  await startGather(cc, leg.callControlId, prompt);
}

async function leaveWebrtcForLeg(leg: DialInLeg): Promise<void> {
  if (!leg.participantId && !leg.dialInId) return;
  await leaveWebrtcDialIn({
    participantId: leg.participantId,
    dialInId: leg.dialInId,
  });
  if (leg.sessionId && leg.participantId) {
    removeParticipant(leg.sessionId, leg.participantId);
    const session = getSessionById(leg.sessionId);
    if (session) {
      broadcastToSession(leg.sessionId, {
        type: "participants",
        participants: [...session.participants],
      });
    }
  }
}

/** Hang up all active IVR legs (group call end). Issues Call Control hangup + tears down media. */
export async function hangUpAllDialInLegs(): Promise<void> {
  const cc = getCallControlClient();
  for (const leg of legsByCallControlId.values()) {
    if (leg.status === "ended") continue;
    if (
      leg.status === "bridged" ||
      leg.status === "bridging" ||
      leg.status === "awaiting_speak_end"
    ) {
      await leaveWebrtcForLeg(leg);
    }
    await cc.hangup(leg.callControlId);
    leg.status = "ended";
  }
}

async function startPendingLiveStream(leg: DialInLeg): Promise<void> {
  const url = leg.pendingStreamUrl;
  if (!url) return;
  leg.pendingStreamUrl = undefined;
  const cc = getCallControlClient();
  const streamPrefs = getDialInStreamingPrefs();
  await cc.streamingStart(leg.callControlId, {
    streamUrl: url,
    streamTrack: "inbound_track",
    streamBidirectionalMode: "rtp",
    streamBidirectionalCodec: streamPrefs.streamBidirectionalCodec,
    streamBidirectionalSamplingRate: streamPrefs.streamBidirectionalSamplingRate,
  });
  leg.status = "bridged";
}

/** Hang up a live/fake dial-in leg by participant id (host kick). */
export async function hangUpDialInLegByParticipant(
  participantId: string,
): Promise<boolean> {
  const cc = getCallControlClient();
  let found = false;
  for (const leg of legsByCallControlId.values()) {
    if (leg.participantId !== participantId || leg.status === "ended") continue;
    found = true;
    await leaveWebrtcForLeg(leg);
    await cc.hangup(leg.callControlId);
    leg.status = "ended";
  }
  return found;
}

/**
 * Handle a Telnyx-shaped Call Control webhook.
 * Live Telnyx: roster admit + bidirectional media stream to webrtc.
 * Fake (e2e / no API key): FakeDialIn tone + placeholder streaming_start.
 */
export async function handleDialInWebhook(
  body: TelnyxWebhookEnvelope,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const eventType = body.data?.event_type;
  const payload = body.data?.payload ?? {};
  const callControlId =
    typeof payload.call_control_id === "string"
      ? payload.call_control_id.trim()
      : "";
  if (!eventType || !callControlId) {
    return { ok: false, error: "Missing event_type or call_control_id" };
  }

  const from = typeof payload.from === "string" ? payload.from : "";
  const to = typeof payload.to === "string" ? payload.to : "";
  const cc = getCallControlClient();
  const leg = ensureLeg(callControlId, from, to);

  if (eventType === "call.initiated") {
    if (leg.status === "ended" || leg.status === "bridged") {
      return { ok: true };
    }
    // Reject before answer when nothing is live: answered welcome TTS is billable.
    if (getActiveSessionCount() === 0) {
      await cc.reject(callControlId, { cause: "CALL_REJECTED" });
      leg.status = "ended";
      return { ok: true };
    }
    await cc.answer(callControlId);
    await afterAnswerStartIvr(cc, leg);
    return { ok: true };
  }

  if (eventType === "call.answered") {
    if (leg.status === "initiated") {
      await afterAnswerStartIvr(cc, leg);
    }
    return { ok: true };
  }

  if (eventType === "call.gather.ended") {
    if (leg.status === "ended" || leg.status === "bridged") {
      return { ok: true };
    }
    if (!isDialInProductEnabled()) {
      await speakAndHangup(cc, leg, PROMPT_DISABLED);
      return { ok: true };
    }
    const digits =
      typeof payload.digits === "string" ? payload.digits.replace(/\D/g, "") : "";
    const gatherStatus =
      typeof payload.status === "string" ? payload.status : "valid";

    if (gatherStatus === "timeout" || digits.length !== 4) {
      await rejectPinAndMaybeHangup(cc, leg, PROMPT_INVALID);
      return { ok: true };
    }

    const session = getSessionByCode(digits);
    if (!session) {
      await rejectPinAndMaybeHangup(cc, leg, PROMPT_NO_CALL);
      return { ok: true };
    }

    leg.status = "bridging";
    const consent = getDialInConsentPrompt();
    const displayName = phoneDisplayNameFromCaller(leg.from);
    const mediaMode = hasTelnyxApiKey() ? "live" : "fake";
    const admitted = await admitPhoneByJoinCode({
      joinCode: digits,
      displayName,
      skipConsentLog: true,
      callControlId,
      mediaMode,
    });
    if (!admitted.ok) {
      await rejectPinAndMaybeHangup(cc, leg, PROMPT_JOIN_FAILED);
      return { ok: true };
    }

    leg.participantId = admitted.participantId;
    leg.dialInId = admitted.dialInId;
    leg.sessionId = admitted.sessionId;
    leg.displayName = admitted.displayName;
    leg.mediaMode = mediaMode;

    const joining = getJoiningPrompt(session.podcastId);
    try {
      if (mediaMode === "live" && admitted.mediaStreamUrl) {
        // Single Telnyx speak, then wait for speak.ended before media so IVR TTS
        // is not acoustically picked up and bridged into the room.
        await cc.speak(callControlId, {
          payload: `${consent} ${joining}`,
        });
        leg.pendingStreamUrl = admitted.mediaStreamUrl;
        leg.status = "awaiting_speak_end";
        const speakCallId = callControlId;
        setTimeout(() => {
          const pending = legsByCallControlId.get(speakCallId);
          if (
            pending &&
            pending.status === "awaiting_speak_end" &&
            pending.pendingStreamUrl
          ) {
            void startPendingLiveStream(pending).catch((err) => {
              console.warn("[dial-in] delayed streaming_start failed:", err);
              void leaveWebrtcForLeg(pending).then(() => {
                pending.participantId = undefined;
                pending.dialInId = undefined;
                pending.sessionId = undefined;
                pending.displayName = undefined;
                pending.pendingStreamUrl = undefined;
              });
            });
          }
        }, 20_000);
      } else {
        await cc.consentPrompt(callControlId, { payload: consent });
        await cc.speak(callControlId, { payload: joining });
        await cc.streamingStart(callControlId, {
          streamTrack: "both_tracks",
          streamUrl: "wss://fake.local/dial-in/media",
        });
        leg.status = "bridged";
      }
    } catch (err) {
      console.warn("[dial-in] post-admit Call Control failed; rolling back roster:", err);
      await leaveWebrtcForLeg(leg);
      leg.participantId = undefined;
      leg.dialInId = undefined;
      leg.sessionId = undefined;
      leg.displayName = undefined;
      leg.pendingStreamUrl = undefined;
      await speakAndHangup(cc, leg, PROMPT_JOIN_FAILED);
    }
    return { ok: true };
  }

  if (eventType === "call.speak.ended") {
    if (leg.status === "awaiting_hangup") {
      await finishHangup(cc, leg);
      return { ok: true };
    }
    if (leg.status === "awaiting_speak_end" && leg.pendingStreamUrl) {
      try {
        await startPendingLiveStream(leg);
      } catch (err) {
        console.warn("[dial-in] streaming_start after speak.ended failed:", err);
        await leaveWebrtcForLeg(leg);
        leg.participantId = undefined;
        leg.dialInId = undefined;
        leg.sessionId = undefined;
        leg.displayName = undefined;
        leg.pendingStreamUrl = undefined;
        await speakAndHangup(cc, leg, PROMPT_JOIN_FAILED);
      }
    }
    return { ok: true };
  }

  if (eventType === "call.hangup") {
    if (
      leg.status === "bridged" ||
      leg.status === "bridging" ||
      leg.status === "awaiting_speak_end"
    ) {
      await leaveWebrtcForLeg(leg);
    }
    leg.status = "ended";
    return { ok: true };
  }

  return { ok: true };
}
