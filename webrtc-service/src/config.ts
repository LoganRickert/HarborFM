export const PORT = Number(process.env.PORT) || 3002;

export const RTC_MIN_PORT = Number(process.env.RTC_MIN_PORT) || 40000;
export const RTC_MAX_PORT = Number(process.env.RTC_MAX_PORT) || 40200;
export const ANNOUNCED_IP = process.env.MEDIASOUP_ANNOUNCED_IP?.trim() || undefined;

export const RECORDING_DATA_DIR =
  process.env.RECORDING_DATA_DIR?.trim() || process.env.DATA_DIR?.trim() || "/data";
export const RECORD_PORT_BASE = 50000;
/** Stride to avoid port conflict when starting a new recording before the previous FFmpeg has released ports. */
export const RECORD_PORT_STRIDE = 128;

export const MAIN_APP_URL = process.env.MAIN_APP_URL?.trim() || "";

/** Secret required in X-WebRTC-Service-Secret header for /room, /start-recording, /stop-recording. When set, requests without the header are rejected. Env: WEBRTC_SERVICE_SECRET. */
export const WEBRTC_SERVICE_SECRET = process.env.WEBRTC_SERVICE_SECRET?.trim() || null;

/** Delay (ms) to let in-flight RTP reach FFmpeg before closing consumer/transport. Env: FINALIZE_RTP_FLUSH_MS. Default 1200. Use lower (e.g. 300) for e2e tests. */
export const FINALIZE_RTP_FLUSH_MS =
  Number(process.env.FINALIZE_RTP_FLUSH_MS) || 1200;

/** Format current local time as YYYYMMDD_HHMMSS for recording folder names (matches segments format). */
export function formatDateTimeForFolder(): string {
  const d = new Date();
  const y = String(d.getFullYear());
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}${mo}${day}_${h}${min}${s}`;
}
