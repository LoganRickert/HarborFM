import { APP_NAME, DIAL_IN_FAKE } from "../../../config.js";
import { readSettings } from "../../settings/repo.js";
import type { AppSettings } from "../../settings/utils.js";

const DEFAULT_CONSENT = `This call may be recorded. Stay on the line to join ${APP_NAME}.`;

export type DialInPublicConfig = {
  enabled: boolean;
  phoneNumber: string;
  consentPrompt: string;
  /** True when FakeDialIn admissions are allowed (env + product enabled). */
  fakeAdmissionsAllowed: boolean;
};

export function getDialInConsentPrompt(settings?: AppSettings): string {
  const s = settings ?? readSettings();
  const custom = (s.dial_in_consent_prompt ?? "").trim();
  return custom || DEFAULT_CONSENT;
}

/** Product dial-in is on when enabled in settings and a phone number is set. */
export function isDialInProductEnabled(settings?: AppSettings): boolean {
  const s = settings ?? readSettings();
  return Boolean(s.dial_in_enabled) && Boolean((s.dial_in_phone_number ?? "").trim());
}

export function getDialInPublicConfig(settings?: AppSettings): DialInPublicConfig {
  const s = settings ?? readSettings();
  const enabled = isDialInProductEnabled(s);
  const phoneNumber = enabled ? (s.dial_in_phone_number ?? "").trim() : "";
  return {
    enabled,
    phoneNumber,
    consentPrompt: getDialInConsentPrompt(s),
    fakeAdmissionsAllowed: enabled && DIAL_IN_FAKE,
  };
}

/**
 * Preferred Telnyx bidirectional stream codec/rate for live dial-in media.
 * HD mode requests L16 @ 16 kHz; otherwise PCMU @ 8 kHz.
 * The webrtc bridge still adapts to whatever Telnyx reports in start.media_format.
 */
export function getDialInStreamingPrefs(settings?: AppSettings): {
  streamBidirectionalCodec: "L16" | "PCMU";
  streamBidirectionalSamplingRate: 8000 | 16000;
} {
  const s = settings ?? readSettings();
  if (s.dial_in_hd_voice) {
    return {
      streamBidirectionalCodec: "L16",
      streamBidirectionalSamplingRate: 16000,
    };
  }
  return {
    streamBidirectionalCodec: "PCMU",
    streamBidirectionalSamplingRate: 8000,
  };
}

/** True when a non-placeholder Telnyx API key is saved in Settings. */
export function hasTelnyxApiKey(settings?: AppSettings): boolean {
  const s = settings ?? readSettings();
  const key = (s.telnyx_api_key ?? "").trim();
  return Boolean(key) && key !== "(set)";
}

/** True when inbound Telnyx webhooks should be accepted. */
export function isDialInWebhookEnabled(settings?: AppSettings): boolean {
  const s = settings ?? readSettings();
  if (!isDialInProductEnabled(s)) return false;
  if (DIAL_IN_FAKE) return true;
  return hasTelnyxApiKey(s);
}

/** Gate FakeDialIn join / IVR admit. Requires product enable + DIAL_IN_FAKE. */
export function assertFakeDialInAllowed():
  | { ok: true }
  | { ok: false; status: number; error: string } {
  if (!DIAL_IN_FAKE) {
    return { ok: false, status: 404, error: "Fake dial-in disabled" };
  }
  if (!isDialInProductEnabled()) {
    return {
      ok: false,
      status: 403,
      error: "Phone dial-in is disabled. Enable it in Settings, WebRTC.",
    };
  }
  return { ok: true };
}
