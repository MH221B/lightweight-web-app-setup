#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  mkdir as diskMkdir,
  readFile as diskReadFile,
  rm,
  writeFile as diskWriteFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLIENT_DIR,
  DOTFILES,
  OVERLAY_SETS,
  type Flavor,
  type OverlaySet,
} from "../src/template-config.ts";
import { walkFiles } from "../src/walk.ts";

type OverrideValue = string | Record<string, string>;

interface PackageJson {
  name?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  overrides?: Record<string, OverrideValue>;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

const FLAVORS: Flavor[] = ["react", "angular"];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ROOT = join(REPO_ROOT, "cli");
const TEMPLATES_ROOT = join(CLI_ROOT, "templates");
const OVERLAYS_ROOT = join(CLI_ROOT, "overlays");
const VP_BIN = join(REPO_ROOT, "node_modules", "vite-plus", "bin", "vp");
const ASSEMBLY_ROOT = join(CLI_ROOT, "__sync_in_memory__");
const assembled = new Map<string, Buffer>();

function isAssemblyPath(file: string): boolean {
  return resolve(file).startsWith(`${ASSEMBLY_ROOT}${sep}`);
}

async function readFile(file: string): Promise<Buffer>;
async function readFile(file: string, encoding: "utf8"): Promise<string>;
async function readFile(file: string, encoding?: "utf8"): Promise<Buffer | string> {
  if (!isAssemblyPath(file)) return encoding ? diskReadFile(file, encoding) : diskReadFile(file);
  const value = assembled.get(resolve(file));
  if (!value) throw new Error(`Missing assembled file: ${file}`);
  return encoding ? value.toString(encoding) : value;
}

async function writeFile(file: string, data: string | Uint8Array): Promise<void> {
  if (!isAssemblyPath(file)) throw new Error(`Unexpected assembly destination: ${file}`);
  assembled.set(resolve(file), Buffer.from(data));
}

async function mkdir(dir: string, _options: { recursive: true }): Promise<void> {
  if (!isAssemblyPath(dir)) throw new Error(`Unexpected assembly directory: ${dir}`);
}

const OTHER_CLIENT_DIR: Record<Flavor, string> = {
  react: CLIENT_DIR.angular,
  angular: CLIENT_DIR.react,
};

const EXCLUDED_PREFIXES = [
  ".git/",
  ".github/",
  "artifact/",
  "cli/",
  "client-angular/.angular/",
  "client-angular/dist/",
  "client-angular/variants/",
  "client/.tanstack/",
  "client/dist/",
  "client/variants/",
  "node_modules/",
  "server/data/",
  "server/drizzle-pg/",
  "server/src/variants/",
  "shared/variants/",
];
const EXCLUDED_FILES = new Set([
  "architecture.theme.css",
  "bun.lock",
  "CONTRIBUTING.md",
  "client/src/routeTree.gen.ts",
  "server/test/env-postgres.cases.ts",
]);
// npm cannot pack these dotted names, so the sync stores them under a leading
// underscore and the runtime maps them back (Task 4's DOTFILES).

class SyncError extends Error {}

function assertContains(text: string, needle: string, where: string): void {
  if (!text.includes(needle)) {
    throw new SyncError(`${where}: expected to find:\n${needle}`);
  }
}

function replaceOnce(text: string, find: string, replacement: string, where: string): string {
  const count = text.split(find).length - 1;
  if (count !== 1) {
    throw new SyncError(
      `${where}: expected exactly one match for ${JSON.stringify(find)}, found ${count}`,
    );
  }
  return text.replace(find, replacement);
}

function replaceAllCount(
  text: string,
  find: string,
  replacement: string,
  expected: number,
  where: string,
): string {
  const count = text.split(find).length - 1;
  if (count !== expected) {
    throw new SyncError(
      `${where}: expected ${expected} matches for ${JSON.stringify(find)}, found ${count}`,
    );
  }
  return text.split(find).join(replacement);
}

function replaceH2(
  markdown: string,
  heading: string,
  body: string,
  sentinel: string,
  where: string,
): string {
  const start = markdown.indexOf(`## ${heading}\n`);
  if (start < 0) throw new SyncError(`${where}: missing section "## ${heading}"`);
  const next = markdown.indexOf("\n## ", start + heading.length + 4);
  const end = next < 0 ? markdown.length : next + 1;
  assertContains(markdown.slice(start, end), sentinel, `${where} (## ${heading})`);
  const before = markdown.slice(0, start).replace(/\n+$/, "");
  const after = next < 0 ? "" : markdown.slice(next + 1);
  return `${before}\n\n${body.trim()}\n\n${after}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function dropH2(markdown: string, heading: string, sentinel: string, where: string): string {
  const start = markdown.indexOf(`## ${heading}\n`);
  if (start < 0) throw new SyncError(`${where}: missing section "## ${heading}"`);
  const next = markdown.indexOf("\n## ", start + heading.length + 4);
  const end = next < 0 ? markdown.length : next + 1;
  assertContains(markdown.slice(start, end), sentinel, `${where} (## ${heading})`);
  const before = markdown.slice(0, start).replace(/\n+$/, "");
  const after = next < 0 ? "" : markdown.slice(next + 1);
  return `${before}\n\n${after}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const README_SENTINELS: Record<string, string> = {
  Stack: "**Clients:**",
  Develop: "bun run dev",
  "Build and static checks": "runs three steps",
  "Vite+ tooling": "vp check",
  "Angular flavor": "Angular CLI 22 application",
  Production: "bun run build",
  "Removing or renaming the Notes example": "Delete or replace these files together",
  Layout: "persistent SQLite files",
  Verification: "bun run verify",
  "Schema variants": "shared/variants/effect/notes.contract.ts",
  "Database variants": "server/drizzle-pg/",
};

const README_SECTIONS: Record<Flavor, Array<{ heading: string; body: string | null }>> = {
  react: [
    {
      heading: "Stack",
      body: `## Stack

- **Client:** React 19 on Vite+ with TanStack Router and Query.
- **API:** NestJS controllers, modules, and services using Fastify on Bun.
- **Shared data layer:** an oRPC v1 contract and framework-free oRPC fetch helpers in \`shared/\`. Zod validates request bodies; the client and the server use the same route and response types.
- **Data:** Effect handles storage errors; Drizzle accesses SQLite through \`bun:sqlite\`.

![Notes request flow: the React client shares an oRPC v1 contract with the NestJS controller, which calls a service backed by Drizzle and SQLite.](architecture.svg)`,
    },
    {
      heading: "Develop",
      body: `## Develop

\`\`\`bash
bun run dev
\`\`\`

- Client: <http://localhost:5173>
- API: <http://localhost:3000>
- Vite proxies \`/api\` to the Bun server on \`PORT\`, defaulting to 3000. Set \`PORT\` for both processes when changing the API port.

\`bun run dev\` starts both processes with \`bun run --parallel\`, so no second terminal or extra tooling is needed. The two-terminal path still works if you prefer it: \`bun run dev:server\` plus \`bun run dev:client\`.`,
    },
    {
      heading: "Build and static checks",
      body: `## Build and static checks

\`\`\`bash
bun run check
\`\`\`

\`bun run check\` runs two steps:

1. \`bun run routes\` — \`tsr generate\` regenerates \`client/src/routeTree.gen.ts\` (ignored by git) without a full build, so a fresh clone type checks immediately.
2. \`vp check\` — Vite+ formatting (Oxfmt) across \`client/\`, \`server/\`, and \`shared/\`, plus linting (Oxlint) and full TypeScript checks (type-aware Oxlint with \`typescript-go\`/tsgolint) across the same workspaces. Run it from the repository root so the root \`vite.config.ts\` applies.

\`bun run typecheck\` is the same type check without formatting or linting: \`bun run routes && vp check --no-fmt --no-lint\`.

\`bun run verify\` is the full gate: \`check\` + \`test\` + \`build\`.`,
    },
    {
      heading: "Vite+ tooling",
      body: `## Vite+ tooling

This baseline uses the project-local Vite+ CLI (\`vite-plus@1.7.0\`); no global install is needed.

| Tool | Status | Notes |
| --- | --- | --- |
| \`vp dev\` | Active | React client dev server (\`bun run dev:client\`) with the React Compiler, router plugin, and \`/api\` proxy. |
| \`vp build\` | Active | React client production build; \`bun run build\` runs it. |
| \`vp check\` | Active | Oxfmt over \`client/\`, \`server/\`, and \`shared/\`; Oxlint and full type checks over the same workspaces; the normal static check (\`bun run check\`). |
| \`vp fmt\`, \`vp lint\` | Active via \`vp check\` | Root config lives in \`vite.config.ts\`; generated and build paths are ignored. |
| \`vp test\` / Vitest | Not used | The only tests are server integration tests; see below. |
| \`vp run\` | Not used | Root scripts already delegate through Bun workspace filters; Vite Task would duplicate that plumbing. |
| \`vp create\` / \`vp migrate\` | Not used | The project is hand-authored; generators and codemods are out of scope. |
| \`vp pack\` / tsdown | Not applicable | No library package is published from this app. |

Server tests use \`bun:test\` on purpose: they exercise the NestJS/Fastify app against an in-memory \`bun:sqlite\` database through the checked-in Drizzle migration. \`bun run test\` delegates to \`bun test\` in \`server/\`.`,
    },
    { heading: "Angular flavor", body: null },
    {
      heading: "Production",
      body: `## Production

\`\`\`bash
bun run build
bun run start
\`\`\`

- The Bun process serves \`/api/*\` and the client build named by \`CLIENT_DIST\` (\`client/dist\` by default).
- \`GET /api/*\` misses return JSON 404s and never fall through to \`index.html\`.
- Other GET paths fall back to \`index.html\` for client-side routing.
- Compressible responses of at least 1024 bytes are gzip-compressed when the client requests gzip; the plugin also supports other negotiated encodings.
- Hashed build files are served with \`Cache-Control: public, max-age=31536000, immutable\`: everything under \`assets/\` (Vite's layout) and any file whose name carries an 8+ character content hash at any depth. \`index.html\` (including the SPA fallback) is \`no-cache\`, so deploys are picked up immediately.
- Default port: 3000. Override with \`PORT\`.
- Default database: \`server/data/app.db\`. Override with \`DATABASE_PATH\`.`,
    },
    { heading: "Schema variants", body: null },
    { heading: "Database variants", body: null },
    {
      heading: "Removing or renaming the Notes example",
      body: `## Removing or renaming the Notes example

Delete or replace these files together:

- \`client/src/routes/index.tsx\` — the React page
- \`shared/api.ts\` — the typed client and Notes helpers
- \`shared/notes.contract.ts\` — the shared contract
- \`shared/notes.meta.ts\` — the Notes path and metadata
- \`server/src/notes/notes.controller.ts\`
- \`server/src/notes/notes.errors.ts\`
- \`server/src/notes/notes.module.ts\`
- \`server/src/notes/notes.service.ts\`
- \`server/src/notes/schema.ts\`
- \`server/drizzle/\` — the Notes migration history
- \`server/test/notes.test.ts\`
- \`server/test/contract.cases.ts\` and \`server/test/contract.test.ts\` — the shared contract tests

Then:

- Remove \`NotesModule\` from the imports in \`server/src/app.ts\`.
- Remove the Notes import, export, and entry from \`server/src/schema.ts\`; add your replacement schema there.
- Update \`server/drizzle.config.ts\` if the replacement schema is not exported by \`server/src/schema.ts\`.
- Replace the Notes-based compression test in \`server/test/hosting.test.ts\` with one that exercises a sufficiently large response from your replacement application.
- Remove \`server/data/\` for a clean database.
- Keep the root workspace, \`client/vite.config.ts\`, \`server/src/db.ts\`, and the static-hosting code.

To rename rather than remove, replace \`Notes\` and \`notes\` consistently across those files and change the \`/api/notes\` path in \`shared/notes.meta.ts\`, then regenerate migrations only if the table name changes.`,
    },
    {
      heading: "Layout",
      body: `## Layout

- \`client/\` — React 19, Vite+, TanStack Router and Query, oRPC OpenAPI client
- \`server/\` — NestJS/Fastify on Bun, oRPC v1, Effect, Zod, Drizzle, SQLite
- \`shared/\` — \`notes.meta.ts\`, the oRPC v1 API contract, and the framework-free oRPC client the client imports
- \`server/data/\` — persistent SQLite files (ignored)

The diagram source is [\`architecture.mmd\`](architecture.mmd); the README uses [\`architecture.svg\`](architecture.svg).`,
    },
    {
      heading: "Verification",
      body: `## Verification

From a fresh clone:

\`\`\`bash
bun install --frozen-lockfile
bun run verify
\`\`\`

Expected: \`bun run check\` (format, lint, typecheck) and \`bun run build\` (React) exit 0; the integration tests report \`24 pass\`, \`0 fail\`.

Production check:

\`\`\`bash
bun run build
bun run start
\`\`\`

Then confirm:

\`\`\`powershell
curl.exe -s -o NUL -w "%{http_code}\`n" http://localhost:3000/
curl.exe -s -o NUL -w "%{http_code}\`n" http://localhost:3000/some/deep/link
curl.exe -s -i http://localhost:3000/api
curl.exe -s -i http://localhost:3000/api/unknown
\`\`\`

Expected: \`200\`, \`200\`, and JSON \`404\` responses for both \`/api\` and \`/api/unknown\`.

Manual browser checks (when a browser is available): open <http://localhost:5173> with \`bun run dev\`, add a note, refresh, and confirm the note remains. The API process must be running on port 3000.`,
    },
  ],
  angular: [
    {
      heading: "Stack",
      body: `## Stack

- **Client:** Angular 22 on the Angular CLI (standalone, zoneless, Signal Forms) with TanStack Angular Query.
- **API:** NestJS controllers, modules, and services using Fastify on Bun.
- **Shared data layer:** an oRPC v1 contract and framework-free oRPC fetch helpers in \`shared/\`. Zod validates request bodies; the client and the server use the same route and response types.
- **Data:** Effect handles storage errors; Drizzle accesses SQLite through \`bun:sqlite\`.

![Notes request flow: the Angular client shares an oRPC v1 contract with the NestJS controller, which calls a service backed by Drizzle and SQLite.](architecture.svg)`,
    },
    {
      heading: "Develop",
      body: `## Develop

\`\`\`bash
bun run dev:angular
\`\`\`

- Client: <http://localhost:5173> (Angular dev server)
- API: <http://localhost:3000>
- \`client-angular/proxy.conf.mjs\` proxies \`/api\` to the API on \`PORT\`, defaulting to 3000.

Angular dependency prebundling is disabled because Bun's isolated install places shared dependencies outside the Angular client's resolution path.

\`bun run dev:angular\` starts both processes with \`bun run --parallel\`, so no second terminal or extra tooling is needed. The two-terminal path also works: \`bun run dev:server\` plus \`bun run --filter client-angular start\`.`,
    },
    {
      heading: "Build and static checks",
      body: `## Build and static checks

\`\`\`bash
bun run check
\`\`\`

\`bun run check\` runs two steps:

1. \`vp check\` — Vite+ formatting (Oxfmt) across \`client-angular/\`, \`server/\`, and \`shared/\`, plus linting (Oxlint) and full TypeScript checks (type-aware Oxlint with \`typescript-go\`/tsgolint) across \`server/\` and \`shared/\`. Run it from the repository root so the root \`vite.config.ts\` applies.
2. \`bun run --filter client-angular lint\` — angular-eslint 22.8.0 over \`client-angular/\` TypeScript and templates (inline and external), running on Bun with the workspace's TypeScript 6.0.3.

\`client-angular\` is formatted by \`vp check\` but stays out of its lint and type-check legs: tsrs runs TypeScript 7 and Angular 22 rejects that version, and oxlint has no Angular template rules. Its real type gate is \`ng build\`.

\`bun run typecheck\` is the same type check without formatting, linting, or Angular: \`vp check --no-fmt --no-lint\`.

\`bun run verify\` is the full gate: \`check\` + \`test\` + \`build\`.`,
    },
    {
      heading: "Vite+ tooling",
      body: `## Vite+ tooling

This baseline uses the project-local Vite+ CLI (\`vite-plus@1.7.0\`); no global install is needed.

| Tool | Status | Notes |
| --- | --- | --- |
| \`vp dev\` | Not used | The Angular CLI serves the app (\`bun run dev:angular\`). |
| \`vp build\` | Not used | The Angular CLI builds the app; \`bun run build\` runs it. |
| \`vp check\` | Active | Oxfmt over \`client-angular/\`, \`server/\`, and \`shared/\`; Oxlint and full type checks over \`server/\` and \`shared/\`; the normal static check (\`bun run check\`). |
| \`vp fmt\`, \`vp lint\` | Active via \`vp check\` | Root config lives in \`vite.config.ts\`; \`client-angular/**\` is formatted but outside the lint/type-check scope; generated and build paths are ignored. |
| \`vp test\` / Vitest | Not used | The only tests are server integration tests; see below. |
| \`vp run\` | Not used | Root scripts already delegate through Bun workspace filters; Vite Task would duplicate that plumbing. |
| \`vp create\` / \`vp migrate\` | Not used | The project is hand-authored; generators and codemods are out of scope. |
| \`vp pack\` / tsdown | Not applicable | No library package is published from this app. |

Server tests use \`bun:test\` on purpose: they exercise the NestJS/Fastify app against an in-memory \`bun:sqlite\` database through the checked-in Drizzle migration. \`bun run test\` delegates to \`bun test\` in \`server/\`.`,
    },
    {
      heading: "Production",
      body: `## Production

\`\`\`bash
bun run build
CLIENT_DIST=client-angular/dist bun run start
\`\`\`

PowerShell:

\`\`\`powershell
$env:CLIENT_DIST = "client-angular/dist"; bun run start
\`\`\`

- The Bun process serves \`/api/*\` and the client build named by \`CLIENT_DIST\`. Set it to \`client-angular/dist\` for this flavor, as above.
- \`GET /api/*\` misses return JSON 404s and never fall through to \`index.html\`.
- Other GET paths fall back to \`index.html\` for client-side routing.
- Compressible responses of at least 1024 bytes are gzip-compressed when the client requests gzip; the plugin also supports other negotiated encodings.
- Hashed build files are served with \`Cache-Control: public, max-age=31536000, immutable\`: any file whose name carries an 8+ character content hash at any depth (Angular emits those at the output root). \`index.html\` (including the SPA fallback) is \`no-cache\`, so deploys are picked up immediately.
- Default port: 3000. Override with \`PORT\`.
- Default database: \`server/data/app.db\`. Override with \`DATABASE_PATH\`.`,
    },
    { heading: "Schema variants", body: null },
    { heading: "Database variants", body: null },
    {
      heading: "Removing or renaming the Notes example",
      body: `## Removing or renaming the Notes example

Delete or replace these files together:

- \`client-angular/src/app/notes/notes-page.ts\` — the Angular page
- \`client-angular/src/app/notes/notes.service.ts\` — the Angular queries and mutation
- \`shared/api.ts\` — the typed client and Notes helpers
- \`shared/notes.contract.ts\` — the shared contract
- \`shared/notes.meta.ts\` — the Notes path and metadata
- \`server/src/notes/notes.controller.ts\`
- \`server/src/notes/notes.errors.ts\`
- \`server/src/notes/notes.module.ts\`
- \`server/src/notes/notes.service.ts\`
- \`server/src/notes/schema.ts\`
- \`server/drizzle/\` — the Notes migration history
- \`server/test/notes.test.ts\`
- \`server/test/contract.cases.ts\` and \`server/test/contract.test.ts\` — the shared contract tests

Then:

- Remove \`NotesModule\` from the imports in \`server/src/app.ts\`.
- Remove the Notes import, export, and entry from \`server/src/schema.ts\`; add your replacement schema there.
- Update \`server/drizzle.config.ts\` if the replacement schema is not exported by \`server/src/schema.ts\`.
- Replace the Notes-based compression test in \`server/test/hosting.test.ts\` with one that exercises a sufficiently large response from your replacement application.
- Remove \`server/data/\` for a clean database.
- Remove the \`NotesPage\` entry from \`client-angular/src/app/app.routes.ts\`.
- Keep the root workspace, \`client-angular/angular.json\`, \`client-angular/proxy.conf.mjs\`, \`server/src/db.ts\`, and the static-hosting code.

To rename rather than remove, replace \`Notes\` and \`notes\` consistently across those files and change the \`/api/notes\` path in \`shared/notes.meta.ts\`, then regenerate migrations only if the table name changes.`,
    },
    {
      heading: "Layout",
      body: `## Layout

- \`client-angular/\` — Angular 22, Angular CLI, Signal Forms, TanStack Angular Query, oRPC OpenAPI client
- \`server/\` — NestJS/Fastify on Bun, oRPC v1, Effect, Zod, Drizzle, SQLite
- \`shared/\` — \`notes.meta.ts\`, the oRPC v1 API contract, and the framework-free oRPC client the client imports
- \`server/data/\` — persistent SQLite files (ignored)

The diagram source is [\`architecture.mmd\`](architecture.mmd); the README uses [\`architecture.svg\`](architecture.svg).`,
    },
    {
      heading: "Verification",
      body: `## Verification

From a fresh clone:

\`\`\`bash
bun install --frozen-lockfile
bun run verify
\`\`\`

Expected: \`bun run check\` (format, lint, typecheck, angular-eslint) and \`bun run build\` (Angular) exit 0; the integration tests report \`24 pass\`, \`0 fail\`.

Production check:

\`\`\`bash
bun run build
CLIENT_DIST=client-angular/dist bun run start
\`\`\`

Then confirm:

\`\`\`powershell
curl.exe -s -o NUL -w "%{http_code}\`n" http://localhost:3000/
curl.exe -s -o NUL -w "%{http_code}\`n" http://localhost:3000/some/deep/link
curl.exe -s -i http://localhost:3000/api
curl.exe -s -i http://localhost:3000/api/unknown
\`\`\`

Expected: \`200\`, \`200\`, and JSON \`404\` responses for both \`/api\` and \`/api/unknown\`.

Manual browser checks (when a browser is available): open <http://localhost:5173> with \`bun run dev:angular\`, add a note, refresh, and confirm the note remains. The API process must be running on port 3000.`,
    },
  ],
};

const README_LINE_EDITS: Record<Flavor, Array<[find: string, replacement: string]>> = {
  react: [
    [
      "A Bun workspace with two client flavors — React 19 and Angular 22 — against one NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
      "A Bun workspace with a React 19 client against a NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
    ],
    [
      "- Node.js 24.15 or newer. The Angular CLI 22 requires `^22.22.3 || ^24.15.0 || >=26.0.0`; this repository is verified on 24.19.0 and CI pins that version.",
      "- Node.js 24.15 or newer (verified on 24.19.0).",
    ],
    [
      "`shared/api.ts` is a contract-driven oRPC OpenAPI client that both flavors import. No generated API client is needed.",
      "`shared/api.ts` is a contract-driven oRPC OpenAPI client that the client imports. No generated API client is needed.",
    ],
    [
      "Clients import the shared data layer, not the server application.",
      "The client imports the shared data layer, not the server application.",
    ],
    [
      "The checked-in React and Angular clients use SCSS. `lwapp` defaults to SCSS and also offers `--tailwind` and `--both`.\n\nThe `both` choice runs two pipelines: Tailwind in a plain `.css` entry and SCSS in its own entry. No Tailwind directive lives inside a `.scss` file, because the Tailwind Vite plugin ignores Sass files.\n\n",
      "",
    ],
  ],
  angular: [
    [
      "- Node.js 24.15 or newer. The Angular CLI 22 requires `^22.22.3 || ^24.15.0 || >=26.0.0`; this repository is verified on 24.19.0 and CI pins that version.",
      "- Node.js 24.15 or newer. The Angular CLI 22 requires `^22.22.3 || ^24.15.0 || >=26.0.0`.",
    ],
    [
      "A Bun workspace with two client flavors — React 19 and Angular 22 — against one NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
      "A Bun workspace with an Angular 22 client against a NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
    ],
    [
      "`@client/...` resolves to `client/src/`, `@server/...` to `server/src/`, and `@shared/...` to `shared/`. Clients import the shared data layer, not the server application.",
      "`@server/...` resolves to `server/src/`, and `@shared/...` to `shared/`. The client imports the shared data layer, not the server application.",
    ],
    [
      "`shared/api.ts` is a contract-driven oRPC OpenAPI client that both flavors import. No generated API client is needed.",
      "`shared/api.ts` is a contract-driven oRPC OpenAPI client that the Angular client imports. No generated API client is needed.",
    ],
    [
      "- No client tests, matching the React flavor. The server suite covers the shared data layer for both.",
      "- No client tests. The server suite covers the shared data layer.",
    ],
    [
      "the root and the React client stay on TypeScript 7",
      "the root and the server stay on TypeScript 7",
    ],
    [
      "The checked-in React and Angular clients use SCSS. `lwapp` defaults to SCSS and also offers `--tailwind` and `--both`.\n\nThe `both` choice runs two pipelines: Tailwind in a plain `.css` entry and SCSS in its own entry. No Tailwind directive lives inside a `.scss` file, because the Tailwind Vite plugin ignores Sass files.\n\n",
      "",
    ],
  ],
};

const VITE_LINE_EDITS: Record<Flavor, Array<[find: string, replacement: string]>> = {
  react: [
    [
      `//
// client-angular is formatted here (Oxfmt handles Angular inline templates and
// .component.html files), but it is outside the lint leg on purpose: tsrs runs
// TypeScript 7, which Angular 22 rejects, and oxlint has no Angular template
// rules. Its gates are \`ng build\` and angular-eslint (the third step of \`check\`).
`,
      "",
    ],
    ['      "client-angular/**",\n', ""],
    ['      "client/variants/**",\n', ""],
    ['      "client-angular/dist/**",\n', ""],
    ['      "client-angular/.angular/**",\n', ""],
  ],
  angular: [
    [
      "Its gates are `ng build` and angular-eslint (the third step of `check`).",
      "Its gates are `ng build` and angular-eslint (the second step of `check`).",
    ],
    ['      "client/variants/**",\n', ""],
  ],
};

const VITE_REMOVE_ALL: Record<Flavor, Array<{ find: string; count: number }>> = {
  react: [],
  angular: [
    { find: '      "client/dist/**",\n', count: 2 },
    { find: '      "client/src/routeTree.gen.ts",\n', count: 2 },
    { find: '      "client/.tanstack/**",\n', count: 2 },
  ],
};

const VITE_CLI_EDITS: Array<[find: string, replacement: string]> = [
  ['      "cli/dist/**",\n      "cli/templates/**",\n      "cli/overlays/**",\n', ""],
  ['      "cli/dist/**",\n', ""],
];

const REACT_TEST_REWRITES: Array<{
  path: string;
  find: string;
  replacement: string;
  count: number;
}> = [
  {
    path: "server/test/env.cases.ts",
    find: '"client-angular/dist"',
    replacement: '"custom/dist"',
    count: 2,
  },
];

function stripCliGitignore(text: string): string {
  assertContains(text, "# Generated CLI artifacts", ".gitignore");
  const withoutBlock = text.replace(/\n*# Generated CLI artifacts\n(?:cli\/[^\n]*\n)+/, "");
  const stripped = `${withoutBlock.trimEnd()}\n`;
  if (/(?:^|\n)cli\//.test(stripped)) {
    throw new SyncError(".gitignore: CLI entries survived the strip");
  }
  return stripped;
}

const GITIGNORE_EDITS: Record<Flavor, Array<[find: string, replacement: string]>> = {
  react: [["\n\nclient-angular/dist/\nclient-angular/.angular/\n", "\n"]],
  angular: [
    ["node_modules/\nclient/dist/\nclient/src/routeTree.gen.ts\n.env", "node_modules/\n.env"],
  ],
};

function isExcluded(file: string, flavor: Flavor): boolean {
  if (EXCLUDED_FILES.has(file)) return true;
  if (
    /^server\/test\/(?:.*-(?:postgres|effect)\.test\.ts|env-postgres.*\.test\.ts|test-database.*\.ts)$/.test(
      file,
    )
  )
    return true;
  const name = file.replace(/\/$/, "").split("/").pop() ?? "";
  if (name === "node_modules" || name === ".env" || name.startsWith(".env.")) return true;
  if (/\.db(?:-wal|-shm)?$/.test(name)) return true;
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
  return file.startsWith(`${OTHER_CLIENT_DIR[flavor]}/`);
}

async function sourceFiles(flavor: Flavor, base = ""): Promise<string[]> {
  return walkFiles(join(REPO_ROOT, base), base, (path, directory) =>
    isExcluded(directory ? `${path}/` : path, flavor),
  );
}

function mappedName(file: string): string {
  const parts = file.split("/");
  const base = parts.pop() ?? "";
  return [...parts, DOTFILES[base] ?? base].join("/");
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function editFile(
  root: string,
  path: string,
  edits: Array<[find: string, replacement: string]>,
): Promise<void> {
  const file = join(root, path);
  let text = await readFile(file, "utf8");
  for (const [find, replacement] of edits) {
    text = replaceOnce(text, find, replacement, path);
  }
  await writeFile(file, text);
}

async function editPackageJson(flavor: Flavor, root: string): Promise<void> {
  const file = join(root, "package.json");
  const where = `package.json (${flavor})`;
  const pkg = await readJson<PackageJson>(file);
  const workspaces = pkg.workspaces;
  if (!Array.isArray(workspaces)) throw new SyncError(`${where}: workspaces is not an array`);
  for (const required of ["cli", "client", "client-angular", "server", "shared"]) {
    if (!workspaces.includes(required)) {
      throw new SyncError(`${where}: workspaces is missing ${JSON.stringify(required)}`);
    }
  }
  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== "object") throw new SyncError(`${where}: scripts is missing`);
  for (const required of ["templates:sync", "test:cli", "test"]) {
    if (typeof scripts[required] !== "string") {
      throw new SyncError(`${where}: scripts.${required} is missing`);
    }
  }
  if (!scripts.test.startsWith("bun run --filter server test")) {
    throw new SyncError(`${where}: scripts.test no longer starts with the server leg`);
  }
  const overrides = pkg.overrides;
  const angularBuildOverride = overrides?.["@angular/build"];
  if (
    !overrides ||
    !angularBuildOverride ||
    typeof angularBuildOverride === "string" ||
    typeof angularBuildOverride["vite"] !== "string"
  ) {
    throw new SyncError(`${where}: overrides["@angular/build"].vite is missing`);
  }

  pkg.workspaces = [CLIENT_DIR[flavor], "server", "shared"];
  scripts.test = "bun run --filter server test";

  if (flavor === "react") {
    for (const key of ["dev:angular", "dev:angular-client", "dev:angular-server"]) {
      if (typeof scripts[key] !== "string")
        throw new SyncError(`${where}: scripts.${key} is missing`);
    }
    if (
      scripts.build !== "bun run --filter client build && bun run --filter client-angular build"
    ) {
      throw new SyncError(`${where}: scripts.build does not match the expected two-client form`);
    }
    scripts.build = "bun run --filter client build";
    if (scripts.check !== "bun run routes && vp check && bun run --filter client-angular lint") {
      throw new SyncError(`${where}: scripts.check does not match the expected Angular-lint form`);
    }
    scripts.check = "bun run routes && vp check";
    if (scripts.typecheck !== "bun run routes && vp check --no-fmt --no-lint") {
      throw new SyncError(`${where}: scripts.typecheck does not match the expected React form`);
    }
    delete overrides["@angular/build"];
  } else {
    for (const key of ["dev", "dev:client", "routes"]) {
      if (typeof scripts[key] !== "string")
        throw new SyncError(`${where}: scripts.${key} is missing`);
    }
    if (
      scripts.build !== "bun run --filter client build && bun run --filter client-angular build"
    ) {
      throw new SyncError(`${where}: scripts.build does not match the expected two-client form`);
    }
    scripts.build = "bun run --filter client-angular build";
    if (scripts.typecheck !== "bun run routes && vp check --no-fmt --no-lint") {
      throw new SyncError(`${where}: scripts.typecheck does not match the expected React form`);
    }
    scripts.typecheck = "vp check --no-fmt --no-lint";
    if (scripts.check !== "bun run routes && vp check && bun run --filter client-angular lint") {
      throw new SyncError(`${where}: scripts.check does not match the expected Angular-lint form`);
    }
    scripts.check = "vp check && bun run --filter client-angular lint";
  }

  const allowedScripts =
    flavor === "react"
      ? [
          "dev",
          "dev:client",
          "dev:server",
          "routes",
          "build",
          "typecheck",
          "check",
          "verify",
          "test",
          "db:generate",
          "db:migrate",
          "start",
        ]
      : [
          "dev:angular",
          "dev:angular-client",
          "dev:angular-server",
          "dev:server",
          "build",
          "typecheck",
          "check",
          "verify",
          "test",
          "db:generate",
          "db:migrate",
          "start",
        ];
  pkg.scripts = Object.fromEntries(
    allowedScripts.map((key) => {
      const value = scripts[key];
      if (typeof value !== "string") throw new SyncError(`${where}: scripts.${key} is missing`);
      return [key, value];
    }),
  );
  await writeJson(file, pkg);
}

async function editReadme(flavor: Flavor, root: string): Promise<void> {
  const file = join(root, "README.md");
  const where = `README.md (${flavor})`;
  let text = await readFile(file, "utf8");
  text = replaceOnce(
    text,
    "Start a project with [`lwapp`](cli/README.md):\n\n```bash\nnpx lwapp my-app\n```\n\n",
    "",
    where,
  );
  const contributing = await diskReadFile(join(REPO_ROOT, "CONTRIBUTING.md"), "utf8");
  const moved = ["Install", "Develop", "Build and static checks", "Verification"].map((heading) => {
    const start = contributing.indexOf(`## ${heading}\n`);
    if (start < 0) throw new SyncError(`CONTRIBUTING.md: missing section "## ${heading}"`);
    const next = contributing.indexOf("\n## ", start + heading.length + 4);
    const section = contributing.slice(start, next < 0 ? undefined : next).trim();
    const sentinel = heading === "Install" ? "bun install" : README_SENTINELS[heading];
    if (!sentinel) throw new SyncError(`CONTRIBUTING.md: no sentinel for section ${heading}`);
    assertContains(section, sentinel, `CONTRIBUTING.md (## ${heading})`);
    return heading === "Install" ? section : `## ${heading}\n\n${sentinel}`;
  });
  text = replaceOnce(
    text,
    "## Vite+ tooling\n",
    `${moved.slice(0, 3).join("\n\n")}\n\n## Vite+ tooling\n`,
    where,
  );
  text = `${text.trimEnd()}\n\n${moved[3]}\n`;
  for (const section of README_SECTIONS[flavor]) {
    const sentinel = README_SENTINELS[section.heading];
    if (!sentinel) throw new SyncError(`${where}: no sentinel for section ${section.heading}`);
    text =
      section.body === null
        ? dropH2(text, section.heading, sentinel, where)
        : replaceH2(text, section.heading, section.body, sentinel, where);
  }
  for (const [find, replacement] of README_LINE_EDITS[flavor]) {
    text = replaceOnce(text, find, replacement, where);
  }
  await writeFile(file, text);
}

async function trimTemplateSharedPackage(flavor: Flavor, root: string): Promise<void> {
  const file = join(root, "shared", "package.json");
  const where = `shared/package.json (${flavor})`;
  const pkg = await readJson<PackageJson>(file);
  const dependencies = pkg.dependencies;
  if (!dependencies) throw new SyncError(`${where}: dependencies is missing`);
  if (typeof dependencies["zod"] !== "string") {
    throw new SyncError(`${where}: expected a zod dependency`);
  }
  if (typeof dependencies["effect"] !== "string") {
    throw new SyncError(`${where}: expected an effect dependency to trim`);
  }
  delete dependencies["effect"];
  await writeJson(file, pkg);
}

async function trimTemplateServerPackage(flavor: Flavor, root: string): Promise<void> {
  const file = join(root, "server", "package.json");
  const where = `server/package.json (${flavor})`;
  const pkg = await readJson<PackageJson>(file);
  if (pkg.scripts) delete pkg.scripts["db:generate:pg"];
  const dependencies = pkg.dependencies;
  if (!dependencies) throw new SyncError(`${where}: dependencies is missing`);
  if (typeof dependencies["postgres"] !== "string") {
    throw new SyncError(`${where}: expected a postgres dependency to trim`);
  }
  delete dependencies["postgres"];
  await writeJson(file, pkg);
}

async function transform(flavor: Flavor, root: string): Promise<void> {
  await trimTemplateSharedPackage(flavor, root);
  await trimTemplateServerPackage(flavor, root);
  await editPackageJson(flavor, root);
  await editFile(root, "vite.config.ts", [...VITE_CLI_EDITS, ...VITE_LINE_EDITS[flavor]]);
  for (const removal of VITE_REMOVE_ALL[flavor]) {
    const file = join(root, "vite.config.ts");
    let text = await readFile(file, "utf8");
    text = replaceAllCount(text, removal.find, "", removal.count, "vite.config.ts");
    await writeFile(file, text);
  }
  // The copy stored .gitignore under its placeholder name, so the trim edits
  // that file in place and leaves the dotted name to the runtime mapping.
  const gitignorePath = join(root, DOTFILES[".gitignore"]!);
  let gitignore = stripCliGitignore(await readFile(gitignorePath, "utf8"));
  for (const [find, replacement] of GITIGNORE_EDITS[flavor]) {
    gitignore = replaceOnce(gitignore, find, replacement, ".gitignore");
  }
  await writeFile(gitignorePath, gitignore);
  await editReadme(flavor, root);
  if (flavor === "react") {
    for (const rewrite of REACT_TEST_REWRITES) {
      const file = join(root, rewrite.path);
      const text = await readFile(file, "utf8");
      await writeFile(
        file,
        replaceAllCount(text, rewrite.find, rewrite.replacement, rewrite.count, rewrite.path),
      );
    }
  }
}

async function writeOverlayFile(
  outRoot: string,
  destination: string,
  source: string,
  edits: Array<[string, string]> = [],
): Promise<void> {
  let text = (await readFile(join(REPO_ROOT, source), "utf8")).replace(/\r\n/g, "\n");
  for (const [find, replacement] of edits) {
    text = replaceOnce(text, find, replacement, `${source} -> ${destination}`);
  }
  const file = join(outRoot, destination);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function editOverlayPackageJson(
  outRoot: string,
  destination: string,
  source: string,
  edit: (dependencies: Record<string, string>) => void,
): Promise<void> {
  const pkg = await readJson<PackageJson>(join(REPO_ROOT, source));
  if (destination === "server/package.json" && pkg.scripts) delete pkg.scripts["db:generate:pg"];
  const dependencies = pkg.dependencies;
  if (!dependencies) throw new SyncError(`${source}: dependencies is missing`);
  edit(dependencies);
  const file = join(outRoot, destination);
  await mkdir(dirname(file), { recursive: true });
  await writeJson(file, pkg);
}

const PG_REMOVALS = ["server/drizzle.config.ts", "server/drizzle/"];

const PG_README_EDITS: Array<[string, string]> = [
  [
    "- **Data:** Effect handles storage errors; Drizzle accesses SQLite through `bun:sqlite`.",
    "- **Data:** Effect handles storage errors; Drizzle accesses PostgreSQL through `postgres.js`.",
  ],
  [
    "which calls a service backed by Drizzle and SQLite.](architecture.svg)",
    "which calls a service backed by Drizzle and PostgreSQL.](architecture.svg)",
  ],
  [
    "Server tests use `bun:test` on purpose: they exercise the NestJS/Fastify app against an in-memory `bun:sqlite` database through the checked-in Drizzle migration. `bun run test` delegates to `bun test` in `server/`.",
    "Server tests use `bun:test` on purpose: they exercise the NestJS/Fastify app against a temporary PostgreSQL database (`starter_test_<random>`) that the suite creates on the server named by `DATABASE_URL`, applies the checked-in migrations to, and drops afterwards; this needs `CREATEDB`. Databases you keep are never migrated or mutated — the suite connects to the named database only to administer its temporary one — and abrupt termination can leave a temporary database behind (cleanup is best-effort). Without `DATABASE_URL` the PostgreSQL tests skip. `bun run test` delegates to `bun test` in `server/`.",
  ],
  [
    "; the integration tests report `24 pass`, `0 fail`.",
    "; with `DATABASE_URL` set (the role needs `CREATEDB`) the integration tests report `24 pass`, `0 fail`. Without `DATABASE_URL` the PostgreSQL tests skip: `7 pass`, `23 skip`, `0 fail`.",
  ],
  [
    "- Default database: `server/data/app.db`. Override with `DATABASE_PATH`.",
    "- Default database: the PostgreSQL database named by `DATABASE_URL` (`postgres://` or `postgresql://`).",
  ],
  [
    "- `server/drizzle/` — the Notes migration history",
    "- `server/drizzle-pg/` — the Notes migration history",
  ],
  [
    "- Remove `server/data/` for a clean database.",
    "- Drop and recreate the database named by `DATABASE_URL` for a clean slate.",
  ],
  // The template Layout is a sync-owned section with a hardcoded body: it has no
  // drizzle-history bullet, and the live Layout is replaced wholesale. Add the pg
  // history bullet by swapping the SQLite data bullet. The Removing section's own
  // `server/drizzle/` bullet is edited just above, so both places read pg.
  [
    "- `server/data/` — persistent SQLite files (ignored)",
    "- `server/drizzle-pg/` — the Notes migration history",
  ],
];

// Two template sections describe SQLite field by field, so they are replaced
// wholesale rather than patched line by line (replaceH2 keeps the rest of
// the README intact and verifies the sentinel first). Arrays keep the
// literal lines at column 1, so no accidental indentation reaches the README.
const PG_ENVIRONMENT_SECTION = [
  "## Environment",
  "",
  "The server validates its environment at boot in `server/src/env.ts` and fails fast on invalid values:",
  "",
  "| Variable | Default | Notes |",
  "| --- | --- | --- |",
  "| `PORT` | `3000` | Integer, 1-65535 |",
  "| `DATABASE_URL` | required | `postgres://` or `postgresql://` with a host and database path |",
  "| `CLIENT_DIST` | `client/dist` | Client build directory; absolute, or relative to the repository root |",
  "| `NODE_ENV` | `development` | `development`, `test`, or `production` |",
].join("\n");

const PG_DATABASE_SECTION = [
  "## Database",
  "",
  "- Required: `DATABASE_URL` (`postgres://` or `postgresql://`) with a host and database path",
  "- The server connects with `postgres.js` through Drizzle's `postgres-js` adapter",
  "- Startup applies pending migrations automatically; logs show host and database name only, never credentials",
  "- Behind a transaction-mode pooler (PgBouncer, some hosted poolers) prepared statements fail: connect through the direct port for migrations, or pass `prepare: false` to `postgres()` if the provider requires it",
  "- Integration tests create and drop their own temporary database (`starter_test_<random>`) on the server named by `DATABASE_URL`; this needs `CREATEDB`. Databases you keep are never migrated or mutated — the tests connect to the named database only to administer their temporary one — and abrupt termination can leave a temporary database behind (cleanup is best-effort)",
  "",
  "Generate a migration after changing `server/src/notes/schema.ts`:",
  "",
  "```bash",
  "bun run db:generate",
  "```",
  "",
  "Apply migrations explicitly:",
  "",
  "```bash",
  "DATABASE_URL=postgres://user:pass@localhost:5432/my_app bun run db:migrate",
  "```",
  "",
  "Expected output: `Migrated localhost:5432/my_app` (the URL's credentials are never logged). The generated `server/drizzle-pg/` directory is checked in.",
].join("\n");

const PG_README_SECTIONS = [
  { heading: "Environment", body: PG_ENVIRONMENT_SECTION, sentinel: "DATABASE_PATH" },
  { heading: "Database", body: PG_DATABASE_SECTION, sentinel: "DATABASE_PATH" },
];

const PG_LAYOUT_EDIT: [string, string] = ["Drizzle, SQLite", "Drizzle, PostgreSQL"];

const EFFECT_README_EDITS: Array<[string, string]> = [
  ["Zod validates request bodies;", "Effect Schema validates request bodies;"],
  ["Effect, Zod, Drizzle", "Effect, Drizzle"],
];

interface OverlayReadmeOptions {
  sections?: Array<{ heading: string; body: string; sentinel: string }>;
  edits?: Array<[string, string]>;
}

async function writeOverlayReadme(
  flavor: Flavor,
  outRoot: string,
  templatesRoot: string,
  options: OverlayReadmeOptions = {},
): Promise<void> {
  const where = `README.md overlay (${flavor})`;
  let text = await readFile(join(templatesRoot, flavor, "README.md"), "utf8");
  for (const section of options.sections ?? []) {
    text = replaceH2(text, section.heading, section.body, section.sentinel, where);
  }
  for (const [find, replacement] of options.edits ?? []) {
    text = replaceOnce(text, find, replacement, where);
  }
  const file = join(outRoot, "README.md");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function writeRemovals(outRoot: string): Promise<void> {
  const file = join(outRoot, "removals.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(PG_REMOVALS, null, 2)}\n`);
}

// Removal entries are root-relative, the same shape `applyRemovals` compares
// against `written`: the scaffold writes `client/...` and `client-angular/...`
// paths, so a bare `src/styles.scss` would never match. Directory entries end
// in `/` so `applyRemovals` prunes them.
const STYLE_OVERLAY_REMOVALS: Record<Flavor, Record<"tailwind" | "both", string[]>> = {
  react: {
    tailwind: ["client/src/styles.scss", "client/src/styles/"],
    both: [],
  },
  angular: {
    tailwind: [
      "client-angular/src/styles.scss",
      "client-angular/src/styles/",
      "client-angular/src/app/app.scss",
      "client-angular/src/app/notes/notes-page.scss",
    ],
    both: [],
  },
};

async function writeStyleOverlay(
  flavor: Flavor,
  style: "style-tailwind" | "style-both",
  outRoot: string,
): Promise<void> {
  const variant = style === "style-tailwind" ? "tailwind" : "both";
  const variantRoot = `${CLIENT_DIR[flavor]}/variants/${variant}`;
  for (const file of await listFiles(join(REPO_ROOT, variantRoot))) {
    await writeOverlayFile(
      outRoot,
      mappedName(`${CLIENT_DIR[flavor]}/${file}`),
      `${variantRoot}/${file}`,
    );
  }
  const removalsFile = join(outRoot, "removals.json");
  await mkdir(dirname(removalsFile), { recursive: true });
  await writeFile(
    removalsFile,
    `${JSON.stringify(STYLE_OVERLAY_REMOVALS[flavor][variant], null, 2)}\n`,
  );
}

async function writeEffectContract(outRoot: string): Promise<void> {
  for (const file of await listFiles(join(REPO_ROOT, "shared/variants/effect"))) {
    if (file !== "notes.contract.ts") throw new SyncError(`Unhandled effect variant file: ${file}`);
    await writeOverlayFile(outRoot, `shared/${file}`, `shared/variants/effect/${file}`, [
      ['from "../../notes.meta"', 'from "./notes.meta"'],
    ]);
  }
}

async function writeEffectSqliteOverlay(
  flavor: Flavor,
  outRoot: string,
  templatesRoot: string,
): Promise<void> {
  await writeEffectContract(outRoot);
  for (const file of await listFiles(join(REPO_ROOT, "server/src/variants/effect"))) {
    if (file !== "env.ts") throw new SyncError(`Unhandled effect variant file: ${file}`);
    await writeOverlayFile(outRoot, `server/src/${file}`, `server/src/variants/effect/${file}`, [
      ['resolve(import.meta.dir, "../../../..")', 'resolve(import.meta.dir, "../..")'],
    ]);
  }
  await writeOverlayFile(outRoot, "server/test/env.test.ts", "server/test/env-effect.test.ts", [
    ['"@server/variants/effect/env"', '"@server/env"'],
  ]);
  await writeOverlayFile(
    outRoot,
    "server/test/contract.test.ts",
    "server/test/contract-effect.test.ts",
    [['"@shared/variants/effect/notes.contract"', '"@shared/notes.contract"']],
  );
  await editOverlayPackageJson(
    outRoot,
    "shared/package.json",
    "shared/package.json",
    (dependencies) => {
      if (typeof dependencies["zod"] !== "string") {
        throw new SyncError("shared/package.json: expected a zod dependency to drop");
      }
      if (typeof dependencies["effect"] !== "string") {
        throw new SyncError("shared/package.json: expected an effect dependency");
      }
      delete dependencies["zod"];
    },
  );
  await editOverlayPackageJson(
    outRoot,
    "server/package.json",
    "server/package.json",
    (dependencies) => {
      if (typeof dependencies["zod"] !== "string") {
        throw new SyncError("server/package.json: expected a zod dependency to drop");
      }
      if (typeof dependencies["effect"] !== "string") {
        throw new SyncError("server/package.json: expected an effect dependency");
      }
      if (typeof dependencies["postgres"] !== "string") {
        throw new SyncError("server/package.json: expected a postgres dependency to trim");
      }
      delete dependencies["zod"];
      delete dependencies["postgres"];
    },
  );
  await writeOverlayReadme(flavor, outRoot, templatesRoot, { edits: EFFECT_README_EDITS });
}

async function writePostgresOverlay(
  flavor: Flavor,
  set: "zod-postgres" | "effect-postgres",
  outRoot: string,
  templatesRoot: string,
): Promise<void> {
  const effect = set === "effect-postgres";
  if (effect) {
    const files = await listFiles(join(REPO_ROOT, "server/src/variants/effect-postgres"));
    if (files.length !== 1 || files[0] !== "env.ts")
      throw new SyncError(`Unhandled effect-postgres variant files: ${files.join(", ")}`);
  }

  await writeOverlayReadme(flavor, outRoot, templatesRoot, {
    sections: PG_README_SECTIONS,
    edits: [PG_LAYOUT_EDIT, ...PG_README_EDITS, ...(effect ? EFFECT_README_EDITS : [])],
  });

  // The diagram must agree with the selected database: the overlay replaces
  // the tree's SQLite mmd/svg pair with the PostgreSQL flavor. The SVG is a
  // generated artifact committed beside its source in cli/scripts/assets/;
  // regenerate it with the Pele renderer after editing the mmd.
  await writeOverlayFile(
    outRoot,
    "architecture.mmd",
    "cli/scripts/assets/architecture.postgres.mmd",
  );
  await writeOverlayFile(
    outRoot,
    "architecture.svg",
    "cli/scripts/assets/architecture.postgres.svg",
  );

  await writeOverlayFile(
    outRoot,
    "server/src/database-url.ts",
    "server/src/variants/shared/database-url.ts",
  );
  const variantEdits: Record<string, Array<[string, string]>> = {
    "db.ts": [
      ['"@server/variants/postgres/schema"', '"@server/schema"'],
      ['"@server/variants/postgres/env"', '"@server/env"'],
      ['"../shared/database-url"', '"./database-url"'],
      [
        'new URL("../../../drizzle-pg", import.meta.url)',
        'new URL("../drizzle-pg", import.meta.url)',
      ],
    ],
    "schema.ts": [['"@server/variants/postgres/notes/schema"', '"@server/notes/schema"']],
    "notes/schema.ts": [],
    "notes/notes.service.ts": [
      ['"@server/variants/postgres/schema"', '"@server/schema"'],
      ['"@server/variants/postgres/notes/schema"', '"@server/notes/schema"'],
    ],
    "index.ts": [
      ['"@server/variants/postgres/db"', '"@server/db"'],
      ['"@server/variants/postgres/env"', '"@server/env"'],
      ['"@server/variants/postgres/notes/notes.module"', '"@server/notes/notes.module"'],
    ],
    "env.ts": [
      ['resolve(import.meta.dir, "../../../..")', 'resolve(import.meta.dir, "../..")'],
      ['"../shared/database-url"', '"./database-url"'],
    ],
    "drizzle.config.ts": [["./src/variants/postgres/schema.ts", "./src/schema.ts"]],
  };
  for (const file of await listFiles(join(REPO_ROOT, "server/src/variants/postgres"))) {
    if (file === "notes/notes.module.ts") continue; // Base module binds the overlaid service.
    const edits = variantEdits[file];
    if (!edits) throw new SyncError(`Unhandled postgres variant file: ${file}`);
    const source =
      file === "env.ts" && effect
        ? "server/src/variants/effect-postgres/env.ts"
        : `server/src/variants/postgres/${file}`;
    const destination =
      file === "drizzle.config.ts" ? "server/drizzle.config.ts" : `server/src/${file}`;
    await writeOverlayFile(outRoot, destination, source, edits);
  }
  for (const file of await listFiles(join(REPO_ROOT, "server/drizzle-pg"))) {
    await writeOverlayFile(outRoot, `server/drizzle-pg/${file}`, `server/drizzle-pg/${file}`);
  }

  await writeOverlayFile(outRoot, "server/test/env.cases.ts", "server/test/env-postgres.cases.ts");
  await writeOverlayFile(
    outRoot,
    "server/test/env.test.ts",
    effect ? "server/test/env-postgres-effect.test.ts" : "server/test/env-postgres.test.ts",
    [
      [
        effect ? '"@server/variants/effect-postgres/env"' : '"@server/variants/postgres/env"',
        '"@server/env"',
      ],
      ['"./env-postgres.cases"', '"./env.cases"'],
    ],
  );

  const testEdits: Array<[string, string]> = [
    ['"@server/variants/postgres/db"', '"@server/db"'],
    ['"@server/variants/postgres/notes/schema"', '"@server/notes/schema"'],
    ['"@server/variants/postgres/notes/notes.module"', '"@server/notes/notes.module"'],
  ];
  await writeOverlayFile(
    outRoot,
    "server/test/notes.test.ts",
    "server/test/notes-postgres.test.ts",
    testEdits,
  );
  await writeOverlayFile(
    outRoot,
    "server/test/hosting.test.ts",
    "server/test/hosting-postgres.test.ts",
    testEdits,
  );
  await writeOverlayFile(
    outRoot,
    "server/test/client-dist.test.ts",
    "server/test/client-dist-postgres.test.ts",
    [
      ['"@server/variants/postgres/index"', '"@server/index"'],
      ['"@server/variants/postgres/env"', '"@server/env"'],
    ],
  );
  await writeOverlayFile(outRoot, "server/test/test-database.ts", "server/test/test-database.ts");

  if (effect) {
    await writeEffectContract(outRoot);
    await writeOverlayFile(
      outRoot,
      "server/test/contract.test.ts",
      "server/test/contract-effect.test.ts",
      [['"@shared/variants/effect/notes.contract"', '"@shared/notes.contract"']],
    );
  }

  await editOverlayPackageJson(
    outRoot,
    "server/package.json",
    "server/package.json",
    (dependencies) => {
      if (typeof dependencies["postgres"] !== "string") {
        throw new SyncError("server/package.json: expected the postgres dependency");
      }
      if (!effect) return;
      if (typeof dependencies["zod"] !== "string") {
        throw new SyncError("server/package.json: expected a zod dependency to drop");
      }
      delete dependencies["zod"];
    },
  );
  if (effect) {
    await editOverlayPackageJson(
      outRoot,
      "shared/package.json",
      "shared/package.json",
      (dependencies) => {
        if (typeof dependencies["zod"] !== "string") {
          throw new SyncError("shared/package.json: expected a zod dependency to drop");
        }
        if (typeof dependencies["effect"] !== "string") {
          throw new SyncError("shared/package.json: expected an effect dependency");
        }
        delete dependencies["zod"];
      },
    );
  }
  await writeRemovals(outRoot);
}

async function writeOverlaySet(
  flavor: Flavor,
  set: OverlaySet,
  outRoot: string,
  templatesRoot: string,
): Promise<void> {
  if (set === "effect-sqlite") return writeEffectSqliteOverlay(flavor, outRoot, templatesRoot);
  return writePostgresOverlay(flavor, set, outRoot, templatesRoot);
}

async function copyTrackedFile(file: string, outRoot: string): Promise<void> {
  const raw = await readFile(join(REPO_ROOT, file));
  const data = raw.includes(0)
    ? raw
    : Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  const destination = join(outRoot, mappedName(file));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

function countFiles(dir: string): number {
  return [...assembled.keys()].filter((file) => file.startsWith(`${dir}${sep}`)).length;
}

const listFiles = walkFiles;

async function formatTemplates(templatesRoot: string, overlaysRoot: string): Promise<void> {
  // Explicit file paths bypass Oxfmt's directory walk, which honors the root
  // .gitignore entry for cli/templates/. Run from cli/, which has the
  // package.json Vite+ requires. Unsupported extensions are skipped.
  const files = [
    ...(await listFiles(templatesRoot, relative(CLI_ROOT, templatesRoot))),
    ...(await listFiles(overlaysRoot, relative(CLI_ROOT, overlaysRoot))),
  ];
  const result = spawnSync(process.execPath, [VP_BIN, "fmt", ...files], {
    cwd: CLI_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new SyncError("vp fmt failed on the generated templates");
}

async function main(): Promise<void> {
  const templatesRoot = join(ASSEMBLY_ROOT, "templates");
  const overlaysRoot = join(ASSEMBLY_ROOT, "overlays");
  for (const flavor of FLAVORS) {
    const outRoot = join(templatesRoot, flavor);
    for (const file of await sourceFiles(flavor)) {
      await copyTrackedFile(file, outRoot);
    }
    await transform(flavor, outRoot);
    console.log(`assembled ${flavor}: ${countFiles(outRoot)} files`);
    for (const set of OVERLAY_SETS) {
      const overlayRoot = join(overlaysRoot, flavor, set);
      await writeOverlaySet(flavor, set, overlayRoot, templatesRoot);
      console.log(`assembled ${flavor} overlay ${set}: ${countFiles(overlayRoot)} files`);
    }
    for (const style of ["style-tailwind", "style-both"] as const) {
      const overlayRoot = join(overlaysRoot, flavor, style);
      await writeStyleOverlay(flavor, style, overlayRoot);
      console.log(`assembled ${flavor} overlay ${style}: ${countFiles(overlayRoot)} files`);
    }
  }
  await rm(TEMPLATES_ROOT, { recursive: true, force: true });
  await rm(OVERLAYS_ROOT, { recursive: true, force: true });
  for (const [file, data] of assembled) {
    const destination = join(CLI_ROOT, relative(ASSEMBLY_ROOT, file));
    await diskMkdir(dirname(destination), { recursive: true });
    await diskWriteFile(destination, data);
  }
  await formatTemplates(TEMPLATES_ROOT, OVERLAYS_ROOT);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
