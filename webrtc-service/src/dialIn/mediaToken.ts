/**
 * Verify short-lived HMAC tokens minted by the HarborFM app server for Telnyx media WS.
 */

import { createHmac, timingSafeEqual } from "crypto";

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
