/**
 * Seed script: create a podcast and add 100 episodes with cast.
 * Adds 2 hosts and 60 guests to the podcast; each episode gets 1-2 hosts and 2-20 guests assigned.
 * Requires setup to be complete (at least one user exists).
 * Usage: pnpm run db:seed-podcast-episodes [owner_user_id]
 *   If owner_user_id is omitted, uses the first user.
 */
import "dotenv/config";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";
import { db, closeDb } from "./index.js";

const EPISODE_COUNT = 100;
const HOST_COUNT = 2;
const GUEST_COUNT = 60;

const FIRST_NAMES = [
  "Alex", "Jordan", "Sam", "Taylor", "Morgan", "Casey", "Riley", "Quinn",
  "Avery", "Reese", "Dakota", "Skyler", "Jamie", "Parker", "Finley", "Emerson",
  "Blake", "Cameron", "Drew", "Hayden", "Kendall", "Logan", "Phoenix", "River",
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function main() {
  const ownerArg = process.argv[2];
  let ownerUserId: string;

  if (ownerArg) {
    const row = db
      .prepare("SELECT id FROM users WHERE id = ?")
      .get(ownerArg) as { id: string } | undefined;
    if (!row) {
      console.error("User not found:", ownerArg);
      process.exit(1);
    }
    ownerUserId = row.id;
  } else {
    const row = db
      .prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string } | undefined;
    if (!row) {
      console.error("No users found. Complete setup first (pnpm run dev, then visit /setup).");
      process.exit(1);
    }
    ownerUserId = row.id;
  }

  const slugBase = `seed-podcast-${Date.now()}`;
  let slug = slugBase;
  let counter = 1;
  while (db.prepare("SELECT id FROM podcasts WHERE owner_user_id = ? AND slug = ?").get(ownerUserId, slug)) {
    slug = `${slugBase}-${counter}`;
    counter++;
  }

  const podcastId = nanoid();
  const podcastGuid = randomUUID();

  db.prepare(
    `INSERT INTO podcasts (
      id, owner_user_id, title, slug, description, subtitle, summary, language, author_name, owner_name,
      email, category_primary, category_secondary, category_primary_two, category_secondary_two,
      category_primary_three, category_secondary_three, explicit, site_url, artwork_url,
      copyright, podcast_guid, locked, license, itunes_type, medium,
      funding_url, funding_label, persons, update_frequency_rrule, update_frequency_label,
      spotify_recent_count, spotify_country_of_origin, apple_podcasts_verify, max_episodes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    podcastId,
    ownerUserId,
    "Seed Podcast",
    slug,
    "A podcast created by the seed script with 100 episodes.",
    null,
    null,
    "en",
    "Seed Author",
    "Seed Author",
    "",
    "",
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
    null,
    podcastGuid,
    0,
    null,
    "episodic",
    "podcast",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );

  console.log(`Created podcast ${podcastId} (slug: ${slug})`);

  const insertCast = db.prepare(
    `INSERT INTO podcast_cast (id, podcast_id, name, role, description, is_public)
     VALUES (?, ?, ?, ?, ?, 1)`,
  );
  const hostIds: string[] = [];
  const guestIds: string[] = [];

  for (let i = 0; i < HOST_COUNT; i++) {
    const id = nanoid();
    insertCast.run(id, podcastId, `Host ${FIRST_NAMES[i % FIRST_NAMES.length]}`, "host", null);
    hostIds.push(id);
  }
  for (let i = 0; i < GUEST_COUNT; i++) {
    const id = nanoid();
    const name = `Guest ${FIRST_NAMES[(i + HOST_COUNT) % FIRST_NAMES.length]} ${Math.floor(i / FIRST_NAMES.length) + 1}`;
    insertCast.run(id, podcastId, name, "guest", null);
    guestIds.push(id);
  }
  console.log(`Added ${HOST_COUNT} hosts and ${GUEST_COUNT} guests`);

  const insertEpisodeCast = db.prepare(
    `INSERT INTO episode_cast (episode_id, cast_id) VALUES (?, ?)`,
  );

  const urnNamespace = "harborfm";
  const insertEpisode = db.prepare(
    `INSERT INTO episodes (
      id, podcast_id, title, description, subtitle, summary, content_encoded, slug, guid, season_number, episode_number,
      episode_type, explicit, publish_at, status, artwork_url, episode_link, guid_is_permalink
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const runInTransaction = db.transaction(() => {
    for (let i = 1; i <= EPISODE_COUNT; i++) {
      const episodeId = nanoid();
      const title = `Episode ${i}`;
      const slugBase = slugify(title) || `episode-${i}`;
      let episodeSlug = slugBase;
      let slugCounter = 1;
      while (
        db.prepare("SELECT id FROM episodes WHERE podcast_id = ? AND slug = ?").get(podcastId, episodeSlug)
      ) {
        episodeSlug = `${slugBase}-${slugCounter}`;
        slugCounter++;
      }
      const guid = `urn:${urnNamespace}:episode:${episodeId}`;

      insertEpisode.run(
        episodeId,
        podcastId,
        title,
        `Description for episode ${i}.`,
        null,
        null,
        null,
        episodeSlug,
        guid,
        null,
        i,
        null,
        null,
        new Date(Date.now() - (EPISODE_COUNT - i) * 24 * 60 * 60 * 1000).toISOString(),
        "published",
        null,
        null,
        0,
      );

      const numHosts = randomInt(1, Math.min(2, hostIds.length));
      const numGuests = randomInt(2, Math.min(20, guestIds.length));
      const assignedHosts = pickRandom(hostIds, numHosts);
      const assignedGuests = pickRandom(guestIds, numGuests);
      for (const castId of [...assignedHosts, ...assignedGuests]) {
        insertEpisodeCast.run(episodeId, castId);
      }
    }
  });

  runInTransaction();
  console.log(`Added ${EPISODE_COUNT} episodes to podcast ${podcastId}`);
  closeDb();
}

main();
