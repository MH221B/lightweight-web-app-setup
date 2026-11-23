# mh-stack

Scaffold a fresh Bun monorepo from the lightweight web app starter. Choose a client flavor and a validation library:

- **React 19** on Vite+ with TanStack Router and Query
- **Angular 22** on the Angular CLI (standalone, zoneless, Signal Forms)
- **Validation:** Zod (default) or Effect Schema. Both speak Standard Schema through the shared oRPC contract, so client code is identical.
- **Database:** SQLite (default) or PostgreSQL. Clients are unaffected; storage is server-side only.

Both flavors sit against the same NestJS/Fastify API, oRPC v1 contract, and Drizzle schema, on SQLite by default or PostgreSQL when selected.

## Usage

```bash
npx mh-stack
```

The CLI asks for a project name, a framework, a schema library, a database, and a target directory. It copies the matching starter, renames the root package, the client package, every workspace `--filter` reference, the Angular project key/targets/prefix and selectors, the page title and heading, and the README title. Existing files are never overwritten; any skipped path is printed. It then runs `bun install` plus the database migration when Bun is on `PATH`.

### Non-interactive

```bash
npx mh-stack --react --name my-app my-app
npx mh-stack --react --effect --name my-app my-app
npx mh-stack --angular --name my-app my-app
npx mh-stack --react --postgres --name my-app my-app
npx mh-stack --angular --effect --postgres --name my-app my-app
npx mh-stack --react --name my-app --no-install my-app
```

A non-TTY run without `--react`/`--angular` and `--name` exits with this recipe instead of silently choosing a framework. `--zod` and `--sqlite` are the unattended defaults.

### Flags

| Flag              | Meaning                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `--react`         | Scaffold the React client                                         |
| `--angular`       | Scaffold the Angular client                                       |
| `--zod`           | Validate with Zod (the unattended default)                        |
| `--effect`        | Validate with Effect Schema                                       |
| `--sqlite`        | Store data in SQLite (the unattended default)                     |
| `--postgres`      | Store data in PostgreSQL                                          |
| `--name <name>`   | Project and npm package name (lowercase letters, digits, hyphens) |
| `--no-install`    | Skip `bun install` and the database migration                     |
| `-h`, `--help`    | Show usage                                                        |
| `-v`, `--version` | Show the CLI version                                              |

## Templates and overlays

`cli/templates/<flavor>/` is the default tree and validates with Zod on SQLite. Exactly one overlay set applies per scaffold:

- `cli/overlays/<flavor>/effect-sqlite/` — the Effect Schema files.
- `cli/overlays/<flavor>/zod-postgres/` — the PostgreSQL client, tables, service, entry, env, committed `drizzle-pg/` history, canonical PostgreSQL tests, and `removals.json`.
- `cli/overlays/<flavor>/effect-postgres/` — both of the above, complete (no layering).

The scaffold copies the tree, runs the set's removals (only paths the tree wrote: the sqlite `drizzle.config.ts` and `drizzle/`), then copies the set. Existing files are never overwritten. `--postgres` scaffolds need `DATABASE_URL`; without it the bootstrap prints the manual recipe including the variable and exits 0.

## Requirements

- Node.js 22.13 or newer to run the CLI (npx uses plain Node)
- Bun 1.4.4 for the scaffold's install and migration; without it, the CLI prints the manual commands

## What you get

The scaffold keeps the starter's `client` / `client-angular` workspace directory names, the server and shared workspaces, `server/drizzle/` migrations, and the static-hosting code. It omits `node_modules/`, build output, `server/data/`, the generated route tree, and `bun.lock`; `bun install` regenerates the lockfile for the new project.
