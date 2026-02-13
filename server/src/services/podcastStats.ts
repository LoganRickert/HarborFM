import { createHash } from "crypto";
import { LISTEN_THRESHOLD_BYTES, STATS_FLUSH_INTERVAL_MS } from "../config.js";
import { db } from "../db/index.js";

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
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO podcast_stats_listen_dedup (episode_id, stat_date, client_key) VALUES (?, ?, ?)`,
  );
  const result = stmt.run(episodeId, date, clientKeyVal);
  return result.changes === 1;
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
  const upsert = db.prepare(`
    INSERT INTO podcast_stats_rss_daily (podcast_id, stat_date, bot_count, human_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(podcast_id, stat_date) DO UPDATE SET
      bot_count = bot_count + excluded.bot_count,
      human_count = human_count + excluded.human_count
  `);
  for (const [key, counts] of rssCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const [, podcastId, date] = key.split(":");
    upsert.run(podcastId, date, counts.bot, counts.human);
  }
  rssCounters.clear();
}

function flushEpisode(): void {
  const upsert = db.prepare(`
    INSERT INTO podcast_stats_episode_daily (episode_id, stat_date, bot_count, human_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(episode_id, stat_date) DO UPDATE SET
      bot_count = bot_count + excluded.bot_count,
      human_count = human_count + excluded.human_count
  `);
  for (const [key, counts] of episodeCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const [, episodeId, date] = key.split(":");
    upsert.run(episodeId, date, counts.bot, counts.human);
  }
  episodeCounters.clear();
}

function flushEpisodeLocation(): void {
  const upsert = db.prepare(`
    INSERT INTO podcast_stats_episode_location_daily (episode_id, stat_date, location, bot_count, human_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(episode_id, stat_date, location) DO UPDATE SET
      bot_count = bot_count + excluded.bot_count,
      human_count = human_count + excluded.human_count
  `);
  for (const [key, counts] of episodeLocationCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const parts = key.split(":");
    const episodeId = parts[1];
    const date = parts[2];
    const location = parts.slice(3).join(":"); // location might contain ':'
    upsert.run(episodeId, date, location, counts.bot, counts.human);
  }
  episodeLocationCounters.clear();
}

function flushListens(): void {
  const upsert = db.prepare(`
    INSERT INTO podcast_stats_episode_listens_daily (episode_id, stat_date, bot_count, human_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(episode_id, stat_date) DO UPDATE SET
      bot_count = bot_count + excluded.bot_count,
      human_count = human_count + excluded.human_count
  `);
  for (const [key, counts] of listenCounters) {
    if (counts.bot === 0 && counts.human === 0) continue;
    const [, episodeId, date] = key.split(":");
    upsert.run(episodeId, date, counts.bot, counts.human);
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
  db.prepare(
    `DELETE FROM podcast_stats_listen_dedup WHERE stat_date < date('now', ?)`,
  ).run(`-${DEDUP_RETAIN_DAYS} days`);
}
