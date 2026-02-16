import { readSettings } from "../modules/settings/index.js";

/** WebRTC config. Env vars override settings. */
export function getWebRtcConfig(): {
  serviceUrl: string | null;
  publicWsUrl: string | null;
  recordingCallbackSecret: string | null;
  webrtcServiceSecret: string | null;
} {
  const settings = readSettings();
  const envService = process.env.WEBRTC_SERVICE_URL?.trim();
  const envPublic = process.env.WEBRTC_PUBLIC_WS_URL?.trim();
  const envSecret = process.env.RECORDING_CALLBACK_SECRET?.trim();
  const envServiceSecret = process.env.WEBRTC_SERVICE_SECRET?.trim();

  return {
    serviceUrl: envService || (settings.webrtc_service_url ?? "").trim() || null,
    publicWsUrl: envPublic || (settings.webrtc_public_ws_url ?? "").trim() || null,
    recordingCallbackSecret: envSecret || (settings.recording_callback_secret ?? "").trim() || null,
    webrtcServiceSecret: envServiceSecret || null,
  };
}

/** Headers for HTTP requests from main app to webrtc service. Includes X-WebRTC-Service-Secret when configured. */
export function webrtcRequestHeaders(cfg: ReturnType<typeof getWebRtcConfig>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.webrtcServiceSecret) {
    headers["X-WebRTC-Service-Secret"] = cfg.webrtcServiceSecret;
  }
  return headers;
}
