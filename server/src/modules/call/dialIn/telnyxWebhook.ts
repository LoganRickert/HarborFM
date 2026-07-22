import { createPublicKey, verify } from "crypto";
import { hasTelnyxApiKey } from "./config.js";
import { readSettings } from "../../settings/repo.js";
import type { AppSettings } from "../../settings/utils.js";

/** Max age of Telnyx-Timestamp before rejecting (replay protection). */
export const TELNYX_WEBHOOK_MAX_SKEW_SEC = 5 * 60;

/** Ed25519 SPKI DER prefix for a raw 32-byte public key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type TelnyxWebhookVerifyResult =
  | { ok: true; skipped: boolean }
  | { ok: false; error: string; status: number };

/**
 * Verify Telnyx Call Control webhook Ed25519 signature.
 * Signed payload is `{telnyx-timestamp}|{rawBody}` (UTF-8).
 *
 * Live dial-in (Telnyx API key set): require public key + valid signature.
 * Fake-only (DIAL_IN_FAKE, no API key): skip so e2e can POST unsigned bodies.
 */
export function verifyTelnyxWebhookSignature(opts: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  settings?: AppSettings;
  nowSec?: number;
}): TelnyxWebhookVerifyResult {
  const settings = opts.settings ?? readSettings();

  if (!hasTelnyxApiKey(settings)) {
    return { ok: true, skipped: true };
  }

  const publicKeyB64 = (settings.telnyx_public_key ?? "").trim();
  if (!publicKeyB64 || publicKeyB64 === "(set)") {
    return {
      ok: false,
      status: 403,
      error:
        "Telnyx public key is required for live dial-in webhooks. Add it under Settings, WebRTC.",
    };
  }

  const signatureB64 =
    typeof opts.signatureHeader === "string" ? opts.signatureHeader.trim() : "";
  const timestamp =
    typeof opts.timestampHeader === "string" ? opts.timestampHeader.trim() : "";
  if (!signatureB64 || !timestamp) {
    return {
      ok: false,
      status: 401,
      error: "Missing Telnyx webhook signature headers",
    };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, error: "Invalid Telnyx-Timestamp" };
  }

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TELNYX_WEBHOOK_MAX_SKEW_SEC) {
    return { ok: false, status: 401, error: "Telnyx webhook timestamp out of range" };
  }

  let publicKeyRaw: Buffer;
  let signature: Buffer;
  try {
    publicKeyRaw = Buffer.from(publicKeyB64, "base64");
    signature = Buffer.from(signatureB64, "base64");
  } catch {
    return { ok: false, status: 401, error: "Invalid Telnyx webhook signature encoding" };
  }

  if (publicKeyRaw.length !== 32) {
    return {
      ok: false,
      status: 403,
      error: "Telnyx public key must be a base64-encoded 32-byte Ed25519 key",
    };
  }

  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyRaw]),
      format: "der",
      type: "spki",
    });
    const signedPayload = Buffer.from(`${timestamp}|${opts.rawBody.toString("utf8")}`, "utf8");
    const valid = verify(null, signedPayload, key, signature);
    if (!valid) {
      return { ok: false, status: 401, error: "Invalid Telnyx webhook signature" };
    }
    return { ok: true, skipped: false };
  } catch {
    return { ok: false, status: 401, error: "Telnyx webhook signature verification failed" };
  }
}
