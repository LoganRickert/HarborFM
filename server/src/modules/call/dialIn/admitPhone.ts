import { nanoid } from "nanoid";
import { DIAL_IN_FAKE } from "../../../config.js";
import {
  addParticipant,
  getSessionByCode,
  getSessionById,
  removeParticipant,
  type CallSession,
} from "../../../services/callSession.js";
import { getWebRtcConfig, webrtcRequestHeaders } from "../../../services/webrtcConfig.js";
import { broadcastToSession } from "../shared.js";
import { getFakeCallControl } from "./callControl.js";
import {
  assertFakeDialInAllowed,
  getDialInConsentPrompt,
  hasTelnyxApiKey,
  isDialInProductEnabled,
} from "./config.js";
import {
  buildDialInMediaStreamUrl,
  mintDialInMediaToken,
} from "./mediaToken.js";

export async function leaveWebrtcFakeDialIn(opts: {
  roomId?: string;
  dialInId?: string;
  participantId?: string;
  allInRoom?: boolean;
}): Promise<void> {
  const webrtcCfg = getWebRtcConfig();
  if (!webrtcCfg.serviceUrl) return;
  try {
    await fetch(`${webrtcCfg.serviceUrl.replace(/\/$/, "")}/dial-in/fake/leave`, {
      method: "POST",
      headers: webrtcRequestHeaders(webrtcCfg),
      body: JSON.stringify(opts),
    });
  } catch (err) {
    console.warn("[dial-in] webrtc fake leave failed:", err);
  }
}

export async function leaveWebrtcLiveDialIn(opts: {
  roomId?: string;
  dialInId?: string;
  participantId?: string;
  allInRoom?: boolean;
}): Promise<void> {
  const webrtcCfg = getWebRtcConfig();
  if (!webrtcCfg.serviceUrl) return;
  try {
    await fetch(`${webrtcCfg.serviceUrl.replace(/\/$/, "")}/dial-in/live/leave`, {
      method: "POST",
      headers: webrtcRequestHeaders(webrtcCfg),
      body: JSON.stringify(opts),
    });
  } catch (err) {
    console.warn("[dial-in] webrtc live leave failed:", err);
  }
}

/** Tear down fake and/or live phone media for a participant or room. */
export async function leaveWebrtcDialIn(opts: {
  roomId?: string;
  dialInId?: string;
  participantId?: string;
  allInRoom?: boolean;
}): Promise<void> {
  await Promise.all([leaveWebrtcFakeDialIn(opts), leaveWebrtcLiveDialIn(opts)]);
}

export async function muteWebrtcFakeDialIn(
  participantId: string,
  muted: boolean,
): Promise<boolean> {
  const webrtcCfg = getWebRtcConfig();
  if (!webrtcCfg.serviceUrl || !DIAL_IN_FAKE) return false;
  try {
    const res = await fetch(
      `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/dial-in/fake/mute`,
      {
        method: "POST",
        headers: webrtcRequestHeaders(webrtcCfg),
        body: JSON.stringify({ participantId, muted }),
      },
    );
    return res.ok;
  } catch (err) {
    console.warn("[dial-in] webrtc fake mute failed:", err);
    return false;
  }
}

export async function muteWebrtcLiveDialIn(
  participantId: string,
  muted: boolean,
): Promise<boolean> {
  const webrtcCfg = getWebRtcConfig();
  if (!webrtcCfg.serviceUrl) return false;
  try {
    const res = await fetch(
      `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/dial-in/live/mute`,
      {
        method: "POST",
        headers: webrtcRequestHeaders(webrtcCfg),
        body: JSON.stringify({ participantId, muted }),
      },
    );
    return res.ok;
  } catch (err) {
    console.warn("[dial-in] webrtc live mute failed:", err);
    return false;
  }
}

export async function muteWebrtcDialIn(
  participantId: string,
  muted: boolean,
): Promise<boolean> {
  const live = await muteWebrtcLiveDialIn(participantId, muted);
  if (live) return true;
  return muteWebrtcFakeDialIn(participantId, muted);
}

export type AdmitPhoneResult =
  | {
      ok: true;
      participantId: string;
      dialInId: string;
      producerId: string;
      sessionId: string;
      roomId: string;
      displayName: string;
      /** Present when live Telnyx media bridge should start. */
      mediaStreamUrl?: string;
    }
  | { ok: false; status: number; error: string };

export type AdmitPhoneOpts = {
  joinCode: string;
  displayName?: string;
  toneHz?: number;
  /** When true, caller already logged consent (IVR). */
  skipConsentLog?: boolean;
  /** Telnyx call_control_id for live media token. */
  callControlId?: string;
  /**
   * Media path: fake = FakeDialIn tone; live = roster + Telnyx WSS token;
   * auto = live when Telnyx API key is set, else fake.
   */
  mediaMode?: "auto" | "fake" | "live";
};

function resolveMediaMode(
  requested: AdmitPhoneOpts["mediaMode"],
): "fake" | "live" {
  if (requested === "fake" || requested === "live") return requested;
  return hasTelnyxApiKey() ? "live" : "fake";
}

/** Admit a phone participant into a live call by join code. */
export async function admitPhoneByJoinCode(
  opts: AdmitPhoneOpts,
): Promise<AdmitPhoneResult> {
  const mode = resolveMediaMode(opts.mediaMode);
  if (mode === "fake") {
    const gate = assertFakeDialInAllowed();
    if (!gate.ok) {
      return { ok: false, status: gate.status, error: gate.error };
    }
  } else if (!isDialInProductEnabled()) {
    return {
      ok: false,
      status: 403,
      error: "Phone dial-in is disabled. Enable it in Settings → WebRTC.",
    };
  }
  const joinCode = typeof opts.joinCode === "string" ? opts.joinCode.trim() : "";
  const session = getSessionByCode(joinCode);
  if (!session) {
    return { ok: false, status: 404, error: "No active call for that code" };
  }
  if (mode === "live") {
    return admitPhoneLiveToSession(session, opts);
  }
  return admitPhoneFakeToSession(session, opts);
}

async function admitPhoneFakeToSession(
  session: CallSession,
  opts: { displayName?: string; toneHz?: number; skipConsentLog?: boolean },
): Promise<AdmitPhoneResult> {
  if (!session.roomId) {
    return { ok: false, status: 503, error: "Call has no media room" };
  }
  const webrtcCfg = getWebRtcConfig();
  if (!webrtcCfg.serviceUrl) {
    return { ok: false, status: 503, error: "WebRTC service not configured" };
  }

  const participantId = nanoid();
  const displayName =
    (typeof opts.displayName === "string" && opts.displayName.trim()) ||
    `Phone ${participantId.slice(0, 4)}`;
  const p = addParticipant(session.sessionId, participantId, displayName, {
    source: "phone",
  });
  if (!p) {
    return { ok: false, status: 409, error: "Could not add participant" };
  }

  try {
    const res = await fetch(
      `${webrtcCfg.serviceUrl.replace(/\/$/, "")}/dial-in/fake/join`,
      {
        method: "POST",
        headers: webrtcRequestHeaders(webrtcCfg),
        body: JSON.stringify({
          roomId: session.roomId,
          participantId,
          participantName: displayName,
          toneHz: typeof opts.toneHz === "number" ? opts.toneHz : undefined,
        }),
      },
    );
    if (!res.ok) {
      removeParticipant(session.sessionId, participantId);
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        status: res.status,
        error: errBody.error || "Fake dial-in media join failed",
      };
    }
    const media = (await res.json()) as { dialInId: string; producerId: string };
    if (!opts.skipConsentLog) {
      await getFakeCallControl().consentPrompt(`fake:${participantId}`, {
        payload: getDialInConsentPrompt(),
      });
    }
    broadcastToSession(session.sessionId, {
      type: "participantJoined",
      participant: p,
    });
    broadcastToSession(session.sessionId, {
      type: "participants",
      participants: [...(getSessionById(session.sessionId)?.participants ?? [])],
    });
    return {
      ok: true,
      participantId,
      dialInId: media.dialInId,
      producerId: media.producerId,
      sessionId: session.sessionId,
      roomId: session.roomId,
      displayName,
    };
  } catch {
    removeParticipant(session.sessionId, participantId);
    return { ok: false, status: 502, error: "Fake dial-in join failed" };
  }
}

/**
 * Roster-only admit for live Telnyx. Media producer is created when Telnyx
 * opens the bidirectional media WebSocket on webrtc-service.
 */
export async function admitPhoneLiveToSession(
  session: CallSession,
  opts: {
    displayName?: string;
    skipConsentLog?: boolean;
    callControlId?: string;
  },
): Promise<AdmitPhoneResult> {
  if (!session.roomId) {
    return { ok: false, status: 503, error: "Call has no media room" };
  }
  const webrtcCfg = getWebRtcConfig();
  const publicWs = (webrtcCfg.publicWsUrl ?? "").trim();
  if (!publicWs) {
    return {
      ok: false,
      status: 503,
      error:
        "WebRTC public WebSocket URL is not configured (needed for Telnyx media streaming)",
    };
  }
  const callControlId =
    typeof opts.callControlId === "string" ? opts.callControlId.trim() : "";
  if (!callControlId) {
    return { ok: false, status: 400, error: "callControlId is required for live dial-in" };
  }

  const participantId = nanoid();
  const dialInId = nanoid(12);
  const displayName =
    (typeof opts.displayName === "string" && opts.displayName.trim()) ||
    `Phone ${participantId.slice(0, 4)}`;
  const p = addParticipant(session.sessionId, participantId, displayName, {
    source: "phone",
  });
  if (!p) {
    return { ok: false, status: 409, error: "Could not add participant" };
  }

  const token = mintDialInMediaToken({
    roomId: session.roomId,
    participantId,
    participantName: displayName,
    sessionId: session.sessionId,
    callControlId,
    dialInId,
  });
  if (!token) {
    removeParticipant(session.sessionId, participantId);
    return {
      ok: false,
      status: 503,
      error: "WEBRTC_SERVICE_SECRET is required to mint dial-in media tokens",
    };
  }

  if (!opts.skipConsentLog) {
    await getFakeCallControl().consentPrompt(`live:${participantId}`, {
      payload: getDialInConsentPrompt(),
    });
  }

  broadcastToSession(session.sessionId, {
    type: "participantJoined",
    participant: p,
  });
  broadcastToSession(session.sessionId, {
    type: "participants",
    participants: [...(getSessionById(session.sessionId)?.participants ?? [])],
  });

  return {
    ok: true,
    participantId,
    dialInId,
    producerId: "",
    sessionId: session.sessionId,
    roomId: session.roomId,
    displayName,
    mediaStreamUrl: buildDialInMediaStreamUrl(publicWs, token),
  };
}

/** @deprecated Prefer admitPhoneFakeToSession via admitPhoneByJoinCode */
export async function admitPhoneToSession(
  session: CallSession,
  opts: { displayName?: string; toneHz?: number; skipConsentLog?: boolean },
): Promise<AdmitPhoneResult> {
  return admitPhoneFakeToSession(session, opts);
}

export function phoneDisplayNameFromCaller(from: string | undefined): string {
  const digits = (from ?? "").replace(/\D/g, "");
  if (digits.length >= 4) return `Phone ...${digits.slice(-4)}`;
  if (from?.trim()) return `Phone ${from.trim()}`;
  return `Phone ${nanoid(4)}`;
}
