import {
  RECORDING_CALLBACK_SECRET,
  WEBRTC_PUBLIC_WS_URL,
  WEBRTC_SERVICE_SECRET,
  WEBRTC_SERVICE_URL,
} from "../config.js";
import { normalizeHostname } from "../utils/url.js";
import { readSettings } from "../modules/settings/index.js";

/** Extract hostname (lowercase) from an http(s)/ws(s) URL or bare host. */
export function urlHostname(input: string): string | null {
  const raw = normalizeHostname(input);
  if (!raw) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Build the default public WebSocket URL for group calls from the app hostname
 * (e.g. https://app.example.com > wss://app.example.com/webrtc-ws).
 */
export function publicWsUrlFromHostname(hostname: string): string | null {
  const raw = normalizeHostname(hostname);
  if (!raw) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    if (!u.hostname) return null;
    const wsProtocol = u.protocol === "http:" ? "ws:" : "wss:";
    return `${wsProtocol}//${u.host}/webrtc-ws`;
  } catch {
    return null;
  }
}

/**
 * When the app hostname changes, rewrite the public WebSocket URL if it still
 * pointed at the previous hostname (or was empty). Leaves custom WS hosts alone.
 */
export function syncPublicWsUrlForHostnameChange(
  previousHostname: string,
  nextHostname: string,
  currentPublicWsUrl: string,
): string {
  const next = normalizeHostname(nextHostname);
  const prev = normalizeHostname(previousHostname);
  if (!next || next === prev) return currentPublicWsUrl;

  const derived = publicWsUrlFromHostname(next);
  if (!derived) return currentPublicWsUrl;

  const ws = currentPublicWsUrl.trim();
  if (!ws) return derived;

  const oldHost = urlHostname(prev);
  const wsHost = urlHostname(ws);
  if (oldHost && wsHost && wsHost === oldHost) return derived;

  return currentPublicWsUrl;
}

/**
 * WebRTC config. Non-empty Settings values win over env (so the Settings UI takes
 * effect). Env is used when the corresponding setting is empty (initial seed / Docker).
 */
export function getWebRtcConfig(): {
  serviceUrl: string | null;
  publicWsUrl: string | null;
  recordingCallbackSecret: string | null;
  webrtcServiceSecret: string | null;
} {
  const settings = readSettings();
  const envService = WEBRTC_SERVICE_URL;
  const envPublic = WEBRTC_PUBLIC_WS_URL;
  const envSecret = RECORDING_CALLBACK_SECRET;
  const envServiceSecret = WEBRTC_SERVICE_SECRET;

  const settingsService = (settings.webrtc_service_url ?? "").trim();
  const settingsPublic = (settings.webrtc_public_ws_url ?? "").trim();
  const settingsSecret = (settings.recording_callback_secret ?? "").trim();

  return {
    serviceUrl: settingsService || envService || null,
    publicWsUrl: settingsPublic || envPublic || null,
    recordingCallbackSecret: settingsSecret || envSecret || null,
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
