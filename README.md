# Lightweight web app starter

A copyable Bun workspace with a React 19 client and a Hono API on Bun. The Notes example is intentionally disposable.

## Prerequisites

- Bun 1.4.4 (`bun --version`)
- Node.js 22.18 or newer (required by the Vite+ CLI)

## Install

```bash
bun install
```

## Develop (two processes)

Terminal 1:

```bash
bun run dev:server
```

Terminal 2:

```bash
bun run dev:client
```

- Client: <http://localhost:5173>
- API: <http://localhost:3000>
- Vite proxies `/api` to the Bun server.

## Build and static checks

```bash
bun run check
```

`bun run check` runs two steps:

1. `bun run build` — `vp build` for the client, which also generates `client/src/routeTree.gen.ts` (ignored by git).
2. `vp check` — Vite+ formatting (Oxfmt), linting (Oxlint), and full TypeScript checks (type-aware Oxlint with `typescript-go`/tsgolint) across both `client/` and `server/`. Run it from the repository root so the root `vite.config.ts` applies.

`bun run typecheck` is the same type check without formatting or linting (`vp check --no-fmt --no-lint`). On a fresh clone, run `bun run build` first so the generated route tree exists.

## Vite+ tooling

This baseline uses the project-local Vite+ CLI (`vite-plus@1.4.0`); no global install is needed.

| Tool                       | Status                | Notes                                                                                                             |
| -------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `vp dev`                   | Active                | Client dev server (`bun run dev:client`) with the React Compiler, router plugin, and `/api` proxy.                |
| `vp build`                 | Active                | Client production build (`bun run build`).                                                                        |
| `vp check`                 | Active                | Formatting, linting, and full type checks for `client/` and `server/`; the normal static check (`bun run check`). |
| `vp fmt`, `vp lint`        | Active via `vp check` | Root config lives in `vite.config.ts`; generated and vendored paths are ignored.                                  |
| `vp test` / Vitest         | Not used              | The only tests are server integration tests; see below.                                                           |
| `vp run`                   | Not used              | Root scripts already delegate through Bun workspace filters; Vite Task would duplicate that plumbing.             |
| `vp create` / `vp migrate` | Not used              | The project is hand-authored; generators and codemods are out of scope.                                           |
| `vp pack` / tsdown         | Not applicable        | No library package is published from this app.                                                                    |

Server tests use `bun:test` on purpose: they exercise the real Hono app against an in-memory `bun:sqlite` database through the checked-in Drizzle migration, which Vitest would have to run under Bun anyway. `bun run test` delegates to `bun test` in `server/`.

## RPC contract

The client imports the server's `AppType` as a type only:

```ts
import type { AppType } from "@server/app";
const api = hc<AppType>("/");
```

`AppType` is the return type of `createApp` in `server/src/app.ts`, whose chained `new Hono().route(...)` expression carries the route schema, not a side-effect-mutated `Hono` variable. The controller is registered as an Awilixify provider, not in `controllers: []`, because Awilixify's controller lifecycle hides the instance and cannot extend Hono's inferred route type. `createApp` resolves the controller from the Awilixify container and calls `registerRoutes()` once to mount the typed sub-app.

`@client/...` resolves to `client/src/`, and `@server/...` resolves to `server/src/`. The client imports `@server/app` only as a type, so server code stays out of the browser bundle.

To prove the contract, run:

```bash
bun run check
```

Expected: exit code 0. If `client/src/api.ts` says `api.api` is `unknown`, the route chain has been broken; do not cast `AppType`.

## Database

- Default path: `server/data/app.db` (ignored by git)
- Override: set `DATABASE_PATH` to an absolute path or a path relative to the process cwd
- WAL is enabled for file databases
- Startup applies pending migrations automatically

Generate a migration after changing `server/src/notes/schema.ts`:

```bash
bun run db:generate
```

Apply migrations explicitly:

```bash
bun run db:migrate
```

Expected output: `Migrated <repo>/server/data/app.db`. The database file and its `-wal`/`-shm` companions are ignored by git. The generated `server/drizzle/` directory is checked in. `server/data/` and `*.db*` files are not.

## Production

```bash
bun run build
bun run start
```

- The Bun process serves `/api/*` and `client/dist`.
- `GET /api/*` misses return JSON 404s and never fall through to `index.html`.
- Other GET paths fall back to `index.html` for client-side routing.
- Default port: 3000. Override with `PORT`.
- Default database: `server/data/app.db`. Override with `DATABASE_PATH`.

## Removing or renaming the Notes example

Delete or replace these files together:

- `client/src/routes/index.tsx` — the page
- `client/src/api.ts` — the typed client and Notes helpers
- `server/src/notes/notes.controller.ts`
- `server/src/notes/notes.module.ts`
- `server/src/notes/notes.service.ts`
- `server/src/notes/schema.ts`
- `server/drizzle/` — the Notes migration history
- `server/test/notes.test.ts`

Then:

- Remove the `createNotesModule`/`registerRoutes` mount from `server/src/app.ts`.
- Replace the `db` provider in the app factory when you introduce a new schema.
- Remove `server/data/` for a clean database.
- Keep the root workspace, `client/vite.config.ts`, `server/src/db.ts`, and the Bun static-hosting code.

To rename rather than remove, replace `Notes`, `notes`, and `/api/notes` consistently across those files, then regenerate migrations only if the table name changes.

## Layout

- `client/` — React 19, Vite+, TanStack Router and Query, Hono `hc`
- `server/` — Hono on Bun, Awilixify, Effect, Zod, Drizzle, SQLite
- `server/data/` — persistent SQLite files (ignored)

## Verification

From a fresh clone:

```bash
bun install --frozen-lockfile
bun run check
bun run test
```

Expected: build and static checks (`vp check`: format, lint, typecheck) exit 0; the Notes integration tests report `5 pass`, `0 fail`.

Production check:

```bash
bun run build
bun run start
```

Then confirm:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/some/deep/link
curl.exe -s -i http://localhost:3000/api
curl.exe -s -i http://localhost:3000/api/unknown
```

Expected: `200`, `200`, and JSON `404` responses for both `/api` and `/api/unknown`.

Manual browser check (when a browser is available): open <http://localhost:5173>, add a note, refresh, and confirm the note remains. The API process must be running on port 3000.

## Copying this baseline

To start a new project:

1. Copy the repository without `node_modules/`, `client/dist/`, `client/src/routeTree.gen.ts`, and `server/data/`.
2. Run `bun install`.
3. Rename the root package and the `client`/`server` package names if desired.
4. Replace the Notes example using the removal list above.
5. Keep `server/src/db.ts`, the static-hosting block in `server/src/app.ts`, and `client/vite.config.ts`.
6. Run `bun run check` and `bun run test` after the replacement.

Never commit `server/data/`, `client/dist/`, or the generated route tree.
