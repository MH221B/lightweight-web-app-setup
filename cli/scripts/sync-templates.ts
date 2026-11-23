#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Flavor = "react" | "angular";

interface PackageJson {
  name?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

const FLAVORS: Flavor[] = ["react", "angular"];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ROOT = join(REPO_ROOT, "cli");
const TEMPLATES_ROOT = join(CLI_ROOT, "templates");
const OVERLAYS_ROOT = join(CLI_ROOT, "overlays");
const VP_BIN = join(REPO_ROOT, "node_modules", "vite-plus", "bin", "vp");

const OTHER_CLIENT_DIR: Record<Flavor, string> = {
  react: "client-angular",
  angular: "client",
};

const EXCLUDED_PREFIXES = [
  ".git/",
  ".github/",
  "artifact/",
  "cli/",
  "docs/",
  "client-angular/.angular/",
  "client-angular/dist/",
  "client/.tanstack/",
  "client/dist/",
  "node_modules/",
  "server/data/",
  "server/src/variants/",
  "shared/variants/",
];
const EXCLUDED_FILES = new Set([
  "bun.lock",
  "client/src/routeTree.gen.ts",
  "server/test/contract-effect.test.ts",
  "server/test/env-effect.test.ts",
]);
// npm cannot pack these dotted names, so the sync stores them under a leading
// underscore and the runtime maps them back (Task 4's DOTFILES).
const DOTFILE_MAP: Record<string, string> = {
  ".gitattributes": "_gitattributes",
  ".gitignore": "_gitignore",
  ".npmrc": "_npmrc",
};

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
  "Copying this baseline": "To start a new project",
  "Schema variants": "shared/variants/effect/notes.contract.ts",
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
    {
      heading: "Removing or renaming the Notes example",
      body: `## Removing or renaming the Notes example

Delete or replace these files together:

- \`client/src/routes/index.tsx\` — the React page
- \`shared/api.ts\` — the typed client and Notes helpers
- \`shared/notes.contract.ts\` — the shared contract
- \`server/src/notes/notes.controller.ts\`
- \`server/src/notes/notes.errors.ts\`
- \`server/src/notes/notes.module.ts\`
- \`server/src/notes/notes.service.ts\`
- \`server/src/notes/schema.ts\`
- \`server/drizzle/\` — the Notes migration history
- \`server/test/notes.test.ts\`

Then:

- Remove \`NotesModule\` from the imports in \`server/src/app.ts\`.
- Remove the Notes import, export, and entry from \`server/src/schema.ts\`; add your replacement schema there.
- Update \`server/drizzle.config.ts\` if the replacement schema is not exported by \`server/src/schema.ts\`.
- Replace the Notes-based compression test in \`server/test/hosting.test.ts\` with one that exercises a sufficiently large response from your replacement application.
- Remove \`server/data/\` for a clean database.
- Keep the root workspace, \`client/vite.config.ts\`, \`server/src/db.ts\`, and the static-hosting code.

To rename rather than remove, replace \`Notes\`, \`notes\`, and \`/api/notes\` consistently across those files, then regenerate migrations only if the table name changes.`,
    },
    {
      heading: "Layout",
      body: `## Layout

- \`client/\` — React 19, Vite+, TanStack Router and Query, oRPC OpenAPI client
- \`server/\` — NestJS/Fastify on Bun, oRPC v1, Effect, Zod, Drizzle, SQLite
- \`shared/\` — the oRPC v1 API contract and the framework-free oRPC client the client imports
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
    { heading: "Copying this baseline", body: null },
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
- \`client-angular/proxy.conf.json\` proxies \`/api\` to \`http://localhost:3000\`. The Angular dev server reads \`PORT\` too, so leave \`PORT\` unset while both processes run.

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
    {
      heading: "Removing or renaming the Notes example",
      body: `## Removing or renaming the Notes example

Delete or replace these files together:

- \`client-angular/src/app/notes/notes-page.ts\` — the Angular page
- \`client-angular/src/app/notes/notes.service.ts\` — the Angular queries and mutation
- \`shared/api.ts\` — the typed client and Notes helpers
- \`shared/notes.contract.ts\` — the shared contract
- \`server/src/notes/notes.controller.ts\`
- \`server/src/notes/notes.errors.ts\`
- \`server/src/notes/notes.module.ts\`
- \`server/src/notes/notes.service.ts\`
- \`server/src/notes/schema.ts\`
- \`server/drizzle/\` — the Notes migration history
- \`server/test/notes.test.ts\`

Then:

- Remove \`NotesModule\` from the imports in \`server/src/app.ts\`.
- Remove the Notes import, export, and entry from \`server/src/schema.ts\`; add your replacement schema there.
- Update \`server/drizzle.config.ts\` if the replacement schema is not exported by \`server/src/schema.ts\`.
- Replace the Notes-based compression test in \`server/test/hosting.test.ts\` with one that exercises a sufficiently large response from your replacement application.
- Remove \`server/data/\` for a clean database.
- Remove the \`NotesPage\` entry from \`client-angular/src/app/app.routes.ts\`.
- Keep the root workspace, \`client-angular/angular.json\`, \`client-angular/proxy.conf.json\`, \`server/src/db.ts\`, and the static-hosting code.

To rename rather than remove, replace \`Notes\`, \`notes\`, and \`/api/notes\` consistently across those files, then regenerate migrations only if the table name changes.`,
    },
    {
      heading: "Layout",
      body: `## Layout

- \`client-angular/\` — Angular 22, Angular CLI, Signal Forms, TanStack Angular Query, oRPC OpenAPI client
- \`server/\` — NestJS/Fastify on Bun, oRPC v1, Effect, Zod, Drizzle, SQLite
- \`shared/\` — the oRPC v1 API contract and the framework-free oRPC client the client imports
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
    { heading: "Copying this baseline", body: null },
  ],
};

const README_LINE_EDITS: Record<Flavor, Array<[find: string, replacement: string]>> = {
  react: [
    [
      "A copyable Bun workspace with two client flavors — React 19 and Angular 22 — against one NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
      "A copyable Bun workspace with a React 19 client against a NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
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
  ],
  angular: [
    [
      "A copyable Bun workspace with two client flavors — React 19 and Angular 22 — against one NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
      "A copyable Bun workspace with an Angular 22 client against a NestJS/Fastify API on Bun. The Notes example is intentionally disposable.",
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
    ['      "client-angular/dist/**",\n', ""],
    ['      "client-angular/.angular/**",\n', ""],
  ],
  angular: [
    [
      "Its gates are `ng build` and angular-eslint (the third step of `check`).",
      "Its gates are `ng build` and angular-eslint (the second step of `check`).",
    ],
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
    path: "server/test/client-dist.test.ts",
    find: '"client-angular/dist"',
    replacement: '"custom/dist"',
    count: 2,
  },
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
  const name = file.replace(/\/$/, "").split("/").pop() ?? "";
  if (name === "node_modules" || name === ".env" || name.startsWith(".env.")) return true;
  if (/\.db(?:-wal|-shm)?$/.test(name)) return true;
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
  return file.startsWith(`${OTHER_CLIENT_DIR[flavor]}/`);
}

async function sourceFiles(flavor: Flavor, base = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(join(REPO_ROOT, base), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = base ? `${base}/${entry.name}` : entry.name;
    if (isExcluded(entry.isDirectory() ? `${path}/` : path, flavor)) continue;
    if (entry.isDirectory()) files.push(...(await sourceFiles(flavor, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function mappedName(file: string): string {
  const parts = file.split("/");
  const base = parts.pop() ?? "";
  return [...parts, DOTFILE_MAP[base] ?? base].join("/");
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
  if (!overrides || typeof overrides["@angular/build>vite"] !== "string") {
    throw new SyncError(`${where}: overrides["@angular/build>vite"] is missing`);
  }

  pkg.workspaces = workspaces.filter(
    (workspace) => workspace !== "cli" && workspace !== OTHER_CLIENT_DIR[flavor],
  );
  delete scripts["templates:sync"];
  delete scripts["test:cli"];
  scripts.test = "bun run --filter server test";

  if (flavor === "react") {
    for (const key of ["dev:angular", "dev:angular-client", "dev:angular-server"]) {
      if (typeof scripts[key] !== "string")
        throw new SyncError(`${where}: scripts.${key} is missing`);
      delete scripts[key];
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
    delete overrides["@angular/build>vite"];
  } else {
    for (const key of ["dev", "dev:client", "routes"]) {
      if (typeof scripts[key] !== "string")
        throw new SyncError(`${where}: scripts.${key} is missing`);
      delete scripts[key];
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

  await writeJson(file, pkg);
}

async function editReadme(flavor: Flavor, root: string): Promise<void> {
  const file = join(root, "README.md");
  const where = `README.md (${flavor})`;
  let text = await readFile(file, "utf8");
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

async function transform(flavor: Flavor, root: string): Promise<void> {
  await trimTemplateSharedPackage(flavor, root);
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
  const gitignorePath = join(root, "_gitignore");
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
  const dependencies = pkg.dependencies;
  if (!dependencies) throw new SyncError(`${source}: dependencies is missing`);
  edit(dependencies);
  const file = join(outRoot, destination);
  await mkdir(dirname(file), { recursive: true });
  await writeJson(file, pkg);
}

const EFFECT_README_EDITS: Array<[string, string]> = [
  ["Zod validates request bodies;", "Effect Schema validates request bodies;"],
  [
    "- `server/` — NestJS/Fastify on Bun, oRPC v1, Effect, Zod, Drizzle, SQLite",
    "- `server/` — NestJS/Fastify on Bun, oRPC v1, Effect, Drizzle, SQLite",
  ],
];

async function writeOverlayReadme(flavor: Flavor, outRoot: string): Promise<void> {
  let text = await readFile(join(TEMPLATES_ROOT, flavor, "README.md"), "utf8");
  for (const [find, replacement] of EFFECT_README_EDITS) {
    text = replaceOnce(text, find, replacement, `README.md overlay (${flavor})`);
  }
  const file = join(outRoot, "README.md");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function writeOverlay(flavor: Flavor, outRoot: string): Promise<void> {
  await writeOverlayFile(
    outRoot,
    "shared/notes.contract.ts",
    "shared/variants/effect/notes.contract.ts",
  );
  await writeOverlayFile(outRoot, "server/src/env.ts", "server/src/variants/effect/env.ts", [
    ['resolve(import.meta.dir, "../../../..")', 'resolve(import.meta.dir, "../..")'],
  ]);
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
      delete dependencies["zod"];
    },
  );
  await writeOverlayReadme(flavor, outRoot);
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

async function countFiles(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += await countFiles(join(dir, entry.name));
    else total += 1;
  }
  return total;
}

async function listFiles(dir: string, base = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(join(dir, entry.name), path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function formatTemplates(): Promise<void> {
  // Explicit file paths bypass Oxfmt's directory walk, which honors the root
  // .gitignore entry for cli/templates/. Run from cli/, which has the
  // package.json Vite+ requires. Unsupported extensions are skipped.
  const files = [
    ...(await listFiles(TEMPLATES_ROOT, "templates")),
    ...(await listFiles(OVERLAYS_ROOT, "overlays")),
  ];
  const result = spawnSync(process.execPath, [VP_BIN, "fmt", ...files], {
    cwd: CLI_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new SyncError("vp fmt failed on the generated templates");
}

async function main(): Promise<void> {
  await rm(TEMPLATES_ROOT, { recursive: true, force: true });
  await rm(OVERLAYS_ROOT, { recursive: true, force: true });
  for (const flavor of FLAVORS) {
    const outRoot = join(TEMPLATES_ROOT, flavor);
    for (const file of await sourceFiles(flavor)) {
      await copyTrackedFile(file, outRoot);
    }
    await transform(flavor, outRoot);
    console.log(
      `synced ${flavor}: ${await countFiles(outRoot)} files -> ${relative(REPO_ROOT, outRoot)}`,
    );
    const overlayRoot = join(OVERLAYS_ROOT, flavor);
    await writeOverlay(flavor, overlayRoot);
    console.log(
      `synced ${flavor} overlay: ${await countFiles(overlayRoot)} files -> ${relative(REPO_ROOT, overlayRoot)}`,
    );
  }
  await formatTemplates();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
