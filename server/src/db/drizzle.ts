import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { getDataDir } from "../services/paths.js";
import { DB_FILENAME } from "../config.js";
import * as schema from "./schema.js";

const DB_PATH = join(getDataDir(), DB_FILENAME);

function ensureDataDir() {
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}
ensureDataDir();

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const drizzleDb = drizzle(sqlite, { schema });
export type DrizzleDb = typeof drizzleDb;
