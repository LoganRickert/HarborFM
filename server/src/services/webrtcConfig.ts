import { readSettings } from "../modules/settings/index.js";

/** WebRTC config. Env vars override settings. */
export function getWebRtcConfig(): {
  serviceUrl: string | null;
  publicWsUrl: string | null;
  recordingCallbackSecret: string | null;
} {
  const settings = readSettings();
  const envService = process.env.WEBRTC_SERVICE_URL?.trim();
  const envPublic = process.env.WEBRTC_PUBLIC_WS_URL?.trim();
  const envSecret = process.env.RECORDING_CALLBACK_SECRET?.trim();

  return {
    serviceUrl: envService || (settings.webrtc_service_url ?? "").trim() || null,
    publicWsUrl: envPublic || (settings.webrtc_public_ws_url ?? "").trim() || null,
    recordingCallbackSecret: envSecret || (settings.recording_callback_secret ?? "").trim() || null,
  };
}
