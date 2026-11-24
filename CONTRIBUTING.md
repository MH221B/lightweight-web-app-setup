# Contributing

This repository contains the starter source. Users scaffold projects with `npx lwapp`; contributors work here (see the [README](README.md)).

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

Angular dependency prebundling is disabled because Bun's isolated install places shared dependencies outside the Angular client's resolution path.

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
