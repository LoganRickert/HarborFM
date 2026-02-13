# Contributing to HarborFM

Thank you for your interest in contributing to HarborFM. This document explains how to get set up, run the project, and submit changes.

## Table of contents

- [Development setup](#development-setup)
- [Running locally](#running-locally)
- [Code quality](#code-quality)
- [Database migrations](#database-migrations)
- [Project structure](#project-structure)
- [Submitting changes](#submitting-changes)
- [License](#license)

## Development setup

- **Node.js** 22 or newer
- **pnpm** (the repo uses pnpm workspaces; npm/yarn are not supported for install)
- **ffmpeg** (for audio processing)
- **audiowaveform** ([bbc/audiowaveform](https://github.com/bbc/audiowaveform)) - e.g. `brew install audiowaveform` on macOS; on Linux, build from source or use a package if available

Clone the repo and install dependencies:

```bash
git clone https://github.com/LoganRickert/harborfm.git
cd harborfm
pnpm install
```

Optional: copy `server/.env.example` to `server/.env` and set `DATA_DIR`, `SECRETS_DIR`, `JWT_SECRET`, etc. for local overrides.

## Running locally

1. **Run migrations** (once, or after pulling new migrations):

   ```bash
   pnpm run db:migrate
   ```

2. **Start the app**:

   ```bash
   pnpm run dev
   ```

   This runs the API and the web dev server. Open the URL shown (e.g. http://localhost:5173). On first run, get the one-time setup URL from the server logs (e.g. `/setup?id=...`), open it in the browser, create the admin account, then sign in.

Useful scripts from the repo root:

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Run API and web dev servers together |
| `pnpm run dev:server` | Run only the API (tsx watch) |
| `pnpm run dev:web` | Run only the web dev server (Vite) |
| `pnpm run build` | Build shared, then server, then web |
| `pnpm run e2e` | Run end-to-end / integration tests (starts a fresh server, runs API tests, then stops) |

See [README.md](README.md#scripts) for the full list.

## End-to-end tests

From the repo root, run:

```bash
pnpm run e2e
```

This starts a temporary server (using `e2e/data` and `e2e/secrets`), runs the full API test suite (setup, auth, podcasts, episodes, public feeds, settings, users, subscriptions, collaboration, etc.), then stops the server. Results are printed to the console and written to `e2e/reports/e2e-report.json` and `e2e/reports/e2e-report.xml`. Requires Node 22+, bash, and a built server (`pnpm run build` is run automatically if needed).

## Code quality

Before submitting a pull request, run:

```bash
pnpm run lint
pnpm run typecheck
```

- **Lint:** ESLint is used in `server`, `web`, and `shared`. Use `pnpm run lint` from the root to lint all packages.
- **TypeScript:** Keep types accurate; run `pnpm run typecheck` to type-check all packages.

Conventions:

- **Server / shared:** TypeScript with strict ESLint and `typescript-eslint`. Unused variables are errors unless prefixed with `_`.
- **Web:** React + Vite; same lint/typecheck expectations. Follow existing patterns in the codebase for components and API usage.

## Database migrations

Schema changes are done via migrations in `server/src/db/migrations/`. Each migration is a numbered file (e.g. `018_my_feature.ts`) that exports `up` and `down`:

```ts
export const up = (db: { exec: (sql: string) => void }) => {
  db.exec(`CREATE TABLE ...`);
};

export const down = (db: { exec: (sql: string) => void }) => {
  db.exec(`DROP TABLE ...`);
};
```

When adding a new migration:

1. Create the next numbered file in `server/src/db/migrations/` (e.g. `018_description.ts`).
2. Implement `up` and `down`.
3. Register it in `server/src/db/migrate.ts`: add the import and add an entry to the `migrations` array.
4. Run migrations locally: `pnpm run db:migrate`.
5. Verify all migrations apply cleanly on a fresh DB: `pnpm run db:migrate:test`.

`db:migrate:test` creates a temporary database, runs all migrations, and then removes it. Use it before opening a PR that changes migrations.

## Project structure

- **shared** - Zod schemas and shared types used by server and web.
- **server** - Fastify API, SQLite (better-sqlite3), ffmpeg-based audio processing. Serves the built web app in production.
- **web** - React frontend (Vite, TanStack Query).

Build order is shared → server → web. Root scripts run across workspaces where applicable.

## Submitting changes

1. **Fork** the repository and create a branch from `main`.
2. **Implement** your change. Keep the scope focused; use separate branches/PRs for unrelated changes.
3. **Run** `pnpm run lint`, and `pnpm run typecheck`. If you added or changed migrations, run `pnpm run db:migrate:test`.
4. **Commit** with clear messages. Reference any issues if applicable (e.g. `Fix login redirect (#123)`).
5. **Open a pull request** against `main`. Describe what you changed and why; link issues if relevant.

Feedback and iterations are normal; the maintainers will respond when they can.

## License

By contributing, you agree that your contributions will be licensed under the same [MIT License](LICENSE) that covers HarborFM.
