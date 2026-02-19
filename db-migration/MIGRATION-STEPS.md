# Drizzle ORM Migration Steps

Staged migration from raw `better-sqlite3` to Drizzle ORM, supporting both SQLite and MySQL.

**Strategy:** Keep existing migrations and `migrate.ts` for SQLite. For MySQL, use a **schema-first bootstrap** (create tables from Drizzle schema) until migrations are unified. Add Drizzle as the query layer. Convert modules incrementally. The raw `db` export remains until all consumers are migrated.

All dates should be stored as UTC. We are now using camelCasing. Don't worry about anything in the web directory, only shared and server. We will fix the web after everything else

---

## Cross-Cutting Concerns (Start in Part 2, Use Everywhere)

### Timestamps: Use `sqlNow()` from day one

**Do not** put `datetime('now')` directly in the schema or queries. Define a helper in `server/src/db/utils.ts`:

```ts
import { sql } from "drizzle-orm";
import { DB_PROVIDER } from "../config.js";

/** Dialect-aware "current timestamp" for defaults and updates. */
export function sqlNow() {
  return DB_PROVIDER === "mysql"
    ? sql`CURRENT_TIMESTAMP`
    : sql`datetime('now')`;
}
```

Use `default(sqlNow())` for `created_at`/`updated_at` in schema. Use `sqlNow()` in application code for ad-hoc updates. This avoids touching every table again when adding MySQL.

### Upsert semantics audit

`INSERT OR REPLACE` (SQLite) ≠ MySQL `INSERT ... ON DUPLICATE KEY UPDATE`. Decide the intended behavior for each case:

| Location | Table | Behavior | Drizzle approach |
|----------|-------|----------|------------------|
| settings/routes.ts, setup/routes.ts, setup.ts, ssoProviderSettings.ts, seed-setup.ts | settings | Update value and updated_at when key exists | `onConflictDoUpdate` (update `value`, `updated_at`) |
| samlCache.ts | sso_saml_cache | Update value and created_at when request_id exists | `onConflictDoUpdate` (update `value`, `created_at`) |

Use `insert().onConflictDoUpdate({ target: [...], set: {...} })` explicitly so semantics are clear. Do **not** use raw `INSERT OR REPLACE`.

### Unique / collation (email, username)

SQLite uses `COLLATE NOCASE` on `users.email` and `users.username` (migration 040). App code also uses `LOWER(email)` / `LOWER(username)` in `WHERE` clauses.

For MySQL: use `utf8mb4_0900_ai_ci` (or similar case-insensitive collation) on these columns so `UNIQUE` enforces case-insensitive uniqueness. In the Drizzle schema, specify `collate: "utf8mb4_0900_ai_ci"` for MySQL when defining those columns. For SQLite, `NOCASE` remains. Drizzle allows dialect-specific column options.

Alternative: enforce case-insensitivity purely in app (canonicalize to lowercase before insert/query). Document the chosen approach in Part 2.

### Naming: camelCase in application, snake_case only in DB

**Standardize on one convention** so we don't maintain both snake_case and camelCase.

- **Database columns:** Stay `snake_case`. SQL convention; do not rename columns (would require a large migration and break tooling).
- **Drizzle schema:** Use camelCase property names. The schema maps columns: `twoFactorMethod: text("two_factor_method")` — TS gets camelCase, DB stays snake_case.
- **Application code:** Use camelCase everywhere. Do **not** alias Drizzle output to snake_case (e.g. `owner_user_id: podcasts.ownerUserId`). Let Drizzle return camelCase.
- **API responses:** Use camelCase. Update frontend to consume camelCase when converting each module. Do both in the same PR to avoid dual maintenance.
- **When converting a module:** Remove any `snake_case: schema.camelCase` aliases. Use the schema's natural property names. Update route handlers and frontend consumers together.

**Files to update as part of conversion:** `modules/podcasts/repo.ts` (remove snake_case aliases, use camelCase), any route that returns podcast/episode/user shapes, and the corresponding web `api/*` + components that consume those fields.

---

## Part 1: Project Setup

**Goal:** Add Drizzle dependencies and tooling. No behavior change.

**Estimated time:** 30 minutes

### Steps

1. **Add dependencies** in `server/package.json`:

   ```bash
   cd server
   pnpm add drizzle-orm
   pnpm add -D drizzle-kit
   ```

   Do *not* add `mysql2` yet; that comes in Part 3.

2. **Create Drizzle config** at `server/drizzle.config.ts`:

   ```ts
   import { defineConfig } from "drizzle-kit";
   import { join } from "path";
   import { getDataDir } from "./src/services/paths.js";
   import { DB_FILENAME } from "./src/config.js";

   const dbPath = join(getDataDir(), DB_FILENAME);

   export default defineConfig({
     schema: "./src/db/schema.ts",
     out: "./src/db/drizzle-migrations",
     dialect: "sqlite",
     dbCredentials: {
       url: `file:${dbPath}`,
     },
   });
   ```

   Note: `getDataDir()` resolves at runtime. For `drizzle-kit` commands that run before app startup, ensure `DATA_DIR` is set or use a default (e.g. `./data`). You may need to adjust `dbPath` for CLI usage.

3. **Add npm scripts** in `server/package.json`:

   ```json
   "db:studio": "drizzle-kit studio",
   "db:generate": "drizzle-kit generate"
   ```

4. **Verify:** After Part 2, `pnpm run db:generate` runs without error. For Part 1 alone, `pnpm run db:studio` will fail until the schema exists—that’s expected.

5. **Checkpoint:** Commit with message: `db-migration: Part 1 - add Drizzle deps and config`.

---

## Part 2: Schema Definition

**Goal:** Define the full Drizzle schema matching the current database. Schema is the single source of truth for Drizzle; migrations remain in place for now.

**Estimated time:** 2–4 hours

### Steps

1. **Create** `server/src/db/schema.ts`.

2. **Define tables** by consolidating from migrations `001_initial` through `050_auth_2fa_totp_secret_hash`. Use Drizzle SQLite types initially.

   Reference the following tables (from migrations):

   - `users` — 001 + 003, 004, 006, 008, 016, 025, 027, 028, 037, 040, 045, 046, 047, 048
   - `podcasts` — 001 + 004, 019, 020, 022, 026, 027, 031, 032, 033
   - `episodes` — 001 + 005, 020, 021, 023, 034, 035, 036
   - `exports` — 001 + 009, 010, 011
   - `export_runs` — 001
   - `reusable_assets` — 001
   - `episode_segments` — 001 + 034, 035
   - `settings` — 001
   - `login_attempts` — 001
   - `ip_bans` — 001
   - `podcast_stats_*` — 002 (rss_daily, episode_daily, episode_location_daily, episode_listens_daily, listen_dedup)
   - `platform_invites` — 017
   - `podcast_shares` — 015
   - `contact_messages` — 013, 014
   - `api_keys` — 012, 029, 030
   - `password_reset_tokens` — 007, 038
   - `user_identities` — 040
   - `sso_oauth_state` — 041, 042
   - `sso_saml_state` — 043
   - `sso_saml_cache` — 044
   - `user_otp_codes`, `auth_2fa_challenges`, `user_totp_attempts` — 037, 050
   - `password_reset_totp_attempts` — 049
   - `forgot_password_attempts` — 018
   - `subscriber_tokens` — 024, 025
   - `podcast_cast`, `episode_cast` — 033
   - And any others added in migrations

3. **Create** `server/src/db/utils.ts` before schema (needed by schema):
   - `sqlNow()` — returns dialect-appropriate timestamp SQL (see Cross-Cutting Concerns).
   - For Part 2, `DB_PROVIDER` is still sqlite-only; `sqlNow()` can return `sql\`datetime('now')\``.
   - `isUniqueViolation(err: unknown): boolean` — for later; checks `SQLITE_CONSTRAINT` / `ER_DUP_ENTRY`.

4. **Use types and defaults consistently:**
   - `text()`, `integer()`, `real()`
   - `primaryKey()`, `unique()`, `notNull()`
   - **Never** `default(sql\`datetime('now')\`)`; use `default(sqlNow())` from `./utils.js` for all `created_at` / `updated_at`.

5. **Unique / collation:** For `users.email` and `users.username`, ensure case-insensitive uniqueness. In schema, use SQLite `collate("nocase")` where supported; when adding MySQL (Part 3 bootstrap), use `utf8mb4_0900_ai_ci` for those columns so behavior matches.

6. **Define relations** with `relations()` for tables you plan to use with Drizzle queries (optional; can add as needed).

7. **Export** all table definitions and relations from `schema.ts`.

8. **Verify:** Run `pnpm run db:generate` and confirm no errors. Optionally run `pnpm run db:studio` and inspect the schema.

9. **Checkpoint:** Commit with message: `db-migration: Part 2 - add Drizzle schema`.

---

## Part 3: Drizzle Client, Config, and MySQL Bootstrap Path

**Goal:** Create a Drizzle client that works alongside the existing `db`. Add config and a **MySQL schema bootstrap path** so Part 10 does not stall. SQLite continues to use `migrate.ts`; MySQL uses schema-first (create tables from Drizzle schema).

**Estimated time:** 1.5–2 hours

### Steps

1. **Add config** in `server/src/config.ts`:

   ```ts
   /** Database provider: sqlite (default) or mysql. Env: DB_PROVIDER */
   export const DB_PROVIDER =
     (process.env.DB_PROVIDER?.trim()?.toLowerCase() as "sqlite" | "mysql") || "sqlite";

   /** MySQL connection URL. Required when DB_PROVIDER=mysql. Env: DATABASE_URL */
   export const DATABASE_URL = process.env.DATABASE_URL?.trim() || null;
   ```

2. **Add `mysql2`** (needed for MySQL bootstrap and Part 10): `pnpm add mysql2`

3. **Create** `server/src/db/drizzle.ts`:
   - For now, only SQLite: use `drizzle-orm/better-sqlite3` with the same `db` path as `index.ts`.
   - Export `drizzleDb` and `DrizzleDb` type.
   - Part 10 will add the MySQL branch.

4. **Update** `server/src/db/utils.ts`: Make `sqlNow()` respect `DB_PROVIDER` (return `CURRENT_TIMESTAMP` for MySQL, `datetime('now')` for SQLite).

5. **MySQL schema bootstrap:**
   - Create `server/drizzle.mysql.config.ts` (or add a `--dialect mysql` path to the main config):
     - `dialect: "mysql"`
     - `dbCredentials: { url: process.env.DATABASE_URL }`
     - Same `schema` and `out` as SQLite config.
   - Add script: `"db:push-mysql": "drizzle-kit push --config=drizzle.mysql.config.ts"`
   - Document: **For MySQL deployments, `migrate.ts` does not run** (those migrations are SQLite raw SQL). Instead, run `pnpm run db:push-mysql` before first app start to create tables from the Drizzle schema. Optionally add a startup check: if `DB_PROVIDER=mysql` and critical tables are missing, log a warning and exit with instructions to run `db:push-mysql`.

6. **Optional: programmatic bootstrap** — If you prefer the app to self-bootstrap on first MySQL run, add a small `bootstrapMySQL()` that uses Drizzle’s migration API or shell out to `drizzle-kit push`. Call it once at startup when `DB_PROVIDER=mysql`.

7. **Update** `server/src/db/index.ts`: Add `export { drizzleDb } from "./drizzle.js";`

8. **Verify:** App starts on SQLite; `import { drizzleDb } from "../db/index.js"` works. With `DB_PROVIDER=mysql` and `DATABASE_URL` set, `pnpm run db:push-mysql` creates tables (test in a disposable MySQL instance).

9. **Checkpoint:** Commit with message: `db-migration: Part 3 - add Drizzle client, config, MySQL bootstrap path`.

---

## Part 4: Pilot Conversion — Podcasts Repo

**Goal:** Convert `modules/podcasts/repo.ts` to use Drizzle. Validate the approach.

**Estimated time:** 1–2 hours

### Steps

1. **Update** `server/src/modules/podcasts/repo.ts`:
   - Replace `import { db } from "../../db/index.js"` with `import { drizzleDb } from "../../db/index.js"`.
   - Convert each query:
     - `db.prepare("SELECT ...").get()` → `drizzleDb.select().from(...).where(...).limit(1)` or `drizzleDb.query.*.findFirst()`
     - `db.prepare("SELECT ...").all()` → `drizzleDb.select()...` or `drizzleDb.query.*.findMany()`

2. **Handle** `PODCAST_LIST_SELECT` — a large SELECT with subqueries. Options:
   - Use `drizzleDb.execute(sql\`...\`)` for this query (raw SQL via Drizzle).
   - Or break into schema-based selects + application-level joins if preferred.

3. **Use camelCase:** Do not alias to snake_case. Use Drizzle's natural output (`ownerUserId`, `createdAt`, etc.). Update API route handlers and frontend consumers to expect camelCase (see Cross-Cutting: Naming).

4. **Test:** Run e2e tests or manual checks for podcast list, get-by-id, share role, etc.

4. **Checkpoint:** Commit with message: `db-migration: Part 4 - convert podcasts repo to Drizzle`.

---

## Lessons Learned so far (from Part 4)

Before converting more files, apply these patterns from the podcasts repo conversion:

- **Aggregations:** Prefer a single LEFT JOIN to a derived table (`SELECT ... GROUP BY`) instead of a correlated subquery per row. Example: `episode_count` — join `(SELECT podcast_id, count(*) as cnt FROM episodes GROUP BY podcast_id)` once rather than `(SELECT COUNT(*) FROM episodes WHERE podcast_id = podcasts.id)` in every row.
- **Boolean/number types:** SQLite `integer` with `mode: "boolean"` returns `boolean`, but APIs often expect 0/1. Normalize at the boundary with `sql<number>\`COALESCE(${col}, 0)\`.as("col")` so consumers get consistent `number`.
- **Timestamps:** SQLite `text` columns return ISO datetime strings. Keep `created_at`/`updated_at` typed as `string` and document with `/** ISO datetime string from SQLite text column */` if needed. Don't mix `Date` and `string` without explicit conversion.
- **Join duplicates:** When joining through a junction table (e.g. `podcast_shares`), duplicates are possible unless there's a unique constraint. Verify `UNIQUE(podcast_id, user_id)` (or equivalent), or add `DISTINCT`/`GROUP BY` in the query.
- **Return contracts:** For lookup helpers (e.g. `getArtworkPath(id)`), document the meaning: `undefined` = not found, `null` = found but no value, `string` = the value. Keep callers consistent.
- **Avoid index signatures:** Don't add `[key: string]: unknown` to row types to satisfy `Record<string, unknown>`. Use generic helpers instead (e.g. `podcastRowWithFilename<T extends { artworkPath?: string | null }>(row: T)`) and cast `as Record<string, unknown>` only at the specific callsite where needed (e.g. `delete`).
- **Naming:** Use camelCase in row types and selects. Do not alias to snake_case (see Cross-Cutting: Naming).

---

## Part 5: Auth and Access

**Goal:** Convert auth plugin, access service, and auth route modules to Drizzle.

**Estimated time:** 3–4 hours

### Files to convert

- `server/src/plugins/auth.ts` — API key lookup, last_used_at update
- `server/src/services/access.ts` — Role check
- `server/src/modules/auth/routes.login.ts`
- `server/src/modules/auth/routes.register.ts`
- `server/src/modules/auth/routes.session.ts`
- `server/src/modules/auth/routes.completeAccount.ts`
- `server/src/modules/auth/routes.passwordReset.ts`
- `server/src/modules/auth/routes.invite.ts`
- `server/src/modules/auth/routes.apiKeys.ts`
- `server/src/modules/auth/routes.twoFactorLogin.ts`
- `server/src/modules/auth/routes.twoFactorProfile.ts`
- `server/src/modules/auth/routes.profileUpdate.ts`
- `server/src/modules/auth/routes.sso.ts`

### Steps

1. **Ensure** `server/src/db/utils.ts` has `sqlNow()` and `isUniqueViolation()` (from Part 2/3). Use them consistently.

2. **Convert** `plugins/auth.ts`:
   - API key lookup by `key_hash`.
   - Update `last_used_at` on valid key using `sqlNow()`.

3. **Convert** `services/access.ts`:
   - Single `SELECT role FROM users WHERE id = ?`.

4. **Convert auth routes** in logical order:
   - `routes.login.ts` — user lookup, password check, last_login update.
   - `routes.register.ts` — insert user, optional verification, last_login.
   - `routes.session.ts` — validate session (may not touch DB much).
   - `routes.completeAccount.ts` — user update.
   - `routes.passwordReset.ts` — token CRUD, user update.
   - `routes.invite.ts` — platform_invites, users.
   - `routes.apiKeys.ts` — api_keys CRUD.
   - `routes.twoFactorLogin.ts`, `routes.twoFactorProfile.ts` — 2FA challenges, OTP codes, TOTP attempts.
   - `routes.profileUpdate.ts` — users, pending_email, verification.
   - `routes.sso.ts` — user_identities, sso_oauth_state, sso_saml_state.

5. **Replace** `datetime('now')` with `sqlNow()` everywhere.

6. **Replace** `INSERT OR REPLACE` with Drizzle `insert().onConflictDoUpdate()` per the Upsert semantics audit (settings = update value + updated_at; sso_saml_cache = update value + created_at). Use explicit `target` and `set` so behavior is clear.

7. **Email/username uniqueness:** App code uses `LOWER(email)` / `LOWER(username)` in WHERE. Ensure inserts and updates canonicalize before DB write, or rely on DB collation (see Cross-Cutting Concerns). Keep behavior consistent across SQLite and MySQL.

8. **Apply Lessons Learned:** Normalize `users.disabled`, `users.read_only`, `users.email_verified` etc. at the query boundary (COALESCE to 0/1) if consumers expect numbers. Type row interfaces without index signatures; use `as Record<string, unknown>` only where needed for dynamic keys. For lookup helpers (e.g. API key by hash), document the return contract (undefined vs null).

9. **Test:** Auth flows (login, register, 2FA, password reset, SSO), access checks.

10. **Checkpoint:** Commit with message: `db-migration: Part 5 - convert auth and access to Drizzle`.

---

## Part 6: Podcast Module (Routes)

**Goal:** Convert podcast route modules to Drizzle. Apply Lessons Learned (above) for aggregations, type normalization, and row types.

**Estimated time:** 2–3 hours

### Files to convert

- `server/src/modules/podcasts/routes.core.ts`
- `server/src/modules/podcasts/routes.collaborators.ts`
- `server/src/modules/podcasts/routes.cast.ts`
- `server/src/modules/podcasts/routes.artwork.ts`
- `server/src/modules/podcasts/routes.delete.ts`
- `server/src/modules/podcasts/routes.tokens.ts`
- `server/src/modules/podcasts/deleteTask.ts`
- `server/src/modules/podcasts/service.ts`

### Steps

1. Replace `db` imports with `drizzleDb`.
2. Convert dynamic `UPDATE podcasts SET ${fields.join(", ")}` to Drizzle’s `update().set()` with an object built from changed fields.
3. Convert `podcast_cast`, `episode_cast` CRUD in routes.cast.
4. Convert collaborator (podcast_shares) CRUD in routes.collaborators.
5. Convert deleteTask’s cascading deletes — may use raw `sql` for multi-table deletes, or explicit per-table deletes.
6. **Test:** Create/edit/delete podcasts, collaborators, cast, tokens.
7. **Checkpoint:** Commit with message: `db-migration: Part 6 - convert podcast routes to Drizzle`.

---

## Part 7: Episodes, Segments, Exports, Library

**Goal:** Convert episode, segment, export, and library modules. Apply Lessons Learned.

**Estimated time:** 4–5 hours

### Files to convert

- `server/src/modules/episodes/routes.ts`
- `server/src/modules/segments/routes.ts`
- `server/src/modules/exports/routes.ts`
- `server/src/modules/library/routes.ts`
- `server/src/modules/audio/routes.ts`
- `server/src/services/segmentFromRecording.ts`

### Steps

1. Convert episodes CRUD — create, update, delete, list.
2. Convert episode_cast linkage in episodes.
3. Convert segment routes (likely the most complex — many queries).
4. Convert exports and export_runs.
5. Convert reusable_assets (library) and disk_bytes_used updates.
6. Convert segmentFromRecording.
7. **Test:** Episodes, segments, library assets, exports.
8. **Checkpoint:** Commit with message: `db-migration: Part 7 - convert episodes, segments, exports, library to Drizzle`.

---

## Part 8: Settings, SSO, and Services

**Goal:** Convert settings, SSO providers, and remaining services. Apply Lessons Learned.

**Estimated time:** 2–3 hours

### Files to convert

- `server/src/modules/settings/routes.ts`
- `server/src/services/ssoProviderSettings.ts`
- `server/src/services/sso.ts`
- `server/src/services/loginAttempts.ts`
- `server/src/services/setup.ts`
- `server/src/services/samlCache.ts`
- `server/src/services/subscriberTokens.ts`
- `server/src/services/podcastStats.ts`
- `server/src/services/rss.ts`
- `server/src/services/sitemap.ts`
- `server/src/services/websub.ts`
- `server/src/services/dns/custom-domain-resolver.ts`
- `server/src/services/dns/update-task.ts`
- `server/src/modules/setup/routes.ts`
- `server/src/modules/import/routes.ts`
- `server/src/modules/call/routes.internal.ts`
- `server/src/modules/call/routes.lifecycle.ts`
- `server/src/modules/call/wsHandlers.ts`
- `server/src/modules/contact/routes.ts`
- `server/src/modules/messages/routes.ts`
- `server/src/modules/bans/routes.ts`
- `server/src/modules/users/routes.ts`
- `server/src/modules/sitemap/routes.ts`
- `server/src/modules/rss/routes.ts` (if it touches DB)

### Steps

1. Convert settings — heavy use of `INSERT OR REPLACE`; use `onConflictDoUpdate`.
2. Convert ssoProviderSettings, sso, samlCache.
3. Convert loginAttempts (login_attempts, ip_bans).
4. Convert setup, subscriberTokens, podcastStats.
5. Convert rss, sitemap, websub — often read-heavy; ensure cache behavior is unchanged.
6. Convert import, call, contact, messages, bans, users.
7. **Test:** Settings, SSO, login rate limiting, stats flush, RSS, sitemap.
8. **Checkpoint:** Commit with message: `db-migration: Part 8 - convert settings, SSO, services to Drizzle`.

---

## Part 9: Scripts and Maintenance

**Goal:** Convert scripts and db maintenance utilities. Apply Lessons Learned.

**Estimated time:** 1–2 hours

### Files to convert

- `server/src/db/migrate.ts` — keep migrations; migrate.ts can stay on raw `db` since it runs migrations. Or switch migration internals to use Drizzle for the `_migrations` table if desired (optional).
- `server/src/db/clear-stale-2fa.ts`
- `server/src/db/clear-ip-bans.ts`
- `server/src/db/seed-podcast-with-episodes.ts`
- `server/src/db/seed-analytics.ts`
- `server/src/db/reset-first-user-password.ts`
- `server/src/scripts/seed-setup.ts`
- `server/src/scripts/send-seed-admin-welcome.ts`
- `server/src/scripts/add-sso-provider.ts`

### Steps

1. Convert clear-stale-2fa, clear-ip-bans to use Drizzle.
2. Convert seed scripts — use `drizzleDb.transaction()` for transactional seeds.
3. Convert standalone scripts (seed-setup, send-seed-admin-welcome, add-sso-provider).
4. **Optional:** If migrate.ts should use Drizzle for `_migrations`, do that last. Otherwise leave migrate.ts on raw `db`; it’s isolated.
5. **Test:** Run each script manually.
6. **Checkpoint:** Commit with message: `db-migration: Part 9 - convert scripts and maintenance to Drizzle`.

---

## Plan: Part 9 Execution + E2E Fixes + Shared Zod camelCase

**Scope:** Execute Part 9 (scripts/maintenance → Drizzle), fix all e2e tests, and ensure **shared** Zod schemas use **camelCase** only. **Do not edit the `web/` folder** in this pass.

### A. Shared Zod → camelCase (single source of truth)

All `shared/src/schemas/*.ts` must use camelCase property names. No snake_case keys.

| File | Snake_case keys to convert to camelCase |
|------|----------------------------------------|
| `episode.ts` | `content_encoded`, `season_number`, `episode_number`, `episode_type`, `publish_at`, `artwork_url`, `episode_link`, `guid_is_permalink`, `subscriber_only`, `final_markers`; response: `podcast_id`, `content_encoded`, `season_number`, `episode_number`, `episode_type`, `publish_at`, `artwork_path`, `artwork_url`, `artwork_filename`, `audio_source_path`, `audio_final_path`, `audio_mime`, `audio_bytes`, `audio_duration_sec`, `episode_link`, `guid_is_permalink`, `created_at`, `updated_at`, `has_transcript`, `subscriber_only`, `final_markers` |
| `segment.ts` | `segment_ids`, `reusable_asset_id`, `trim_ranges`, `marker_type`, `start_sec`, `end_sec`, `threshold_seconds`, `silence_threshold`; response: `episode_id`, `reusable_asset_id`, `asset_name`, `audio_path`, `duration_sec`, `created_at`, `waveform_exists`, `in_progress`, `record_failed`, `trim_ranges`, `markers` |
| `export.ts` | `endpoint_url`, `access_key_id`, `secret_access_key`, `public_base_url`, `private_key`, `api_url`, `api_key`, `gateway_url` (in create/update schemas) |
| `settings.ts` | All keys in `settingsPatchBodySchema` and test bodies (e.g. `whisper_asr_url`, `transcription_provider`, `openai_transcription_url`, …, `dns_use_cname`, `dns_a_record_ip`, `sso_oidc_providers`, `sso_saml_providers`, etc.) |
| `public.ts` | `author_name`, `artwork_url`, `site_url`, `created_at`, `subscriber_only_feed_enabled`, `public_feed_disabled`, `canonical_feed_url`, `apple_podcasts_url`, …; episode: `podcast_id`, `season_number`, `episode_number`, `episode_type`, `publish_at`, `artwork_url`, `audio_mime`, `audio_bytes`, `audio_duration_sec`, `subscriber_only`, `created_at`, `updated_at`, `private_audio_url`, etc.; config: `public_feeds_enabled`, `custom_feed_slug`, `gdpr_consent_banner_enabled`, `webrtc_enabled` |
| `library.ts` | `owner_user_id`, `duration_sec`, `created_at`, `global_asset` |
| `setup.ts` | `registration_enabled`, `public_feeds_enabled`, `import_pixabay_assets` |
| `llm.ts` | `marker_type`, `segment_name`, `duration_sec` |

**Server:** After shared schemas are camelCase, ensure every route that validates request body or shapes response uses these schemas with camelCase. Request bodies are parsed and validated with the updated schemas (clients send camelCase). Response payloads must be built with camelCase keys so they validate against the updated response schemas. No web changes in this pass (web will be updated later to send/consume camelCase).

### B. Part 9 – Scripts and maintenance (concrete steps)

| File | Current state | Action |
|------|----------------|--------|
| `server/src/db/clear-stale-2fa.ts` | Already uses Drizzle; uses `.run()` and `.changes` (better-sqlite3 `RunResult`) | Keep as-is; optionally use `sqlNow()` for dialect-safe expiry comparison if desired. |
| `server/src/db/clear-ip-bans.ts` | Uses raw `db.prepare("DELETE ...").run()` | Convert to `drizzleDb.delete(ipBans).run()` and `drizzleDb.delete(loginAttempts).run()`; use returned `.changes` for log. |
| `server/src/db/seed-podcast-with-episodes.ts` | Uses raw `db` (prepare/get/run), `db.transaction()` | Convert to `drizzleDb`; use `drizzleDb.transaction()` for the seed; use schema table refs and camelCase. |
| `server/src/db/seed-analytics.ts` | Uses raw `db` (prepare/get/run) | Convert to `drizzleDb` and schema tables; use camelCase for row access. |
| `server/src/db/reset-first-user-password.ts` | Uses raw `db` (prepare get/run), `closeDb()` | Convert to `drizzleDb.select()` / `drizzleDb.update()`; keep script exit (no long-lived server). |
| `server/src/scripts/seed-setup.ts` | Uses `db` for settings (INSERT OR REPLACE), users SELECT/INSERT/UPDATE | Convert to `drizzleDb`; settings via `onConflictDoUpdate`; users via insert/update/select from schema. |
| `server/src/scripts/send-seed-admin-welcome.ts` | Uses `db.prepare("INSERT INTO password_reset_tokens...")` | Convert to `drizzleDb.insert(passwordResetTokens).values(...)`. |
| `server/src/scripts/add-sso-provider.ts` | Uses `db`, `closeDb`; calls `writeSsoOidcProviders` / `writeSsoSamlProviders` (likely already Drizzle) | Replace `db`/`closeDb` usage with `drizzleDb` if any raw queries remain; ensure no raw `db` import. |
| `server/src/db/migrate.ts` | Raw `db` for migrations and `_migrations` table | **Optional:** Leave on raw `db` (isolated); or convert only `_migrations` to Drizzle. |

**Verification:** Run each script manually (clear-stale-2fa, clear-ip-bans, seed-podcast-with-episodes, seed-analytics, reset-first-user-password, seed-setup, send-seed-admin-welcome, add-sso-provider).

### C. E2E fixes (camelCase request/response)

E2E tests live in `e2e/` (not in `web/`). Update them to send and expect **camelCase** so they match the API contract after shared Zod and server use camelCase.

1. **Request bodies:** Use camelCase in `JSON.stringify()` (e.g. `validFrom`, `validUntil`, `subscriberOnlyFeedEnabled`, `readOnly`, `trimRanges`, `finalMarkers`, `segmentIds`, `castIds`, `isPublic`, `publishAt`, `registrationEnabled`, `publicFeedsEnabled`, `dnsUseCname`, `dnsARecordIp`, `managedDomain`, `managedSubDomain`, `linkDomain`, `dnsDefaultAllowDomain`, etc.).
2. **Response assertions:** Use camelCase when reading `data.*` (e.g. `data.dnsUseCname`, `data.managedDomain`, `seg.durationSec`, `patched.trimRanges`, `ep.finalMarkers`).
3. **Files to touch (representative):**  
   `e2e/tests/scenarios/api-keys-and-tokens-validity.js`, `readonly-disabled.js`, `dns-use-cname-a-record.js`, `managed-domain.js`, `dns-domain-switch.js`, `show-cast-list.js`, `show-cast-permissions.js`, `e2e/tests/Segments/segments.js`, `e2e/lib/helpers.js` (setup body: `registrationEnabled`, `publicFeedsEnabled`, `importPixabayAssets`).

Run the full e2e suite after shared Zod + server + e2e updates to confirm all tests pass.

### D. Order of work

1. **Shared Zod:** Convert all schemas in `shared/src/schemas/` to camelCase (see table in A).
2. **Server:** Update any route or service that builds request/response objects or validates with these schemas so it uses camelCase (request body parsing and response shapes). Do not change `web/`.
3. **Part 9:** Convert the listed scripts and db maintenance files to Drizzle (see B).
4. **E2E:** Update e2e tests to camelCase request bodies and assertions (see C).
5. **Run:** `pnpm run e2e` (or project e2e command) and fix any remaining failures.

---

## Part 10: Deprecate Raw DB and Enable MySQL Runtime

**Goal:** Remove direct `better-sqlite3` usage from application code. Wire up the MySQL driver in `drizzle.ts`. Validate both dialects end-to-end.

**Prerequisites:** MySQL bootstrap path (Part 3), `mysql2` (Part 3), and `sqlNow()` / upsert / collation handling (Parts 2–8) are already in place.

**Estimated time:** 2–3 hours

### Steps

1. **Verify** no file imports `db` from `db/index.js` (except `migrate.ts` if kept on raw).

2. **Refactor** `server/src/db/drizzle.ts`:
   - If `DB_PROVIDER === "mysql"`, use `drizzle-orm/mysql2` with `DATABASE_URL`.
   - If `DB_PROVIDER === "sqlite"` (default), use `drizzle-orm/better-sqlite3`.
   - Export a single `drizzleDb` that switches based on config.
   - `mysql2` is already installed (Part 3).

3. **Schema is already dialect-ready** (thanks to `sqlNow()` and upsert choices in Parts 2–8). Confirm:
   - `AUTOINCREMENT` → Drizzle `integer().primaryKey({ autoIncrement: true })`; Drizzle emits correct SQL per dialect.
   - `onConflictDoUpdate` works for both (Drizzle abstracts SQLite vs MySQL syntax).

4. **Rename** or remove `db` export from `index.ts`. If `migrate.ts` still needs raw SQLite:
   - Keep a minimal `db` export used only by migrate.ts, or
   - Refactor migrate.ts to use a separate sqlite connection for migrations only.

5. **Test:**
   - SQLite: full e2e (unchanged flow: migrate.ts runs, then app).
   - MySQL: create empty DB, set `DB_PROVIDER=mysql`, `DATABASE_URL=...`, run `pnpm run db:push-mysql` to bootstrap schema, then full e2e. No `migrate.ts` on MySQL.

6. **Checkpoint:** Commit with message: `db-migration: Part 10 - deprecate raw db, enable MySQL runtime`.

---

## Summary

| Part | Description                         | Est. Time |
|------|-------------------------------------|------------|
| 1    | Project setup                       | 30 min     |
| 2    | Schema definition                   | 2–4 hrs    |
| 3    | Drizzle client, config, MySQL bootstrap path | 1.5–2 hrs |
| 4    | Pilot (podcasts repo)               | 1–2 hrs    |
| 5    | Auth and access                     | 3–4 hrs    |
| 6    | Podcast routes                      | 2–3 hrs    |
| 7    | Episodes, segments, exports, library| 4–5 hrs    |
| 8    | Settings, SSO, services             | 2–3 hrs    |
| 9    | Scripts and maintenance             | 1–2 hrs    |
| 10   | Deprecate raw db, enable MySQL runtime | 2–3 hrs  |

**Total:** ~2–3 weeks at a steady pace.

---

## Notes

- **Lessons Learned:** After Part 4, a "Lessons Learned so far" section was added before Part 5. Apply those patterns (aggregations, type normalization, row types, etc.) when converting Parts 5 onward.
- **SQLite migrations:** Existing `migrate.ts` and 50 migrations stay. They run only when `DB_PROVIDER=sqlite` (or unset). Drizzle schema reflects current DB; no Drizzle Kit migrations for schema changes unless you choose to switch later.
- **MySQL bootstrap:** `migrate.ts` does **not** run on MySQL (those migrations are SQLite raw SQL). Use `pnpm run db:push-mysql` before first app start to create tables from the Drizzle schema. Part 3 establishes this path so Part 10 does not stall.
- **Transactions:** Use `drizzleDb.transaction()` for multi-statement work. Replace `db.transaction()` in seed-podcast and seed-analytics.
- **Error handling:** Normalize `SQLITE_CONSTRAINT` and `ER_DUP_ENTRY` via `isUniqueViolation()` for consistent error handling across dialects.
- **Timestamps:** Never use raw `datetime('now')` in schema or app code. Use `sqlNow()` from `db/utils.ts` from Part 2 onward.
- **Upserts:** Use explicit `onConflictDoUpdate`; do not use raw `INSERT OR REPLACE`.
