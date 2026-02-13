import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { getDataDir } from "../services/paths.js";
import { DB_FILENAME } from "../config.js";

const DB_PATH = join(getDataDir(), DB_FILENAME);

function ensureDataDir() {
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

ensureDataDir();

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function closeDb() {
  db.close();
}
