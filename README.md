# Lightweight web app starter

A copyable Bun workspace with two client flavors — React 19 and Angular 22 — against one NestJS/Fastify API on Bun. The Notes example is intentionally disposable.

## Stack

- **Clients:** React 19 on Vite+ with TanStack Router and Query; Angular 22 on the Angular CLI (standalone, zoneless, Signal Forms) with TanStack Angular Query.
- **API:** NestJS controllers, modules, and services using Fastify on Bun.
- **Shared data layer:** an oRPC v1 contract and framework-free oRPC fetch helpers in `shared/`. Zod validates request bodies; both clients and the server use the same route and response types.
- **Data:** Effect handles storage errors; Drizzle accesses SQLite through `bun:sqlite`. A PostgreSQL twin (`postgres.js` + Drizzle's `postgres-js` adapter) lives under `server/src/variants/postgres/` and scaffolds with `--postgres`.

![Notes request flow: the React and Angular clients share an oRPC v1 contract with the NestJS controller, which calls a service backed by Drizzle and SQLite.](architecture.svg)

## Prerequisites

- Bun 1.4.4 (`bun --version`)
- Node.js 24.15 or newer. The Angular CLI 22 requires `^22.22.3 || ^24.15.0 || >=26.0.0`; this repository is verified on 24.19.0 and CI pins that version.

## Install

```bash
bun install
```

## Develop

React flavor:

```bash
bun run dev
```

- Client: <http://localhost:5173>

Angular flavor:

```bash
bun run dev:angular
```

- Client: <http://localhost:5173> (Angular dev server)
- If React already uses 5173, Angular prints and uses the next free port (5174).

Both commands use `bun run --parallel` to start the client and API. The API defaults to <http://localhost:3000>. Vite and `client-angular/proxy.conf.mjs` proxy `/api` to `PORT` (default 3000). Set `PORT` for both processes when changing it.

For separate terminals, run `bun run dev:server` with `bun run dev:client` or `bun run --filter client-angular start`.

## Build and static checks

```bash
bun run check
```

`bun run check` runs three steps:

1. `bun run routes` — `tsr generate` regenerates the git-ignored `client/src/routeTree.gen.ts` without a full build.
2. `vp check` — Oxfmt formats `client/`, `client-angular/`, `server/`, and `shared/`. Oxlint and type-aware Oxlint with `typescript-go`/tsgolint lint and type-check everything except `client-angular/`. Run from the repository root to use `vite.config.ts`.
3. `bun run --filter client-angular lint` — angular-eslint 22.8.0 checks Angular TypeScript and inline and external templates on Bun with TypeScript 6.0.3.

`client-angular/` is outside the `vp check` lint and type checks: tsrs uses TypeScript 7, which Angular 22 rejects, and Oxlint lacks Angular template rules. `ng build` type-checks Angular.

`bun run typecheck` is the same type check without formatting, linting, or Angular: `bun run routes && vp check --no-fmt --no-lint`.

`bun run verify` is the full gate: `check` + `test` + `build` for both clients. Its CLI tests regenerate `cli/templates/` and `cli/overlays/`.

## Vite+ tooling

The project-local `vite-plus@1.7.0` needs no global install. `vp dev` runs the React dev server (`bun run dev:client`) with the React Compiler and router plugin. `vp build` builds React; `bun run build` also builds Angular. `vp check` uses the root `vite.config.ts` and ignores generated and build paths.

`bun run test` runs the server and CLI suites with `bun:test`. Server tests exercise the NestJS/Fastify app against in-memory `bun:sqlite` using the checked-in Drizzle migration.

## Angular flavor

`client-angular/` is an Angular CLI 22 application with standalone components, zoneless change detection, OnPush by default, one hand-written route in `src/app/app.routes.ts`, Signal Forms for note input, and TanStack Angular Query for server state. It uses `ng build` and `ng serve`; `ng` does not support a Vite config.

- `bun run --filter client-angular build` — production build to `client-angular/dist`, with `index.html` at that root.
- TypeScript is pinned to 6.0.3 inside `client-angular/` because Angular 22 accepts `>=6.0 <6.1`; the root and the React client stay on TypeScript 7.
- No client tests, matching the React flavor. The server suite covers the shared data layer for both.

## API contract

`shared/notes.contract.ts` defines the routes, request validation, and response types for `GET /api/notes` and `POST /api/notes`. `shared/notes.meta.ts` holds their shared path and metadata. `server/src/notes/notes.controller.ts` implements them with the Nest controller decorator `@Implement` and calls the injectable `NotesService`. `shared/api.ts` is a contract-driven oRPC OpenAPI client that both flavors import. No generated API client is needed.

`@client/...` resolves to `client/src/`, `@server/...` to `server/src/`, and `@shared/...` to `shared/`. Clients import the shared data layer, not the server application.

## Environment

The server validates its environment at boot in `server/src/env.ts` and fails fast on invalid values:

| Variable        | Default              | Notes                                                                |
| --------------- | -------------------- | -------------------------------------------------------------------- |
| `PORT`          | `3000`               | Integer, 1-65535                                                     |
| `DATABASE_PATH` | `server/data/app.db` | Absolute, or relative to the process cwd                             |
| `CLIENT_DIST`   | `client/dist`        | Client build directory; absolute, or relative to the repository root |
| `NODE_ENV`      | `development`        | `development`, `test`, or `production`                               |

## Database

- Set `DATABASE_PATH` to override the default path in the environment table.
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

Expected output: `Migrated <repo>/server/data/app.db`. Git ignores `server/data/`, `*.db*`, and the database's `-wal`/`-shm` companions. The generated `server/drizzle/` is checked in.

## Production

```bash
bun run build
bun run start
```

- The Bun process serves `/api/*` and the client build named by `CLIENT_DIST` (`client/dist` by default).
- `GET /api/*` misses return JSON 404s and never fall through to `index.html`.
- Other GET paths fall back to `index.html` for client-side routing.
- Compressible responses of at least 1024 bytes are gzip-compressed when the client requests gzip; the plugin also supports other negotiated encodings.
- Hashed build files are served with `Cache-Control: public, max-age=31536000, immutable`: everything under `assets/` (Vite's layout) and any file whose name carries an 8+ character content hash at any depth (Angular emits those at the output root). `index.html` (including the SPA fallback) is `no-cache`, so deploys are picked up immediately.
- Default port: 3000. Override with `PORT`.
- Default database: `server/data/app.db`. Override with `DATABASE_PATH`.

To serve the Angular build instead of the React one:

```bash
CLIENT_DIST=client-angular/dist bun run start
```

PowerShell:

```powershell
$env:CLIENT_DIST = "client-angular/dist"; bun run start
```

## Database variants

SQLite is the default and the live application's database: `server/src/db.ts`, `server/src/schema.ts`, `server/src/notes/`, and `server/drizzle/`.

The PostgreSQL twin mirrors those paths under `server/src/variants/postgres/`, with its own migrations in `server/drizzle-pg/` and env twins at `server/src/variants/postgres/env.ts` (Zod) and `server/src/variants/effect-postgres/env.ts` (Effect Schema). PostgreSQL needs `DATABASE_URL` (`postgres://` or `postgresql://`) with a host and database path; SQLite never reads it.

Generate PostgreSQL migrations with `bun run db:generate:pg`.

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/notes bun run --filter server test
```

Integration tests create and drop a temporary database (`starter_test_<random>`) on the server named by `DATABASE_URL`; this needs `CREATEDB`. They connect to the named database only to administer the temporary one and never migrate or mutate databases you keep. Cleanup is best-effort; abrupt termination can leave the temporary database behind. Tests skip without `DATABASE_URL`. CI sets it with `STARTER_REQUIRE_POSTGRES=1` to run the PostgreSQL suite. Update both databases and their shared case tables together for storage changes.

## Schema variants

The live application validates with Zod. Effect Schema implementations ship as twins so the CLI can scaffold either library:

- `shared/notes.contract.ts` (Zod) and `shared/variants/effect/notes.contract.ts` (Effect Schema)
- `server/src/env.ts` (Zod) and `server/src/variants/effect/env.ts` (Effect Schema)

`server/test/env.cases.ts` and `server/test/contract.cases.ts` hold shared behavioral cases. `env.test.ts` and `contract.test.ts` test the live implementation; `env-effect.test.ts` and `contract-effect.test.ts` test the twins. Effect handles storage errors in both. Update both variants and shared cases together for schema-behavior changes.

## Removing or renaming the Notes example

Delete or replace these files together:

- `client/src/routes/index.tsx` — the React page
- `client-angular/src/app/notes/notes-page.ts` — the Angular page
- `client-angular/src/app/notes/notes.service.ts` — the Angular queries and mutation
- `shared/api.ts` — the typed client and Notes helpers
- `shared/notes.contract.ts` — the shared contract
- `shared/notes.meta.ts` — the Notes path and metadata
- `shared/variants/effect/notes.contract.ts` — the Effect contract twin
- `server/src/notes/notes.controller.ts`
- `server/src/notes/notes.errors.ts`
- `server/src/notes/notes.module.ts`
- `server/src/notes/notes.service.ts`
- `server/src/notes/schema.ts`
- `server/drizzle/` — the Notes migration history
- `server/drizzle-pg/` — the PostgreSQL Notes migration history
- `server/src/variants/effect/`, `server/src/variants/effect-postgres/`, `server/src/variants/postgres/`, and `server/src/variants/shared/` — review and update the env, database, schema, and Notes twins along with the live server
- `server/test/notes.test.ts`
- `server/test/notes-postgres.test.ts` — the PostgreSQL Notes tests
- `server/test/contract.cases.ts`, `server/test/contract.test.ts`, and `server/test/contract-effect.test.ts` — the shared contract tests
- `server/test/env-effect.test.ts`, `server/test/env-postgres.cases.ts`, `server/test/env-postgres.test.ts`, and `server/test/env-postgres-effect.test.ts` — review the variant environment tests when changing their twins
- `server/test/hosting-postgres.test.ts` and `server/test/client-dist-postgres.test.ts` — update their Notes-dependent checks

Then:

- Remove `NotesModule` from the imports in `server/src/app.ts`.
- Remove the Notes import, export, and entry from `server/src/schema.ts`; add your replacement schema there.
- Update `server/drizzle.config.ts` if the replacement schema is not exported by `server/src/schema.ts`.
- Replace the Notes-based compression test in `server/test/hosting.test.ts` with one that exercises a sufficiently large response from your replacement application.
- Remove `server/data/` for a clean database.
- Remove the `NotesPage` entry from `client-angular/src/app/app.routes.ts`.
- Keep the root workspace, `client/vite.config.ts`, `client-angular/angular.json`, `client-angular/proxy.conf.mjs`, `server/src/db.ts`, and the static-hosting code.

To rename rather than remove, replace `Notes` and `notes` consistently across those files and change the `/api/notes` path in `shared/notes.meta.ts`, then regenerate migrations only if the table name changes.

## Layout

- `client/` — React 19, Vite+, TanStack Router and Query, oRPC OpenAPI client
- `client-angular/` — Angular 22, Angular CLI, Signal Forms, TanStack Angular Query, oRPC OpenAPI client
- `server/` — NestJS/Fastify on Bun, oRPC v1, Effect, Zod, Drizzle, SQLite (PostgreSQL twins under `server/src/variants/postgres/`)
- `server/drizzle-pg/` — the PostgreSQL twin's committed migration history
- `shared/` — `notes.meta.ts`, the oRPC v1 API contract, and the framework-free oRPC client both flavors import
- [`cli/`](cli/README.md) — the `mh-stack` scaffolder and its tests
- `server/data/` — persistent SQLite files (ignored)

The diagram source is [`architecture.mmd`](architecture.mmd); the README uses [`architecture.svg`](architecture.svg).

## Verification

From a fresh clone:

```bash
bun install --frozen-lockfile
bun run verify
```

Expected: `bun run check` (format, lint, typecheck, angular-eslint) and `bun run build` (React and Angular) exit 0; the integration tests report `37 pass`, `23 skip`, `0 fail` locally (the 17 gated tests plus two skipped hooks per gated file; Bun 1.4.4 counts a skipped suite's hooks as skips), and `54 pass` when `DATABASE_URL` is set (the role needs `CREATEDB`).

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

When a browser is available, open <http://localhost:5173> with `bun run dev`, add a note, refresh, and confirm it remains. Repeat with `bun run dev:angular`. The API must run on port 3000. Run one dev server at a time to keep Angular on 5173; otherwise it prints its chosen port.

## Copying this baseline

To start a new project:

1. Copy the repository without `node_modules/`, `client/dist/`, `client-angular/dist/`, `client-angular/.angular/`, `client/src/routeTree.gen.ts`, and `server/data/`.
2. Run `bun install`.
3. Rename the root package and the `client`/`client-angular`/`server` package names if desired.
4. Replace the Notes example using the removal list above.
5. Keep `server/src/db.ts`, `server/src/hosting.ts`, and `client/vite.config.ts`.
6. Run `bun run check` and `bun run test` after the replacement.

Never commit `server/data/`, either client's build output, the Angular CLI cache, or the generated route tree.

### Keeping only the Angular flavor

`client-angular/` does not stand alone: the app imports `@shared/*`, and the workspace entry, the scoped `vite` override for `@angular/build`, and the `--filter` scripts live in the root `package.json`. Copy the whole baseline first, then trim it:

1. Delete `client/` and `cli/`, remove both from root `workspaces`, drop the React-only legs from root `package.json` (`dev`, `dev:client`, `routes`, the `bun run --filter client build` half of `build`, and the `bun run routes &&` prefixes in `typecheck`/`check`), and remove the stale `client/*` and `cli/*` ignore globs from `vite.config.ts`. Drop `templates:sync` and `test:cli`, and change `test` to `bun run --filter server test`; the scaffolder is no longer available in this trimmed app.
2. Keep `angular.json` (`outputPath` with an empty `browser` name, dev-server port 5173, `proxy.conf.mjs`), `tsconfig.json`/`tsconfig.app.json` (TypeScript 6.0.x and the `@shared/*` path), and `eslint.config.mjs`.
3. Rename the `projects` key and every `buildTarget` value in `angular.json` (the targets name `client-angular:build:...`; `ng serve` breaks if they still point at the old project), the package name, and the `app-` selector prefix if you want a different one. The `--filter` names in the commands below follow the new package name.
4. Remove the generated CLI block and stale `client/` entries from `.gitignore`, and update this README to describe only the retained Angular app and its commands.
5. Run `bun install` to regenerate `bun.lock` for the trimmed workspaces, then run `bun install --frozen-lockfile` and `bun run verify`.
6. Replace the Notes page and service using the removal list above, then run `bun run --filter client-angular build` and `bun run --filter client-angular lint`.
