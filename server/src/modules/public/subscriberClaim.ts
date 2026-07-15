import { createHmac, timingSafeEqual } from "crypto";
import { getSecretsKey } from "../../services/secrets.js";
import { API_PREFIX } from "../../config.js";

const CLAIM_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

type ClaimPayload = {
  s: string; // podcast slug
  t: string; // raw subscriber token
  e: number; // expiry unix seconds
};

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(data: string): string {
  return b64urlEncode(
    createHmac("sha256", getSecretsKey()).update(data, "utf8").digest(),
  );
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Build a signed claim link that sets the subscriber cookie then redirects to the show. */
export function createSubscriberClaimUrl(opts: {
  baseUrl: string;
  podcastSlug: string;
  rawToken: string;
  ttlSec?: number;
}): string {
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSec ?? CLAIM_TTL_SEC);
  const payload: ClaimPayload = {
    s: opts.podcastSlug,
    t: opts.rawToken,
    e: exp,
  };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = sign(body);
  const claim = `${body}.${sig}`;
  return `${opts.baseUrl.replace(/\/$/, "")}/${API_PREFIX}/public/podcasts/${encodeURIComponent(opts.podcastSlug)}/subscriber-auth/claim?c=${encodeURIComponent(claim)}`;
}

export function verifySubscriberClaim(
  claim: string,
  expectedSlug: string,
): { rawToken: string } | null {
  const trimmed = claim.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!body || !sig || !safeEqual(sign(body), sig)) return null;

  let payload: ClaimPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8")) as ClaimPayload;
  } catch {
    return null;
  }
  if (
    typeof payload?.s !== "string" ||
    typeof payload?.t !== "string" ||
    typeof payload?.e !== "number"
  ) {
    return null;
  }
  if (payload.s !== expectedSlug) return null;
  if (payload.e < Math.floor(Date.now() / 1000)) return null;
  if (!payload.t.trim()) return null;
  return { rawToken: payload.t.trim() };
}
