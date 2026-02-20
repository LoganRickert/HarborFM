/**
 * Add video_final_path column to episodes. Path relative to data dir (e.g. processed/{podcastId}/{episodeId}/video.mp4).
 */
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`ALTER TABLE episodes ADD COLUMN video_final_path TEXT;`);
};

export const down = (_db: { exec: (sql: string) => void }) => {
  // SQLite does not support DROP COLUMN easily; leave column in place on rollback.
};
