/**
 * Import a HarborFM podcast analytics JSON export into a local podcast.
 * Remaps episode IDs by episode number (#N in title), and moves human
 * "Other" audio traffic to "Website" (matches browser-heavy access logs).
 *
 * Usage:
 *   pnpm --filter server exec tsx src/db/import-analytics-export.ts \
 *     ../../analytics-2026-07-18-to-2026-07-31.json \
 *     2THV_hjJSWcQDed98OlS8
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { db, closeDb } from "./index.js";

type CountRow = {
  episodeId?: string;
  statDate: string;
  source: string;
  botCount: number;
  humanCount: number;
  location?: string;
};

type ExportPayload = {
  meta: { startDate: string; endDate: string; podcastId: string };
  rssDaily: Array<{
    statDate: string;
    source: string;
    botCount: number;
    humanCount: number;
  }>;
  episodes: Array<{ id: string; title: string; slug: string }>;
  episodeDaily: CountRow[];
  episodeLocationDaily: CountRow[];
  episodeListensDaily: CountRow[];
};

function episodeNumber(title: string): number | null {
  const m = title.trim().match(/^#(\d+)\b/);
  return m ? Number(m[1]) : null;
}

function clientKey(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 24);
}

/** Move human Other audio to Website; keep bots on Other. */
function remapAudioSource(source: string, humanCount: number): string {
  if (source === "Other" && humanCount > 0) return "Website";
  return source;
}

function aggregateCounts(
  rows: Array<{
    episodeId: string;
    statDate: string;
    source: string;
    botCount: number;
    humanCount: number;
    location?: string;
  }>,
  withLocation: boolean,
): typeof rows {
  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = withLocation
      ? `${row.episodeId}|${row.statDate}|${row.location}|${row.source}`
      : `${row.episodeId}|${row.statDate}|${row.source}`;
    const cur = map.get(key);
    if (cur) {
      cur.botCount += row.botCount;
      cur.humanCount += row.humanCount;
    } else {
      map.set(key, { ...row });
    }
  }
  return [...map.values()];
}

function expandOtherHumans(rows: CountRow[], episodeMap: Map<string, string>) {
  const out: Array<{
    episodeId: string;
    statDate: string;
    source: string;
    botCount: number;
    humanCount: number;
    location?: string;
  }> = [];
  for (const row of rows) {
    const localId = row.episodeId ? episodeMap.get(row.episodeId) : undefined;
    if (!localId || !row.episodeId) continue;
    const bots = row.botCount || 0;
    const humans = row.humanCount || 0;
    if (row.source === "Other" && humans > 0) {
      out.push({
        episodeId: localId,
        statDate: row.statDate,
        source: "Website",
        botCount: 0,
        humanCount: humans,
        location: row.location,
      });
      if (bots > 0) {
        out.push({
          episodeId: localId,
          statDate: row.statDate,
          source: "Other",
          botCount: bots,
          humanCount: 0,
          location: row.location,
        });
      }
    } else {
      out.push({
        episodeId: localId,
        statDate: row.statDate,
        source: remapAudioSource(row.source, humans),
        botCount: bots,
        humanCount: humans,
        location: row.location,
      });
    }
  }
  return out;
}

function main() {
  const exportPath = process.argv[2];
  const podcastId = process.argv[3];
  if (!exportPath || !podcastId) {
    console.error(
      "Usage: tsx src/db/import-analytics-export.ts <export.json> <localPodcastId>",
    );
    process.exit(1);
  }

  const abs = resolve(process.cwd(), exportPath);
  const payload = JSON.parse(readFileSync(abs, "utf8")) as ExportPayload;
  const { startDate, endDate } = payload.meta;

  const podcast = db
    .prepare("SELECT id, title FROM podcasts WHERE id = ?")
    .get(podcastId) as { id: string; title: string } | undefined;
  if (!podcast) {
    console.error("Podcast not found:", podcastId);
    process.exit(1);
  }

  const localEps = db
    .prepare(
      "SELECT id, title FROM episodes WHERE podcast_id = ? ORDER BY COALESCE(publish_at, updated_at) DESC",
    )
    .all(podcastId) as Array<{ id: string; title: string }>;

  const localByNum = new Map<number, string>();
  for (const ep of localEps) {
    const n = episodeNumber(ep.title);
    if (n != null) localByNum.set(n, ep.id);
  }

  const episodeMap = new Map<string, string>();
  for (const ep of payload.episodes) {
    const n = episodeNumber(ep.title);
    if (n == null) {
      console.warn("Skip export episode (no #N):", ep.title);
      continue;
    }
    const localId = localByNum.get(n);
    if (!localId) {
      console.warn("No local episode for #", n, ep.title);
      continue;
    }
    episodeMap.set(ep.id, localId);
    console.log(`Map #${n}: ${ep.id} -> ${localId} (${ep.title})`);
  }

  if (episodeMap.size === 0) {
    console.error("No episodes mapped.");
    process.exit(1);
  }

  const localEpisodeIds = [...new Set(episodeMap.values())];
  const placeholders = localEpisodeIds.map(() => "?").join(",");

  const insertRss = db.prepare(`
    INSERT INTO podcast_stats_rss_daily (podcast_id, stat_date, source, bot_count, human_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(podcast_id, stat_date, source) DO UPDATE SET
      bot_count = excluded.bot_count,
      human_count = excluded.human_count
  `);
  const insertEpisodeDaily = db.prepare(`
    INSERT INTO podcast_stats_episode_daily (episode_id, stat_date, source, bot_count, human_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(episode_id, stat_date, source) DO UPDATE SET
      bot_count = excluded.bot_count,
      human_count = excluded.human_count
  `);
  const insertListens = db.prepare(`
    INSERT INTO podcast_stats_episode_listens_daily (episode_id, stat_date, source, bot_count, human_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(episode_id, stat_date, source) DO UPDATE SET
      bot_count = excluded.bot_count,
      human_count = excluded.human_count
  `);
  const insertLocation = db.prepare(`
    INSERT INTO podcast_stats_episode_location_daily (episode_id, stat_date, location, source, bot_count, human_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(episode_id, stat_date, location, source) DO UPDATE SET
      bot_count = excluded.bot_count,
      human_count = excluded.human_count
  `);
  const insertDedup = db.prepare(`
    INSERT OR IGNORE INTO podcast_stats_listen_dedup (episode_id, stat_date, client_key)
    VALUES (?, ?, ?)
  `);
  const insertRetention = db.prepare(`
    INSERT OR IGNORE INTO podcast_stats_retention_reach (episode_id, stat_date, bucket, client_key)
    VALUES (?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    db.prepare(
      "DELETE FROM podcast_stats_rss_daily WHERE podcast_id = ? AND stat_date >= ? AND stat_date <= ?",
    ).run(podcastId, startDate, endDate);
    db.prepare(
      `DELETE FROM podcast_stats_episode_daily WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`,
    ).run(...localEpisodeIds, startDate, endDate);
    db.prepare(
      `DELETE FROM podcast_stats_episode_listens_daily WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`,
    ).run(...localEpisodeIds, startDate, endDate);
    db.prepare(
      `DELETE FROM podcast_stats_episode_location_daily WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`,
    ).run(...localEpisodeIds, startDate, endDate);
    db.prepare(
      `DELETE FROM podcast_stats_listen_dedup WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`,
    ).run(...localEpisodeIds, startDate, endDate);
    db.prepare(
      `DELETE FROM podcast_stats_retention_reach WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`,
    ).run(...localEpisodeIds, startDate, endDate);

    for (const row of payload.rssDaily) {
      insertRss.run(
        podcastId,
        row.statDate,
        row.source,
        row.botCount,
        row.humanCount,
      );
    }

    const episodeDaily = aggregateCounts(
      expandOtherHumans(payload.episodeDaily, episodeMap),
      false,
    );
    for (const row of episodeDaily) {
      insertEpisodeDaily.run(
        row.episodeId,
        row.statDate,
        row.source,
        row.botCount,
        row.humanCount,
      );
    }

    const listens = aggregateCounts(
      expandOtherHumans(payload.episodeListensDaily, episodeMap),
      false,
    );
    for (const row of listens) {
      insertListens.run(
        row.episodeId,
        row.statDate,
        row.source,
        row.botCount,
        row.humanCount,
      );
    }

    const locations = aggregateCounts(
      expandOtherHumans(payload.episodeLocationDaily, episodeMap),
      true,
    );
    for (const row of locations) {
      insertLocation.run(
        row.episodeId,
        row.statDate,
        row.location ?? "Unknown",
        row.source,
        row.botCount,
        row.humanCount,
      );
    }

    // Unique listeners: one client key per human Download, with ~30% reuse
    // across days so period Unique < sum of daily Downloads.
    const returningPool = new Map<string, string[]>();
    for (const row of listens) {
      if (row.humanCount <= 0) continue;
      const pool = returningPool.get(row.episodeId) ?? [];
      for (let i = 0; i < row.humanCount; i++) {
        let key: string;
        if (pool.length > 0 && Math.random() < 0.3) {
          key = pool[i % pool.length];
        } else {
          key = clientKey(
            `${row.episodeId}|${row.statDate}|${row.source}|${i}|${Math.random()}`,
          );
          pool.push(key);
        }
        insertDedup.run(row.episodeId, row.statDate, key);
      }
      returningPool.set(row.episodeId, pool);
    }

    // Website retention: decaying decile reach for Website human Downloads.
    const RETENTION_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
    const RETENTION_PCT = [1, 0.92, 0.84, 0.76, 0.68, 0.58, 0.48, 0.38, 0.28, 0.18];
    for (const row of listens) {
      if (row.source !== "Website" || row.humanCount <= 0) continue;
      const starters = Math.max(1, row.humanCount);
      for (let s = 0; s < starters; s++) {
        const ck = clientKey(`ret|${row.episodeId}|${row.statDate}|${s}`);
        const maxBucketIdx = RETENTION_BUCKETS.findIndex(
          (_, bi) => Math.random() > RETENTION_PCT[bi],
        );
        const reachThrough =
          maxBucketIdx === -1 ? RETENTION_BUCKETS.length - 1 : Math.max(0, maxBucketIdx);
        for (let bi = 0; bi <= reachThrough; bi++) {
          insertRetention.run(
            row.episodeId,
            row.statDate,
            RETENTION_BUCKETS[bi],
            ck,
          );
        }
      }
    }
  });

  run();

  const listenHumans = db
    .prepare(
      `SELECT COALESCE(SUM(human_count), 0) AS n FROM podcast_stats_episode_listens_daily
       WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`,
    )
    .get(...localEpisodeIds, startDate, endDate) as { n: number };
  const unique = db
    .prepare(
      `SELECT COUNT(DISTINCT client_key) AS n FROM podcast_stats_listen_dedup
       WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`,
    )
    .get(...localEpisodeIds, startDate, endDate) as { n: number };
  const website = db
    .prepare(
      `SELECT COALESCE(SUM(human_count), 0) AS n FROM podcast_stats_episode_listens_daily
       WHERE episode_id IN (${placeholders}) AND source = 'Website'
         AND stat_date >= ? AND stat_date <= ?`,
    )
    .get(...localEpisodeIds, startDate, endDate) as { n: number };

  console.log(
    `Imported into ${podcast.title} (${podcastId}) for ${startDate}..${endDate}`,
  );
  console.log(
    `Downloads (human): ${listenHumans.n}, Unique listeners: ${unique.n}, Website Downloads: ${website.n}`,
  );
  closeDb();
}

main();
