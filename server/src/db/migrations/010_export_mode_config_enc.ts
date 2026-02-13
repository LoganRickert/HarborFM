/**
 * Add encrypted config for non-S3 modes (FTP/SFTP/WebDAV/IPFS/SMB).
 * No-op if config_enc already exists (e.g. 001_initial was updated to include it).
 */
export const up = (db: {
  exec: (sql: string) => void;
  prepare: (sql: string) => { all: () => { name: string }[] };
}) => {
  const cols = (
    db.prepare("PRAGMA table_info(exports)").all() as { name: string }[]
  ).map((r) => r.name);
  if (!cols.includes("config_enc")) {
    db.exec(`ALTER TABLE exports ADD COLUMN config_enc TEXT`);
  }
};

export const down = (_db: { exec: (sql: string) => void }) => {};
