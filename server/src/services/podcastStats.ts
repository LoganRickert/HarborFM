import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { LISTEN_THRESHOLD_BYTES, STATS_FLUSH_INTERVAL_MS } from "../config.js";
import { drizzleDb } from "../db/drizzle.js";
import {
  podcastStatsEpisodeDaily,
  podcastStatsEpisodeListensDaily,
  podcastStatsEpisodeLocationDaily,
  podcastStatsListenDedup,
  podcastStatsRssDaily,
} from "../db/schema.js";

const DEDUP_RETAIN_DAYS = 2;

function statDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

/**
 * Short hash of (IP + UA + Accept-Language) for listen dedup.
 * Avoids collapsing multiple real listeners behind NAT (IP-only would undercount).
 */
export function clientKey(
  ip: string,
  userAgent: string,
  acceptLanguage: string,
): string {
  const raw = `${ip}\n${userAgent}\n${acceptLanguage}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 24);
}

// In-memory counters: key -> count delta to flush
type Key = string;
const rssCounters = new Map<Key, { bot: number; human: number }>();
const episodeCounters = new Map<Key, { bot: number; human: number }>();
const episodeLocationCounters = new Map<Key, { bot: number; human: number }>();
const listenCounters = new Map<Key, { bot: number; human: number }>();

function rssKey(podcastId: string, date: string): Key {
  return `rss:${podcastId}:${date}`;
}
function episodeKey(episodeId: string, date: string): Key {
  return `ep:${episodeId}:${date}`;
}
function episodeLocationKey(
  episodeId: string,
  date: string,
  location: string,
): Key {
  return `eploc:${episodeId}:${date}:${location}`;
}
function listenKey(episodeId: string, date: string): Key {
  return `listen:${episodeId}:${date}`;
}

function incRss(podcastId: string, isBot: boolean): void {
  const date = statDate();
  const key = rssKey(podcastId, date);
  const cur = rssCounters.get(key) ?? { bot: 0, human: 0 };
  if (isBot) cur.bot += 1;
  else cur.human += 1;
  rssCounters.set(key, cur);
}

function incEpisode(
  episodeId: string,
  isBot: boolean,
  location: string | null,
): void {
  const date = statDate();
  const ek = episodeKey(episodeId, date);
  const cur = episodeCounters.get(ek) ?? { bot: 0, human: 0 };
  if (isBot) cur.bot += 1;
  else cur.human += 1;
  episodeCounters.set(ek, cur);

  if (location != null && location !== "") {
    const lk = episodeLocationKey(episodeId, date, location);
    const locCur = episodeLocationCounters.get(lk) ?? { bot: 0, human: 0 };
    if (isBot) locCur.bot += 1;
    else locCur.human += 1;
    episodeLocationCounters.set(lk, locCur);
  }
}

/**
 * Returns true if this client was newly counted (so caller should increment listen).
 * Uses DB dedup: INSERT OR IGNORE; if row was inserted, count the listen in-memory.
 */
function tryRecordListenDedup(
  episodeId: string,
  date: string,
  clientKeyVal: string,
): boolean {
  const result = drizzleDb
    .insert(podcastStatsListenDedup)
    .values({ episodeId, statDate: date, clientKey: clientKeyVal })
    .onConflictDoNothing({
      target: [
        podcastStatsListenDedup.episodeId,
        podcastStatsListenDedup.statDate,
        podcastStatsListenDedup.clientKey,
      ],
    })
    .run();
  return (result as { changes: number }).changes === 1;
}

function incListen(episodeId: string, isBot: boolean): void {
  const date = statDate();
  const key = listenKey(episodeId, date);
  const cur = listenCounters.get(key) ?? { bot: 0, human: 0 };
  if (isBot) cur.bot += 1;
  else cur.human += 1;
  listenCounters.set(key, cur);
}

export function recordRssRequest(podcastId: string, isBot: boolean): void {
  incRss(podcastId, isBot);
}

export function recordEpisodeRequest(
  episodeId: string,
  isBot: boolean,
  location: string | null,
): void {
  incEpisode(episodeId, isBot, location);
}

/**
 * Record a listen if the requested length meets LISTEN_THRESHOLD_BYTES and the client hasn't been counted today.
 * Deduplicates by (episode_id, stat_date, client_key); at most one listen per client per episode per day.
 */
export function recordEpisodeListenIfNew(
  episodeId: string,
  isBot: boolean,
  clientKeyVal: string,
  requestedLength: number | null,
): void {
  if (requestedLength === null || requestedLength < LISTEN_THRESHOLD_BYTES)
    return;
  const date = statDate();
  if (!tryRecordListenDedup(episodeId, date, clientKeyVal)) return;
  incListen(episodeId, isBot);
}

function flushRss(): void {
  for (const [key, counts] of rssCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const [, podcastId, date] = key.split(":");
    drizzleDb
      .insert(podcastStatsRssDaily)
      .values({
        podcastId,
        statDate: date,
        botCount: counts.bot,
        humanCount: counts.human,
      })
      .onConflictDoUpdate({
        target: [podcastStatsRssDaily.podcastId, podcastStatsRssDaily.statDate],
        set: {
          botCount: sql`${podcastStatsRssDaily.botCount} + ${counts.bot}`,
          humanCount: sql`${podcastStatsRssDaily.humanCount} + ${counts.human}`,
        },
      })
      .run();
  }
  rssCounters.clear();
}

function flushEpisode(): void {
  for (const [key, counts] of episodeCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const [, episodeId, date] = key.split(":");
    drizzleDb
      .insert(podcastStatsEpisodeDaily)
      .values({
        episodeId,
        statDate: date,
        botCount: counts.bot,
        humanCount: counts.human,
      })
      .onConflictDoUpdate({
        target: [
          podcastStatsEpisodeDaily.episodeId,
          podcastStatsEpisodeDaily.statDate,
        ],
        set: {
          botCount: sql`${podcastStatsEpisodeDaily.botCount} + ${counts.bot}`,
          humanCount: sql`${podcastStatsEpisodeDaily.humanCount} + ${counts.human}`,
        },
      })
      .run();
  }
  episodeCounters.clear();
}

function flushEpisodeLocation(): void {
  for (const [key, counts] of episodeLocationCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const parts = key.split(":");
    const episodeId = parts[1];
    const date = parts[2];
    const location = parts.slice(3).join(":");
    drizzleDb
      .insert(podcastStatsEpisodeLocationDaily)
      .values({
        episodeId,
        statDate: date,
        location,
        botCount: counts.bot,
        humanCount: counts.human,
      })
      .onConflictDoUpdate({
        target: [
          podcastStatsEpisodeLocationDaily.episodeId,
          podcastStatsEpisodeLocationDaily.statDate,
          podcastStatsEpisodeLocationDaily.location,
        ],
        set: {
          botCount:
            sql`${podcastStatsEpisodeLocationDaily.botCount} + ${counts.bot}`,
          humanCount:
            sql`${podcastStatsEpisodeLocationDaily.humanCount} + ${counts.human}`,
        },
      })
      .run();
  }
  episodeLocationCounters.clear();
}

function flushListens(): void {
  for (const [key, counts] of listenCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const [, episodeId, date] = key.split(":");
    drizzleDb
      .insert(podcastStatsEpisodeListensDaily)
      .values({
        episodeId,
        statDate: date,
        botCount: counts.bot,
        humanCount: counts.human,
      })
      .onConflictDoUpdate({
        target: [
          podcastStatsEpisodeListensDaily.episodeId,
          podcastStatsEpisodeListensDaily.statDate,
        ],
        set: {
          botCount:
            sql`${podcastStatsEpisodeListensDaily.botCount} + ${counts.bot}`,
          humanCount:
            sql`${podcastStatsEpisodeListensDaily.humanCount} + ${counts.human}`,
        },
      })
      .run();
  }
  listenCounters.clear();
}

export function flush(): void {
  flushRss();
  flushEpisode();
  flushEpisodeLocation();
  flushListens();
}

let flushIntervalId: ReturnType<typeof setInterval> | null = null;

export function startFlushInterval(): void {
  if (flushIntervalId != null) return;
  flushIntervalId = setInterval(flush, STATS_FLUSH_INTERVAL_MS);
}

export function stopFlushInterval(): void {
  if (flushIntervalId != null) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
}

/**
 * Remove old dedup rows so the table doesn't grow indefinitely.
 * Call periodically (e.g. daily or on startup).
 */
export function pruneListenDedup(): void {
  drizzleDb
    .delete(podcastStatsListenDedup)
    .where(
      sql`${podcastStatsListenDedup.statDate} < date('now', ${`-${DEDUP_RETAIN_DAYS} days`})`,
    )
    .run();
}
