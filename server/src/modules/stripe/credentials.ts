import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../db/drizzle.js";
import { stripeCredentials, podcasts } from "../../db/schema.js";
import { STRIPE_SECRETS_AAD, API_PREFIX } from "../../config.js";
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
} from "../../services/secrets.js";
import { getBaseUrl } from "../auth/shared.js";
import { isE2eStripeSecret } from "./stripeClient.js";

export type StripeMode = "test" | "live";

export type StripeCredentialsRow = typeof stripeCredentials.$inferSelect;

const SECRET_FIELDS = [
  "testSecretKeyEnc",
  "testPublishableKeyEnc",
  "testWebhookSecretEnc",
  "liveSecretKeyEnc",
  "livePublishableKeyEnc",
  "liveWebhookSecretEnc",
] as const;

type SecretEncField = (typeof SECRET_FIELDS)[number];

const INPUT_TO_ENC: Record<string, SecretEncField> = {
  testSecretKey: "testSecretKeyEnc",
  testPublishableKey: "testPublishableKeyEnc",
  testWebhookSecret: "testWebhookSecretEnc",
  liveSecretKey: "liveSecretKeyEnc",
  livePublishableKey: "livePublishableKeyEnc",
  liveWebhookSecret: "liveWebhookSecretEnc",
};

function encIsSet(value: string | null | undefined): boolean {
  return Boolean(value && String(value).trim().length > 0);
}

function applySecretInput(
  current: string | null | undefined,
  incoming: string | undefined,
): string | null {
  if (incoming === undefined) return current ?? null;
  const v = String(incoming).trim();
  if (v === "(set)") return current ?? null;
  if (!v) return null;
  return encryptSecret(v, STRIPE_SECRETS_AAD);
}

function decryptIfPresent(enc: string | null | undefined): string | null {
  if (!enc || !String(enc).trim()) return null;
  if (isEncryptedSecret(enc)) {
    try {
      return decryptSecret(enc, STRIPE_SECRETS_AAD);
    } catch {
      return null;
    }
  }
  return enc;
}

export function webhookUrlForCredentials(credentialsId: string): string {
  const base = getBaseUrl();
  return `${base}/${API_PREFIX}/public/stripe/webhook/${encodeURIComponent(credentialsId)}`;
}

export function toCredentialsApi(
  row: StripeCredentialsRow,
  opts?: { includePublishable?: boolean },
) {
  const mode = (row.mode === "live" ? "live" : "test") as StripeMode;
  const publishableEnc =
    mode === "live" ? row.livePublishableKeyEnc : row.testPublishableKeyEnc;
  const secretEnc =
    mode === "live" ? row.liveSecretKeyEnc : row.testSecretKeyEnc;
  const out: Record<string, unknown> = {
    id: row.id,
    ownerUserId: row.ownerUserId,
    displayName: row.displayName,
    mode,
    testSecretKeySet: encIsSet(row.testSecretKeyEnc),
    testPublishableKeySet: encIsSet(row.testPublishableKeyEnc),
    testWebhookSecretSet: encIsSet(row.testWebhookSecretEnc),
    liveSecretKeySet: encIsSet(row.liveSecretKeyEnc),
    livePublishableKeySet: encIsSet(row.livePublishableKeyEnc),
    liveWebhookSecretSet: encIsSet(row.liveWebhookSecretEnc),
    webhookUrl: webhookUrlForCredentials(row.id),
    activeSecretKeySet: encIsSet(secretEnc),
    verified: Boolean(row.verified),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (opts?.includePublishable) {
    out.publishableKey = decryptIfPresent(publishableEnc) ?? "";
  }
  // Never expose ciphertext
  for (const f of SECRET_FIELDS) {
    delete out[f];
  }
  return out;
}

export function getById(id: string): StripeCredentialsRow | undefined {
  return drizzleDb
    .select()
    .from(stripeCredentials)
    .where(eq(stripeCredentials.id, id))
    .limit(1)
    .get();
}

export function listByOwner(ownerUserId: string): StripeCredentialsRow[] {
  return drizzleDb
    .select()
    .from(stripeCredentials)
    .where(eq(stripeCredentials.ownerUserId, ownerUserId))
    .all()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function countConfiguredForOwner(ownerUserId: string): number {
  const rows = listByOwner(ownerUserId);
  return rows.filter((r) => {
    const enc = r.mode === "live" ? r.liveSecretKeyEnc : r.testSecretKeyEnc;
    return encIsSet(enc);
  }).length;
}

export function createCredentials(
  ownerUserId: string,
  body: {
    displayName: string;
    mode?: StripeMode;
    testSecretKey?: string;
    testPublishableKey?: string;
    testWebhookSecret?: string;
    liveSecretKey?: string;
    livePublishableKey?: string;
    liveWebhookSecret?: string;
  },
): StripeCredentialsRow {
  const id = nanoid();
  const now = new Date().toISOString();
  const mode = body.mode === "live" ? "live" : "test";
  const activeSecret =
    mode === "live" ? body.liveSecretKey : body.testSecretKey;
  const values: typeof stripeCredentials.$inferInsert = {
    id,
    ownerUserId,
    displayName: body.displayName || "Stripe",
    mode,
    testSecretKeyEnc: applySecretInput(null, body.testSecretKey),
    testPublishableKeyEnc: applySecretInput(null, body.testPublishableKey),
    testWebhookSecretEnc: applySecretInput(null, body.testWebhookSecret),
    liveSecretKeyEnc: applySecretInput(null, body.liveSecretKey),
    livePublishableKeyEnc: applySecretInput(null, body.livePublishableKey),
    liveWebhookSecretEnc: applySecretInput(null, body.liveWebhookSecret),
    // E2E fixtures skip the wizard verify step; real packs start unverified.
    verified: Boolean(activeSecret && isE2eStripeSecret(activeSecret)),
    createdAt: now,
    updatedAt: now,
  };
  drizzleDb.insert(stripeCredentials).values(values).run();
  return getById(id)!;
}

export function updateCredentials(
  id: string,
  body: {
    displayName?: string;
    testSecretKey?: string;
    testPublishableKey?: string;
    testWebhookSecret?: string;
    liveSecretKey?: string;
    livePublishableKey?: string;
    liveWebhookSecret?: string;
  },
): StripeCredentialsRow | null {
  const current = getById(id);
  if (!current) return null;
  const set: Partial<StripeCredentialsRow> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.displayName !== undefined) set.displayName = body.displayName;
  let secretsChanged = false;
  for (const [inputKey, encKey] of Object.entries(INPUT_TO_ENC)) {
    const incoming = body[inputKey as keyof typeof body] as string | undefined;
    if (incoming !== undefined) {
      const nextEnc = applySecretInput(current[encKey], incoming);
      (set as Record<string, unknown>)[encKey] = nextEnc;
      const prev = current[encKey] ?? null;
      if (nextEnc !== prev) secretsChanged = true;
    }
  }
  if (secretsChanged) {
    const mode = current.mode === "live" ? "live" : "test";
    const nextSecretEnc =
      mode === "live"
        ? ((set.liveSecretKeyEnc as string | null | undefined) ??
          current.liveSecretKeyEnc)
        : ((set.testSecretKeyEnc as string | null | undefined) ??
          current.testSecretKeyEnc);
    const nextSecret = decryptIfPresent(nextSecretEnc);
    set.verified = Boolean(nextSecret && isE2eStripeSecret(nextSecret));
  }
  drizzleDb
    .update(stripeCredentials)
    .set(set)
    .where(eq(stripeCredentials.id, id))
    .run();
  return getById(id)!;
}

export function setCredentialsVerified(
  id: string,
  verified: boolean,
): StripeCredentialsRow | null {
  const current = getById(id);
  if (!current) return null;
  drizzleDb
    .update(stripeCredentials)
    .set({
      verified,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(stripeCredentials.id, id))
    .run();
  return getById(id)!;
}

export function deleteCredentials(id: string, ownerUserId: string): boolean {
  // Clear podcast links first (SQLite may not enforce ON DELETE SET NULL on ALTER)
  drizzleDb
    .update(podcasts)
    .set({ stripeCredentialsId: null })
    .where(eq(podcasts.stripeCredentialsId, id))
    .run();
  const result = drizzleDb
    .delete(stripeCredentials)
    .where(
      and(
        eq(stripeCredentials.id, id),
        eq(stripeCredentials.ownerUserId, ownerUserId),
      ),
    )
    .run();
  return result.changes > 0;
}

export function attachToPodcast(
  podcastId: string,
  stripeCredentialsId: string | null | undefined,
  stripePaymentsEnabled?: boolean,
  billingAnchor?: "anniversary" | "month_start",
  stripeCheckoutPaused?: boolean,
): void {
  const set: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (stripeCredentialsId !== undefined) {
    set.stripeCredentialsId = stripeCredentialsId;
  }
  if (stripePaymentsEnabled !== undefined) {
    set.stripePaymentsEnabled = stripePaymentsEnabled ? 1 : 0;
  }
  if (stripeCheckoutPaused !== undefined) {
    set.stripeCheckoutPaused = stripeCheckoutPaused ? 1 : 0;
  }
  if (billingAnchor !== undefined) {
    set.billingAnchor = billingAnchor;
  }
  drizzleDb.update(podcasts).set(set).where(eq(podcasts.id, podcastId)).run();
}

export function getPodcastStripeFields(podcastId: string): {
  stripeCredentialsId: string | null;
  stripePaymentsEnabled: boolean;
  stripeCheckoutPaused: boolean;
  billingAnchor: "anniversary" | "month_start";
  ownerUserId: string;
} | null {
  const row = drizzleDb
    .select({
      stripeCredentialsId: podcasts.stripeCredentialsId,
      stripePaymentsEnabled: podcasts.stripePaymentsEnabled,
      stripeCheckoutPaused: podcasts.stripeCheckoutPaused,
      billingAnchor: podcasts.billingAnchor,
      ownerUserId: podcasts.ownerUserId,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    stripeCredentialsId: row.stripeCredentialsId ?? null,
    stripePaymentsEnabled: Boolean(row.stripePaymentsEnabled),
    stripeCheckoutPaused: Boolean(row.stripeCheckoutPaused),
    billingAnchor:
      row.billingAnchor === "month_start" ? "month_start" : "anniversary",
    ownerUserId: row.ownerUserId,
  };
}

/** Decrypt secret key for a specific mode (not necessarily the packs active mode). */
export function getSecretKeyForMode(
  row: StripeCredentialsRow,
  mode: "test" | "live",
): string | null {
  const enc = mode === "live" ? row.liveSecretKeyEnc : row.testSecretKeyEnc;
  return decryptIfPresent(enc);
}

/** Decrypt active-mode secret key for server-side Stripe client (later phases). */
export function getActiveSecretKey(row: StripeCredentialsRow): string | null {
  return getSecretKeyForMode(row, row.mode === "live" ? "live" : "test");
}

/** Decrypt active-mode webhook signing secret for public webhook verification. */
export function getActiveWebhookSecret(row: StripeCredentialsRow): string | null {
  const enc =
    row.mode === "live" ? row.liveWebhookSecretEnc : row.testWebhookSecretEnc;
  return decryptIfPresent(enc);
}

/** Decrypt active-mode publishable key for verification / Checkout. */
export function getActivePublishableKey(row: StripeCredentialsRow): string | null {
  const enc =
    row.mode === "live" ? row.livePublishableKeyEnc : row.testPublishableKeyEnc;
  return decryptIfPresent(enc);
}
