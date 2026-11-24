# lwapp

Scaffold a fresh Bun monorepo from the lightweight web app starter. Choose a client flavor and a validation library:

- **React 19** on Vite+ with TanStack Router and Query
- **Angular 22** on the Angular CLI (standalone, zoneless, Signal Forms)
- **Validation:** Zod (default) or Effect Schema. Both speak Standard Schema through the shared oRPC contract, so client code is identical.
- **Database:** SQLite (default) or PostgreSQL. Clients are unaffected; storage is server-side only.

Both flavors sit against the same NestJS/Fastify API, oRPC v1 contract, and Drizzle schema, on SQLite by default or PostgreSQL when selected.

## Usage

```bash
npx lwapp
```

The CLI asks for a project name, a framework, a schema library, a database, and a target directory. It copies the matching starter, renames the root package, the client package, every workspace `--filter` reference, the Angular project key/targets/prefix and selectors, the page title and heading, and the README title. Existing files are never overwritten; any skipped path is printed. Variant conflicts and existing files whose variant cannot be determined stop scaffolding. It then runs `bun install` plus the database migration when Bun is on `PATH`.

### Non-interactive

```bash
npx lwapp --react my-app
npx lwapp --react --effect my-app
npx lwapp --angular my-app
npx lwapp --react --postgres my-app
npx lwapp --angular --effect --postgres my-app
npx lwapp --react --no-install my-app
```

A non-TTY run missing `--react`/`--angular` or the target directory exits with this recipe instead of silently choosing a framework. The project name defaults to the resolved target directory's basename; use `--name <name>` to override it, including when the directory name is not a valid project name. `--zod` and `--sqlite` are the unattended defaults.

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

`cli/templates/<flavor>/` is the default tree and validates with Zod on SQLite. At most one overlay set applies per scaffold; the default uses none:

- `cli/overlays/<flavor>/effect-sqlite/` — the Effect Schema files.
- `cli/overlays/<flavor>/zod-postgres/` — the PostgreSQL client, tables, service, entry, env, committed `drizzle-pg/` history, canonical PostgreSQL tests, and `removals.json`.
- `cli/overlays/<flavor>/effect-postgres/` — both of the above, complete (no layering).

The scaffold copies the tree, runs the set's removals (only paths the tree wrote: the sqlite `drizzle.config.ts` and `drizzle/`), then copies the set. Existing files are never overwritten. `--postgres` scaffolds need `DATABASE_URL`; without it the bootstrap prints the manual recipe including the variable and exits 0.

## Requirements

- Node.js 22.13 or newer to run the CLI (npx uses plain Node)
- Bun for the scaffold's install and migration (see the root `package.json` for the pinned version); without it, the CLI prints the manual commands

## What you get

The scaffold keeps the selected client workspace directory, the server and shared workspaces, and the static-hosting code. SQLite scaffolds keep `server/drizzle/`; PostgreSQL scaffolds remove it and use `server/drizzle-pg/`. It omits `node_modules/`, build output, `server/data/`, the generated route tree, and `bun.lock`; `bun install` regenerates the lockfile for the new project.
