import { db, closeDb } from "./index.js";

const DAYS = 30;
const LOCATIONS = [
  "United States",
  "United Kingdom",
  "Germany",
  "Canada",
  "Australia",
  "France",
  "Unknown",
];

function dateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last 30 days ending yesterday (YYYY-MM-DD). */
function last30Days(): string[] {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const dates: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(dateString(d));
  }
  return dates;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function main() {
  const podcastIdArg = process.argv[2];
  const dates = last30Days();
  const dateStart = dates[0];
  const dateEnd = dates[dates.length - 1];

  let podcasts: Array<{ id: string }>;
  if (podcastIdArg) {
    const row = db
      .prepare("SELECT id FROM podcasts WHERE id = ?")
      .get(podcastIdArg) as { id: string } | undefined;
    if (!row) {
      console.error("Podcast not found:", podcastIdArg);
      process.exit(1);
    }
    const hasEpisodes = db
      .prepare("SELECT 1 FROM episodes WHERE podcast_id = ? LIMIT 1")
      .get(podcastIdArg);
    if (!hasEpisodes) {
      console.error("Podcast has no episodes:", podcastIdArg);
      process.exit(1);
    }
    podcasts = [row];
  } else {
    podcasts = db
      .prepare(
        `SELECT DISTINCT p.id FROM podcasts p INNER JOIN episodes e ON e.podcast_id = p.id ORDER BY p.id`
      )
      .all() as Array<{ id: string }>;
    if (podcasts.length === 0) {
      console.log("No podcasts with episodes found.");
      closeDb();
      return;
    }
  }

  const insertRss = db.prepare(`
    INSERT INTO podcast_stats_rss_daily (podcast_id, stat_date, bot_count, human_count)
    VALUES (?, ?, ?, ?)
  `);
  const insertEpisodeDaily = db.prepare(`
    INSERT INTO podcast_stats_episode_daily (episode_id, stat_date, bot_count, human_count)
    VALUES (?, ?, ?, ?)
  `);
  const insertListens = db.prepare(`
    INSERT INTO podcast_stats_episode_listens_daily (episode_id, stat_date, bot_count, human_count)
    VALUES (?, ?, ?, ?)
  `);
  const insertLocation = db.prepare(`
    INSERT INTO podcast_stats_episode_location_daily (episode_id, stat_date, location, bot_count, human_count)
    VALUES (?, ?, ?, ?, ?)
  `);

  const getEpisodes = db.prepare(
    "SELECT id FROM episodes WHERE podcast_id = ? ORDER BY COALESCE(publish_at, updated_at) DESC"
  );

  for (const podcast of podcasts) {
    const pid = podcast.id;
    const episodes = getEpisodes.all(pid) as Array<{ id: string }>;
    const episodeIds = episodes.map((e) => e.id);

    const deleteRss = db.prepare(
      "DELETE FROM podcast_stats_rss_daily WHERE podcast_id = ? AND stat_date >= ? AND stat_date <= ?"
    );
    deleteRss.run(pid, dateStart, dateEnd);

    if (episodeIds.length > 0) {
      const placeholders = episodeIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM podcast_stats_episode_daily WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`
      ).run(...episodeIds, dateStart, dateEnd);
      db.prepare(
        `DELETE FROM podcast_stats_episode_listens_daily WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`
      ).run(...episodeIds, dateStart, dateEnd);
      db.prepare(
        `DELETE FROM podcast_stats_episode_location_daily WHERE episode_id IN (${placeholders}) AND stat_date >= ? AND stat_date <= ?`
      ).run(...episodeIds, dateStart, dateEnd);
    }

    const runInTransaction = db.transaction(() => {
      for (const statDate of dates) {
        insertRss.run(pid, statDate, randomInt(50, 400), randomInt(20, 200));
      }

      const numEpisodes = episodeIds.length;
      for (let ei = 0; ei < numEpisodes; ei++) {
        const episodeId = episodeIds[ei];
        const dayScale = 1 - (ei / Math.max(numEpisodes, 1)) * 0.6;
        for (const statDate of dates) {
          const reqHuman = Math.max(0, Math.floor(randomInt(0, 80) * dayScale));
          const reqBot = Math.max(0, Math.floor(randomInt(0, 30) * dayScale));
          insertEpisodeDaily.run(episodeId, statDate, reqBot, reqHuman);
          const listenHuman = Math.min(reqHuman, randomInt(0, 50));
          const listenBot = Math.min(reqBot, randomInt(0, 20));
          insertListens.run(episodeId, statDate, listenBot, listenHuman);

          const numLocs = randomInt(1, 4);
          const shuffled = [...LOCATIONS].sort(() => Math.random() - 0.5);
          for (let li = 0; li < numLocs; li++) {
            const loc = shuffled[li];
            const locHuman = randomInt(1, 40);
            const locBot = randomInt(0, 10);
            insertLocation.run(episodeId, statDate, loc, locBot, locHuman);
          }
        }
      }
    });

    runInTransaction();
    console.log(
      `Seeded podcast ${pid}, ${episodeIds.length} episodes, ${DAYS} days (${dateStart} .. ${dateEnd}).`
    );
  }

  closeDb();
}

main();
