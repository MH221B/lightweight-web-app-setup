# Lightweight web app starter

A copyable Bun workspace with two client flavors — React 19 and Angular 22 — against one NestJS/Fastify API on Bun. The Notes example is intentionally disposable.

## Stack

- **Clients:** React 19 on Vite+ with TanStack Router and Query; Angular 22 on the Angular CLI (standalone, zoneless, Signal Forms) with TanStack Angular Query.
- **API:** NestJS controllers, modules, and services using Fastify on Bun.
- **Shared data layer:** an oRPC v1 contract and framework-free oRPC fetch helpers in `shared/`. Zod validates request bodies; both clients and the server use the same route and response types.
- **Data:** Effect handles storage errors; Drizzle accesses SQLite through `bun:sqlite`.

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
- API: <http://localhost:3000>
- Vite proxies `/api` to the Bun server on `PORT`, defaulting to 3000. Set `PORT` for both processes when changing the API port.

Angular flavor:

```bash
bun run dev:angular
```

- Client: <http://localhost:5173> (Angular dev server)
- API: <http://localhost:3000>
- `client-angular/proxy.conf.json` proxies `/api` to `http://localhost:3000`. The Angular dev server reads `PORT` too, so leave `PORT` unset while both processes run.
- If the React dev server is already on 5173, Angular prints the next free port (5174) and serves there.

Both commands start their two processes with `bun run --parallel`, so no second terminal or extra tooling is needed. The two-terminal path still works if you prefer it: `bun run dev:server` plus `bun run dev:client`, or `bun run dev:server` plus `bun run --filter client-angular start`.

## Build and static checks

```bash
bun run check
```

`bun run check` runs three steps:

1. `bun run routes` — `tsr generate` regenerates `client/src/routeTree.gen.ts` (ignored by git) without a full build, so a fresh clone type checks immediately.
2. `vp check` — Vite+ formatting (Oxfmt) across `client/`, `client-angular/`, `server/`, and `shared/`, plus linting (Oxlint) and full TypeScript checks (type-aware Oxlint with `typescript-go`/tsgolint) across everything except `client-angular/`. Run it from the repository root so the root `vite.config.ts` applies.
3. `bun run --filter client-angular lint` — angular-eslint 22.8.0 over `client-angular/` TypeScript and templates (inline and external), running on Bun with the workspace's TypeScript 6.0.3.

`client-angular` is formatted by `vp check` but stays out of its lint and type-check legs: tsrs runs TypeScript 7 and Angular 22 rejects that version, and oxlint has no Angular template rules. Its real type gate is `ng build`.

`bun run typecheck` is the same type check without formatting, linting, or Angular: `bun run routes && vp check --no-fmt --no-lint`.

`bun run verify` is the full gate: `check` + `test` + `build` for both clients.

## Vite+ tooling

This baseline uses the project-local Vite+ CLI (`vite-plus@1.7.0`); no global install is needed.

| Tool                       | Status                | Notes                                                                                                                                                                           |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp dev`                   | Active                | React client dev server (`bun run dev:client`) with the React Compiler, router plugin, and `/api` proxy.                                                                        |
| `vp build`                 | Active                | React client production build; `bun run build` runs it and then the Angular build.                                                                                              |
| `vp check`                 | Active                | Oxfmt over `client/`, `client-angular/`, `server/`, `shared/`; Oxlint and full type checks over everything except `client-angular/`; the normal static check (`bun run check`). |
| `vp fmt`, `vp lint`        | Active via `vp check` | Root config lives in `vite.config.ts`; `client-angular/**` is formatted but outside the lint/type-check scope; generated and build paths are ignored.                           |
| `vp test` / Vitest         | Not used              | The only tests are server integration tests; see below.                                                                                                                         |
| `vp run`                   | Not used              | Root scripts already delegate through Bun workspace filters; Vite Task would duplicate that plumbing.                                                                           |
| `vp create` / `vp migrate` | Not used              | The project is hand-authored; generators and codemods are out of scope.                                                                                                         |
| `vp pack` / tsdown         | Not applicable        | No library package is published from this app.                                                                                                                                  |

Server tests use `bun:test` on purpose: they exercise the NestJS/Fastify app against an in-memory `bun:sqlite` database through the checked-in Drizzle migration. `bun run test` delegates to `bun test` in `server/`.

## Angular flavor

`client-angular/` is a standard Angular CLI 22 application: standalone components, zoneless change detection, OnPush by default, one hand-written route in `src/app/app.routes.ts`, Signal Forms for the note input, and TanStack Angular Query for server state. It builds with `ng build` and serves with `ng serve`, because the Angular CLI is Angular's supported build path; there is no supported way to hand a Vite config to `ng`.

- `bun run dev:angular` — Angular dev server on 5173 plus the API on 3000.
- `bun run --filter client-angular build` — production build to `client-angular/dist`, with `index.html` at that root.
- `bun run --filter client-angular lint` — angular-eslint over TypeScript and templates.
- TypeScript is pinned to 6.0.3 inside `client-angular/` because Angular 22 accepts `>=6.0 <6.1`; the root and the React client stay on TypeScript 7.
- No client tests, matching the React flavor. The server suite covers the shared data layer for both.

## API contract

`shared/notes.contract.ts` defines the routes, request validation, and response types for `GET /api/notes` and `POST /api/notes`. `server/src/notes/notes.controller.ts` implements them with the Nest controller decorator `@Implement` and calls the injectable `NotesService`. `shared/api.ts` is a contract-driven oRPC OpenAPI client that both flavors import. No generated API client is needed.

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

## Schema variants

The live application validates with Zod. Effect Schema implementations ship as twins so the CLI can scaffold either library:

- `shared/notes.contract.ts` (Zod) and `shared/variants/effect/notes.contract.ts` (Effect Schema)
- `server/src/env.ts` (Zod) and `server/src/variants/effect/env.ts` (Effect Schema)

`server/test/env.cases.ts` and `server/test/contract.cases.ts` hold the behavioral cases. `env.test.ts` and `contract.test.ts` run them against the live implementation; `env-effect.test.ts` and `contract-effect.test.ts` run the same cases against the twins. Effect still handles storage errors in both variants. A schema-behavior change updates both variants and the shared cases in the same change.

## Removing or renaming the Notes example

Delete or replace these files together:

- `client/src/routes/index.tsx` — the React page
- `client-angular/src/app/notes/notes-page.ts` — the Angular page
- `client-angular/src/app/notes/notes.service.ts` — the Angular queries and mutation
- `shared/api.ts` — the typed client and Notes helpers
- `shared/notes.contract.ts` — the shared contract
- `server/src/notes/notes.controller.ts`
- `server/src/notes/notes.errors.ts`
- `server/src/notes/notes.module.ts`
- `server/src/notes/notes.service.ts`
- `server/src/notes/schema.ts`
- `server/drizzle/` — the Notes migration history
- `server/test/notes.test.ts`

Then:

- Remove `NotesModule` from the imports in `server/src/app.ts`.
- Remove the Notes import, export, and entry from `server/src/schema.ts`; add your replacement schema there.
- Update `server/drizzle.config.ts` if the replacement schema is not exported by `server/src/schema.ts`.
- Replace the Notes-based compression test in `server/test/hosting.test.ts` with one that exercises a sufficiently large response from your replacement application.
- Remove `server/data/` for a clean database.
- Remove the `NotesPage` entry from `client-angular/src/app/app.routes.ts`.
- Keep the root workspace, `client/vite.config.ts`, `client-angular/angular.json`, `client-angular/proxy.conf.json`, `server/src/db.ts`, and the static-hosting code.

To rename rather than remove, replace `Notes`, `notes`, and `/api/notes` consistently across those files, then regenerate migrations only if the table name changes.

## Layout

- `client/` — React 19, Vite+, TanStack Router and Query, oRPC OpenAPI client
- `client-angular/` — Angular 22, Angular CLI, Signal Forms, TanStack Angular Query, oRPC OpenAPI client
- `server/` — NestJS/Fastify on Bun, oRPC v1, Effect, Zod, Drizzle, SQLite
- `shared/` — the oRPC v1 API contract and the framework-free oRPC client both flavors import
- `server/data/` — persistent SQLite files (ignored)

The diagram source is [`architecture.mmd`](architecture.mmd); the README uses [`architecture.svg`](architecture.svg).

## Verification

From a fresh clone:

```bash
bun install --frozen-lockfile
bun run verify
```

Expected: `bun run check` (format, lint, typecheck, angular-eslint) and `bun run build` (React and Angular) exit 0; the integration tests report `31 pass`, `0 fail`.

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

Manual browser checks (when a browser is available): open <http://localhost:5173> with `bun run dev`, add a note, refresh, and confirm the note remains; repeat with `bun run dev:angular`. The API process must be running on port 3000. Run one dev server at a time so Angular keeps 5173; if both run, it prints the port it picked.

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

`client-angular/` does not stand alone: the app imports `@shared/*`, and the workspace entry, the `@angular/build>vite` override, and the `--filter` scripts live in the root `package.json`. Copy the whole baseline first, then trim it:

1. Delete `client/`, drop the React-only legs from the root `package.json` (`dev`, `dev:client`, `routes`, the `bun run --filter client build` half of `build`, and the `bun run routes &&` prefixes in `typecheck`/`check`), and remove the stale `client/*` ignore globs from `vite.config.ts`.
2. Keep `angular.json` (`outputPath` with an empty `browser` name, dev-server port 5173, `proxy.conf.json`), `tsconfig.json`/`tsconfig.app.json` (TypeScript 6.0.x and the `@shared/*` path), and `eslint.config.mjs`.
3. Rename the `projects` key and every `buildTarget` value in `angular.json` (the targets name `client-angular:build:...`; `ng serve` breaks if they still point at the old project), the package name, and the `app-` selector prefix if you want a different one. The `--filter` names in the commands below follow the new package name.
4. Replace the Notes page and service using the removal list above, then run `bun run --filter client-angular build` and `bun run --filter client-angular lint`.
