/// <reference types="node" />
import { defineConfig } from "drizzle-kit";
import { join, resolve } from "path";

// Use env or fallback so drizzle-kit works before app build. Match config.ts defaults.
const dataDir = resolve(process.env.DATA_DIR ?? join(process.cwd(), "data"));
const dbFilename = process.env.DB_FILENAME?.trim() || "harborfm.db";
const dbPath = join(dataDir, dbFilename);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/drizzle-migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${dbPath}`,
  },
});
