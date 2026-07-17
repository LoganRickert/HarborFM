import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { drizzleDb } from "../../db/drizzle.js";
import {
  episodeAlertDestinations,
  episodeAlertSubscribers,
  episodes,
  podcasts,
} from "../../db/schema.js";
import type { EpisodeAlertDestinationType, EpisodeAlertList } from "@harborfm/shared";
import {
  encryptConfigSecrets,
  parseConfigJson,
  redactConfigSecrets,
} from "./configSecrets.js";

export type PodcastAlertSettings = {
  id: string;
  slug: string;
  title: string;
  episodeAlertsEnabled: boolean;
  episodeAlertsCheckoutList: EpisodeAlertList;
  episodeAlertsMailingAddress: string | null;
};

export function getPodcastAlertSettings(
  podcastId: string,
): PodcastAlertSettings | null {
  const row = drizzleDb
    .select({
      id: podcasts.id,
      slug: podcasts.slug,
      title: podcasts.title,
      episodeAlertsEnabled: sql<number>`COALESCE(${podcasts.episodeAlertsEnabled}, 0)`,
      episodeAlertsCheckoutList: sql<string>`COALESCE(${podcasts.episodeAlertsCheckoutList}, 'subscribers')`,
      episodeAlertsMailingAddress: podcasts.episodeAlertsMailingAddress,
    })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    episodeAlertsEnabled: row.episodeAlertsEnabled === 1,
    episodeAlertsCheckoutList:
      row.episodeAlertsCheckoutList === "general" ? "general" : "subscribers",
    episodeAlertsMailingAddress: row.episodeAlertsMailingAddress ?? null,
  };
}

export function updatePodcastAlertSettings(
  podcastId: string,
  patch: {
    episodeAlertsEnabled?: boolean;
    episodeAlertsCheckoutList?: EpisodeAlertList;
    episodeAlertsMailingAddress?: string | null;
  },
): PodcastAlertSettings | null {
  const set: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.episodeAlertsEnabled !== undefined) {
    set.episodeAlertsEnabled = patch.episodeAlertsEnabled;
  }
  if (patch.episodeAlertsCheckoutList !== undefined) {
    set.episodeAlertsCheckoutList = patch.episodeAlertsCheckoutList;
  }
  if (patch.episodeAlertsMailingAddress !== undefined) {
    set.episodeAlertsMailingAddress =
      patch.episodeAlertsMailingAddress?.trim() || null;
  }
  drizzleDb.update(podcasts).set(set).where(eq(podcasts.id, podcastId)).run();
  return getPodcastAlertSettings(podcastId);
}

export type DestinationRow = {
  id: string;
  podcastId: string;
  name: string;
  type: EpisodeAlertDestinationType;
  enabled: boolean;
  episodeScope: "all" | "premium";
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function mapDestination(row: {
  id: string;
  podcastId: string;
  name: string;
  type: string;
  enabled: boolean | number | null;
  episodeScope?: string | null;
  config: string;
  createdAt: string;
  updatedAt: string;
}): DestinationRow {
  return {
    id: row.id,
    podcastId: row.podcastId,
    name: row.name,
    type: row.type as EpisodeAlertDestinationType,
    enabled: row.enabled === true || row.enabled === 1,
    episodeScope: row.episodeScope === "premium" ? "premium" : "all",
    config: parseConfigJson(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listDestinations(podcastId: string): DestinationRow[] {
  const rows = drizzleDb
    .select()
    .from(episodeAlertDestinations)
    .where(eq(episodeAlertDestinations.podcastId, podcastId))
    .all();
  return rows.map(mapDestination);
}

export function getDestination(
  podcastId: string,
  destinationId: string,
): DestinationRow | null {
  const row = drizzleDb
    .select()
    .from(episodeAlertDestinations)
    .where(
      and(
        eq(episodeAlertDestinations.id, destinationId),
        eq(episodeAlertDestinations.podcastId, podcastId),
      ),
    )
    .limit(1)
    .get();
  return row ? mapDestination(row) : null;
}

export function createDestination(opts: {
  podcastId: string;
  name: string;
  type: EpisodeAlertDestinationType;
  enabled?: boolean;
  episodeScope?: "all" | "premium";
  config?: Record<string, unknown>;
}): DestinationRow {
  const id = nanoid();
  const now = new Date().toISOString();
  const config = encryptConfigSecrets(opts.config ?? {});
  drizzleDb
    .insert(episodeAlertDestinations)
    .values({
      id,
      podcastId: opts.podcastId,
      name: opts.name.trim() || defaultNameForType(opts.type),
      type: opts.type,
      enabled: opts.enabled !== false,
      episodeScope: opts.episodeScope === "premium" ? "premium" : "all",
      config: JSON.stringify(config),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getDestination(opts.podcastId, id)!;
}

export function updateDestination(
  podcastId: string,
  destinationId: string,
  patch: {
    name?: string;
    enabled?: boolean;
    episodeScope?: "all" | "premium";
    config?: Record<string, unknown>;
  },
): DestinationRow | null {
  const existing = getDestination(podcastId, destinationId);
  if (!existing) return null;
  const set: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.episodeScope !== undefined) {
    set.episodeScope = patch.episodeScope === "premium" ? "premium" : "all";
  }
  if (patch.config !== undefined) {
    set.config = JSON.stringify(
      encryptConfigSecrets(patch.config, existing.config),
    );
  }
  drizzleDb
    .update(episodeAlertDestinations)
    .set(set)
    .where(
      and(
        eq(episodeAlertDestinations.id, destinationId),
        eq(episodeAlertDestinations.podcastId, podcastId),
      ),
    )
    .run();
  return getDestination(podcastId, destinationId);
}

export function deleteDestination(
  podcastId: string,
  destinationId: string,
): boolean {
  const result = drizzleDb
    .delete(episodeAlertDestinations)
    .where(
      and(
        eq(episodeAlertDestinations.id, destinationId),
        eq(episodeAlertDestinations.podcastId, podcastId),
      ),
    )
    .run();
  return (result.changes ?? 0) > 0;
}

export function toDestinationApi(row: DestinationRow) {
  return {
    id: row.id,
    podcastId: row.podcastId,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    episodeScope: row.episodeScope,
    config: redactConfigSecrets(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function hasEnabledEmailDestination(podcastId: string): boolean {
  const rows = listDestinations(podcastId);
  return rows.some(
    (d) =>
      d.enabled &&
      (d.type === "builtin" ||
        d.type === "byo_email" ||
        d.type === "byo_sendgrid"),
  );
}

function defaultNameForType(type: EpisodeAlertDestinationType): string {
  const labels: Record<EpisodeAlertDestinationType, string> = {
    builtin: "Built-In Notifications",
    byo_email: "Bring Your Own Email (SMTP)",
    byo_sendgrid: "Bring Your Own SendGrid",
    discord: "Discord Webhook",
    slack: "Slack Webhook",
    telegram: "Telegram",
    mastodon: "Mastodon",
    matrix: "Matrix",
    lemmy: "Lemmy",
    bluesky: "Bluesky",
    json_webhook: "JSON Webhook",
  };
  return labels[type] ?? type;
}

export type SubscriberRow = {
  id: string;
  podcastId: string;
  email: string;
  list: EpisodeAlertList;
  verified: boolean;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: string | null;
  unsubscribeTokenHash: string | null;
  source: string;
  createdAt: string;
  verifiedAt: string | null;
};

export function findSubscriberByVerifyHash(
  tokenHash: string,
): SubscriberRow | null {
  const row = drizzleDb
    .select()
    .from(episodeAlertSubscribers)
    .where(eq(episodeAlertSubscribers.emailVerificationTokenHash, tokenHash))
    .limit(1)
    .get();
  return row ? mapSubscriber(row) : null;
}

export function findSubscriberByUnsubHash(
  tokenHash: string,
): SubscriberRow | null {
  const row = drizzleDb
    .select()
    .from(episodeAlertSubscribers)
    .where(eq(episodeAlertSubscribers.unsubscribeTokenHash, tokenHash))
    .limit(1)
    .get();
  return row ? mapSubscriber(row) : null;
}

function mapSubscriber(row: {
  id: string;
  podcastId: string;
  email: string;
  list: string;
  verified: boolean | number | null;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: string | null;
  unsubscribeTokenHash: string | null;
  source: string;
  createdAt: string;
  verifiedAt: string | null;
}): SubscriberRow {
  return {
    id: row.id,
    podcastId: row.podcastId,
    email: row.email,
    list: row.list === "subscribers" ? "subscribers" : "general",
    verified: row.verified === true || row.verified === 1,
    emailVerificationTokenHash: row.emailVerificationTokenHash,
    emailVerificationExpiresAt: row.emailVerificationExpiresAt,
    unsubscribeTokenHash: row.unsubscribeTokenHash,
    source: row.source,
    createdAt: row.createdAt,
    verifiedAt: row.verifiedAt,
  };
}

export function upsertPendingSubscriber(opts: {
  podcastId: string;
  email: string;
  list: EpisodeAlertList;
  source: "feed" | "checkout";
  verifyTokenHash: string;
  verifyExpiresAt: string;
  unsubscribeTokenHash: string;
}): { id: string; alreadyVerified: boolean } {
  const email = opts.email.trim().toLowerCase();
  const existing = drizzleDb
    .select()
    .from(episodeAlertSubscribers)
    .where(
      and(
        eq(episodeAlertSubscribers.podcastId, opts.podcastId),
        eq(episodeAlertSubscribers.email, email),
        eq(episodeAlertSubscribers.list, opts.list),
      ),
    )
    .limit(1)
    .get();

  if (existing) {
    if (existing.verified === true || Number(existing.verified) === 1) {
      return { id: existing.id, alreadyVerified: true };
    }
    drizzleDb
      .update(episodeAlertSubscribers)
      .set({
        emailVerificationTokenHash: opts.verifyTokenHash,
        emailVerificationExpiresAt: opts.verifyExpiresAt,
        unsubscribeTokenHash: opts.unsubscribeTokenHash,
        source: opts.source,
      })
      .where(eq(episodeAlertSubscribers.id, existing.id))
      .run();
    return { id: existing.id, alreadyVerified: false };
  }

  const id = nanoid();
  drizzleDb
    .insert(episodeAlertSubscribers)
    .values({
      id,
      podcastId: opts.podcastId,
      email,
      list: opts.list,
      verified: false,
      emailVerificationTokenHash: opts.verifyTokenHash,
      emailVerificationExpiresAt: opts.verifyExpiresAt,
      unsubscribeTokenHash: opts.unsubscribeTokenHash,
      source: opts.source,
      createdAt: new Date().toISOString(),
      verifiedAt: null,
    })
    .run();
  return { id, alreadyVerified: false };
}

export function markSubscriberVerified(id: string): void {
  drizzleDb
    .update(episodeAlertSubscribers)
    .set({
      verified: true,
      verifiedAt: new Date().toISOString(),
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    })
    .where(eq(episodeAlertSubscribers.id, id))
    .run();
}

export function deleteSubscriber(id: string): void {
  drizzleDb
    .delete(episodeAlertSubscribers)
    .where(eq(episodeAlertSubscribers.id, id))
    .run();
}

export function listVerifiedEmails(
  podcastId: string,
  lists: EpisodeAlertList[],
): Array<{ id: string; email: string; unsubscribeTokenHash: string | null }> {
  if (lists.length === 0) return [];
  const rows = drizzleDb
    .select({
      id: episodeAlertSubscribers.id,
      email: episodeAlertSubscribers.email,
      unsubscribeTokenHash: episodeAlertSubscribers.unsubscribeTokenHash,
    })
    .from(episodeAlertSubscribers)
    .where(
      and(
        eq(episodeAlertSubscribers.podcastId, podcastId),
        eq(episodeAlertSubscribers.verified, true),
        inArray(episodeAlertSubscribers.list, lists),
      ),
    )
    .all();
  return rows;
}

/** Verified alert signup counts by mailing list. */
export function countVerifiedAlertSubscribers(podcastId: string): {
  general: number;
  subscribers: number;
  total: number;
} {
  const rows = drizzleDb
    .select({
      list: episodeAlertSubscribers.list,
      count: sql<number>`COUNT(*)`,
    })
    .from(episodeAlertSubscribers)
    .where(
      and(
        eq(episodeAlertSubscribers.podcastId, podcastId),
        eq(episodeAlertSubscribers.verified, true),
      ),
    )
    .groupBy(episodeAlertSubscribers.list)
    .all();

  let general = 0;
  let subscribers = 0;
  for (const row of rows) {
    const n = Number(row.count) || 0;
    if (row.list === "subscribers") subscribers = n;
    else if (row.list === "general") general = n;
  }
  return { general, subscribers, total: general + subscribers };
}

function asBoolFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export type EpisodeForAlert = {
  id: string;
  podcastId: string;
  title: string;
  description: string | null;
  slug: string | null;
  publishAt: string | null;
  status: string;
  subscriberOnly: boolean;
  episodeAlertsSentAt: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  artworkPath: string | null;
  artworkUrl: string | null;
  podcastArtworkPath: string | null;
  podcastArtworkUrl: string | null;
};

export function getEpisodeForAlert(episodeId: string): EpisodeForAlert | null {
  const row = drizzleDb
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      title: episodes.title,
      description: episodes.description,
      slug: episodes.slug,
      publishAt: episodes.publishAt,
      status: episodes.status,
      subscriberOnly: sql<number>`COALESCE(${episodes.subscriberOnly}, 0)`,
      episodeAlertsSentAt: episodes.episodeAlertsSentAt,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      artworkPath: episodes.artworkPath,
      artworkUrl: episodes.artworkUrl,
      podcastArtworkPath: podcasts.artworkPath,
      podcastArtworkUrl: podcasts.artworkUrl,
    })
    .from(episodes)
    .innerJoin(podcasts, eq(episodes.podcastId, podcasts.id))
    .where(eq(episodes.id, episodeId))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    ...row,
    subscriberOnly: asBoolFlag(row.subscriberOnly),
    seasonNumber: row.seasonNumber ?? null,
    episodeNumber: row.episodeNumber ?? null,
    artworkPath: row.artworkPath ?? null,
    artworkUrl: row.artworkUrl ?? null,
    podcastArtworkPath: row.podcastArtworkPath ?? null,
    podcastArtworkUrl: row.podcastArtworkUrl ?? null,
  };
}

export function isEpisodeReleased(ep: {
  status: string;
  publishAt: string | null;
}): boolean {
  if (ep.status !== "published") return false;
  if (!ep.publishAt) return true;
  return new Date(ep.publishAt).getTime() <= Date.now();
}

/**
 * Atomically claim alert dispatch for an episode.
 * Returns true only for the first caller; later callers get false (already claimed).
 * Prevents double-send when the publish hook and the 15-minute poller overlap,
 * or when multiple server processes race.
 */
export function claimEpisodeAlertsSend(episodeId: string): boolean {
  const result = drizzleDb
    .update(episodes)
    .set({ episodeAlertsSentAt: new Date().toISOString() })
    .where(
      and(eq(episodes.id, episodeId), isNull(episodes.episodeAlertsSentAt)),
    )
    .run();
  return (result.changes ?? 0) > 0;
}

/** Episodes that are released, alerts enabled on show, and not yet sent. */
export function listDueAlertEpisodes(limit = 50): EpisodeForAlert[] {
  const rows = drizzleDb
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      title: episodes.title,
      description: episodes.description,
      slug: episodes.slug,
      publishAt: episodes.publishAt,
      status: episodes.status,
      subscriberOnly: sql<number>`COALESCE(${episodes.subscriberOnly}, 0)`,
      episodeAlertsSentAt: episodes.episodeAlertsSentAt,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      artworkPath: episodes.artworkPath,
      artworkUrl: episodes.artworkUrl,
      podcastArtworkPath: podcasts.artworkPath,
      podcastArtworkUrl: podcasts.artworkUrl,
    })
    .from(episodes)
    .innerJoin(podcasts, eq(episodes.podcastId, podcasts.id))
    .where(
      and(
        eq(episodes.status, "published"),
        isNull(episodes.episodeAlertsSentAt),
        sql`COALESCE(${podcasts.episodeAlertsEnabled}, 0) = 1`,
        sql`(${episodes.publishAt} IS NULL OR datetime(${episodes.publishAt}) <= datetime('now'))`,
      ),
    )
    .limit(limit)
    .all();
  return rows.map((r) => ({
    ...r,
    subscriberOnly: asBoolFlag(r.subscriberOnly),
    seasonNumber: r.seasonNumber ?? null,
    episodeNumber: r.episodeNumber ?? null,
    artworkPath: r.artworkPath ?? null,
    artworkUrl: r.artworkUrl ?? null,
    podcastArtworkPath: r.podcastArtworkPath ?? null,
    podcastArtworkUrl: r.podcastArtworkUrl ?? null,
  }));
}

export function getPodcastSlugById(podcastId: string): string | null {
  const row = drizzleDb
    .select({ slug: podcasts.slug })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .limit(1)
    .get();
  return row?.slug ?? null;
}
