/**
 * Clear stored max_episodes on podcasts so they use the owner's current limit.
 * Previously we copied the user's max_episodes at creation time, so when the user
 * updated their limit, old podcasts still showed the old value. NULL = use owner's limit.
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(
    `UPDATE podcasts SET max_episodes = NULL WHERE max_episodes IS NOT NULL;`,
  );
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // Cannot restore previous per-podcast values; migration is one-way.
};
