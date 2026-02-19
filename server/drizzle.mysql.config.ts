/// <reference types="node" />
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for MySQL push");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/drizzle-migrations",
  dialect: "mysql",
  dbCredentials: { url },
});
