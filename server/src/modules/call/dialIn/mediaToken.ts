/**
 * Short-lived HMAC tokens for Telnyx to webrtc media WebSocket auth.
 * Payload is verified by webrtc-service with the same WEBRTC_SERVICE_SECRET.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { WEBRTC_SERVICE_SECRET } from "../../../config.js";

export type DialInMediaTokenPayload = {
  v: 1;
  roomId: string;
  participantId: string;
  participantName: string;
  sessionId: string;
  callControlId: string;
  dialInId: string;
  exp: number;
};

const TOKEN_TTL_MS = 5 * 60 * 1000;

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(body: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(body).digest());
}

export function mintDialInMediaToken(
  parts: Omit<DialInMediaTokenPayload, "v" | "exp"> & { exp?: number },
): string | null {
  const secret = WEBRTC_SERVICE_SECRET?.trim();
  if (!secret) return null;
  const payload: DialInMediaTokenPayload = {
    v: 1,
    roomId: parts.roomId,
    participantId: parts.participantId,
    participantName: parts.participantName,
    sessionId: parts.sessionId,
    callControlId: parts.callControlId,
    dialInId: parts.dialInId,
    exp: parts.exp ?? Date.now() + TOKEN_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifyDialInMediaToken(
  token: string,
  secret: string | null | undefined,
): DialInMediaTokenPayload | null {
  const s = secret?.trim();
  if (!s || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, s);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(b64urlDecode(body).toString("utf8")) as DialInMediaTokenPayload;
    if (raw?.v !== 1 || typeof raw.exp !== "number" || Date.now() > raw.exp) {
      return null;
    }
    if (
      !raw.roomId ||
      !raw.participantId ||
      !raw.dialInId ||
      !raw.sessionId ||
      !raw.callControlId
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/** Build public WSS URL Telnyx opens after streaming_start. */
export function buildDialInMediaStreamUrl(
  publicWsBase: string,
  token: string,
): string {
  const base = publicWsBase.replace(/\/$/, "");
  return `${base}/dial-in/media?token=${encodeURIComponent(token)}`;
}
