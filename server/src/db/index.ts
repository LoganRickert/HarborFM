import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'harborfm.db');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

ensureDataDir();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function closeDb() {
  db.close();
}
