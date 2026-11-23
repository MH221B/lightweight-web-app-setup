# mh-stack

Scaffold a fresh Bun monorepo from the lightweight web app starter. Choose one client flavor:

- **React 19** on Vite+ with TanStack Router and Query
- **Angular 22** on the Angular CLI (standalone, zoneless, Signal Forms)

Both flavors sit against the same NestJS/Fastify API, oRPC v1 contract, Drizzle schema, and SQLite database.

## Usage

```bash
npx mh-stack
```

The CLI asks for a project name, a framework, and a target directory. It copies the matching starter, renames the root package, the client package, every workspace `--filter` reference, the Angular project key/targets/prefix and selectors, the page title and heading, and the README title. Existing files are never overwritten; any skipped path is printed. It then runs `bun install` plus the database migration when Bun is on `PATH`.

### Non-interactive

```bash
npx mh-stack --react --name my-app my-app
npx mh-stack --angular --name my-app my-app
npx mh-stack --react --name my-app --no-install my-app
```

A non-TTY run without `--react`/`--angular` and `--name` exits with this recipe instead of silently choosing a framework.

### Flags

| Flag              | Meaning                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `--react`         | Scaffold the React client                                         |
| `--angular`       | Scaffold the Angular client                                       |
| `--name <name>`   | Project and npm package name (lowercase letters, digits, hyphens) |
| `--no-install`    | Skip `bun install` and the database migration                     |
| `-h`, `--help`    | Show usage                                                        |
| `-v`, `--version` | Show the CLI version                                              |

## Requirements

- Node.js 22.13 or newer to run the CLI (npx uses plain Node)
- Bun 1.4.4 for the scaffold's install and migration; without it, the CLI prints the manual commands

## What you get

The scaffold keeps the starter's `client` / `client-angular` workspace directory names, the server and shared workspaces, `server/drizzle/` migrations, and the static-hosting code. It omits `node_modules/`, build output, `server/data/`, the generated route tree, and `bun.lock`; `bun install` regenerates the lockfile for the new project.
