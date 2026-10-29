# Lightweight web app starter implementation plan

> **For agentic workers:** Read the spec and this plan, then implement your assigned tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit or publish unless the user explicitly asks. No task in this plan is test-first; write tests after the implementation in Task 5.

**Goal:** Build a copyable, runnable TypeScript monorepo that proves typed client-to-server calls, DI, Effect service errors, and SQLite persistence with a replaceable example.

**Architecture:** Bun workspaces separate `client/` and `server/`. Vite+ serves the React client in development and builds it for production; Hono serves the API and the built client under Bun. Awilixify constructs the controller and service, while Hono's inferred route type provides the client contract. Prove that inference before building the full example.

**Tech Stack:** Bun, TypeScript, Vite+, React 19, Oxc React Compiler, TanStack Router and Query, Hono `hc`, Awilixify, Effect, Zod, Drizzle, SQLite through `bun:sqlite`.

**Testing:** Tests after implementation, as agreed: server integration test using `bun:test` for valid and invalid requests, plus client typecheck/build, production static serving check, and manual browser smoke test when available. No test-first requirement.

**Spec:** `docs/superpowers/specs/2026-10-29-lightweight-web-app-starter-design.md`

---

## Verified package contracts (checked 2026-10-29)

These are the exact versions the plan assumes. Pin them; do not float to newer majors while proving the contract.

| Package | Version | Why it matters |
| --- | --- | --- |
| `hono` | `4.13.14` | `hc` requires chained routes and an inferred `AppType` |
| `@hono/zod-validator` | `0.9.1` | Types POST JSON input and 400 responses for `hc` |
| `@hono/bun` | `1.0.1` | `serveStatic` for the Bun production server (Hono ≥ 4.13.9) |
| `awilixify` | `3.3.0` | Controller lifecycle and CLASSIC constructor injection |
| `awilix` | `13.0.5` | Awilixify peer dependency, pinned explicitly |
| `effect` | `4.1.0` | `Data.TaggedError`, `Effect.try`, `Effect.match` |
| `zod` | `4.6.7` | Server request validation only |
| `drizzle-orm` | `0.45.4` | `bun:sqlite` driver and migrator |
| `drizzle-kit` | `0.31.11` | Generates the checked-in SQL migration |
| `vite-plus` | `1.4.0` | Project-local `vp` CLI; bundles Vite 8, Vitest 5, Oxc |
| `@vitejs/plugin-react` | `6.1.2` | `react({ compiler: true })` with `oxc-transform-react` |
| `oxc-transform-react` | `0.156.0` | Optional peer required by the native React Compiler |
| `react` / `react-dom` | `19.3.1` | UI runtime |
| `@tanstack/react-router` | `1.170.46` | File-based router |
| `@tanstack/router-plugin` | `1.168.48` | Vite plugin that generates `routeTree.gen.ts` |
| `@tanstack/react-query` | `5.105.0` | List query and create mutation |
| `typescript` | `7.0.2` | Typecheck (probe ran clean on this version) |
| `@types/bun` | `1.4.4` | `bun:sqlite`, `import.meta.main` |
| `@types/react` / `@types/react-dom` | `19.3.0` | React 19 types |

Documentation used through Context7 and the vendors' sites:

- Hono RPC: <https://hono.dev/docs/guides/rpc> and <https://hono.dev/docs/concepts/stacks>
- Hono Bun static files and default export: <https://hono.dev/docs/getting-started/bun>
- Awilixify quick start, providers, testing: <https://github.com/awilixify/awilixify/blob/main/docs/guide/quick-start.md>
- Vite+ project-local CLI and package management: <https://viteplus.dev/guide/local-cli>, <https://viteplus.dev/guide/package-management>
- Vite+ `vp dev` / `vp build`: <https://viteplus.dev/guide/dev>, <https://viteplus.dev/guide/build>
- Oxc React Compiler + `@vitejs/plugin-react` v6.1: <https://oxc.rs/blog/2026-08-18-react-compiler-support.html>
- Drizzle SQLite + Bun: <https://orm.drizzle.team/docs/get-started-sqlite>
- Effect 4 tagged errors and matching: <https://effect.website/docs/v4/error-management/yieldable-errors>
- TanStack Router file-based routing + Query: <https://tanstack.com/router/latest/docs/framework/react/guide/creating-a-router>

## Plan corrections and flags

These are called out rather than silently resolved.

1. **Awilixify `controllers: []` versus `hc` inference.** The spec records the provider-based decision. With `awilixify@3.3.0`, a class in `controllers: []` is constructed by `ControllerProcessor`, registered under a private `Symbol`, and `registerRoutes()` is called at bootstrap. `DIContext.create()` returns only a `ModuleScope` (`scope`, `importedScopes`, lifecycle methods), so that controller instance cannot be resolved by name afterwards. Side-effect route registration also cannot extend the type of an already-declared `app` value. The smallest viable integration is documented in **Contract decision** below.
2. **File-map gap — `client/src/routes/index.tsx`.** Task 2 lists this file as "Modify", but Task 1 never creates it. Task 1 therefore creates a minimal index route. No path is renamed or moved.
3. **File-map gap — `server/src/app.ts` in Task 3.** Task 3 changes `notes.module.ts` into a database-aware factory, so `app.ts` must construct the module with a `db` instance. Task 3 also touches `server/src/app.ts` and `server/src/index.ts`; the original Task 3 list omits them. Task 4 still lists both as "Modify" for static hosting.
4. **Temporary stub.** Task 2 needs a controller and a service to prove DI before the real database exists. It uses `NotesPreviewService` inside `notes.controller.ts`; Task 4 creates `notes.service.ts` and removes the stub. This keeps `server/src/notes/notes.service.ts` owned by Task 4 as the file map says.
5. **Vite+ is a Node CLI; Bun remains the package manager and server runtime.** This is consistent with the spec's "Vite+ client and Bun API as separate processes", but do not expect `vp` itself to run under Bun.
6. **`@hono/bun` is installed in Task 2, first used in Task 4.** This avoids another `server/package.json` edit in Task 4, whose file list does not include it.
7. **Generated route tree.** `client/src/routeTree.gen.ts` is ignored and generated by the router plugin. A fresh clone must run `bun run build` (or `bun run dev:client`) before `bun run typecheck`. The root `check` script encodes that order.

## File map

- Root `package.json`, `bun.lock`, `tsconfig.json`, `.gitignore`, and `README.md` own workspace commands, dependency reproducibility, shared compiler defaults, ignored data/build outputs, and reuse instructions.
- `client/package.json`, `client/index.html`, `client/tsconfig.json`, and `client/vite.config.ts` own the browser package and Vite+ dev/build configuration, including the `/api` proxy, router plugin, and Oxc React Compiler integration.
- `client/src/main.tsx`, `client/src/routes/__root.tsx`, `client/src/routes/index.tsx`, and `client/src/api.ts` own React providers, the route tree, the replaceable Notes page, and the typed Hono client. `client/src/routeTree.gen.ts` is generated by the router plugin and ignored.
- `server/package.json`, `server/tsconfig.json`, `server/src/app.ts`, and `server/src/index.ts` own Hono composition, exported `AppType`, Awilixify startup, and the Bun listener/static hosting.
- `server/src/notes/notes.controller.ts`, `server/src/notes/notes.module.ts`, and `server/src/notes/notes.service.ts` own the replaceable example's native Hono routes, DI registrations, and Effect-returning operations.
- `server/src/db.ts`, `server/src/notes/schema.ts`, `server/drizzle.config.ts`, and `server/drizzle/` own the Bun SQLite connection, Notes schema, migration configuration, and generated migration.
- `server/test/notes.test.ts` tests the full Notes API with a temporary SQLite database.

---

## Contract decision: Hono `hc` inference with Awilixify startup

This is the blocking design decision for Task 2. Read it before writing any server code.

### What Hono requires

`hc<AppType>` reads the route schema from the **type of the value exported as `AppType`**. The documented shape is a single chained value:

```ts
const routes = new Hono()
  .get("/", (c) => c.json({ notes: [] }, 200))
  .post("/", zValidator("json", schema), (c) => c.json({ note }, 201))

export type AppType = typeof routes
```

Declaring `const app = new Hono()` and then calling `app.get(...)` on later statements does **not** change the declared type of `app`. TypeScript infers a variable's type at its declaration; the chained builder returns a new type, but the side effect is invisible to `typeof app`.

### What Awilixify 3.3.0 actually does

From the installed package (`dist/lib/di/processors/controller-processor.js` and `dist/lib/di/contexts/di-context*.d.ts`):

- `controllers: [NotesController]` is processed at bootstrap. The class is registered under `Symbol("controller_NotesController")`.
- If `registerRoutes` exists and `skipRegisterRoutes` is not set, Awilixify calls `instance.registerRoutes()` at bootstrap and discards the return value.
- `DIContext.create()` returns `ModuleScope`, whose public surface is `{ name, scope, importedScopes }` plus lifecycle methods. There is no public API to resolve the controller instance by class or by a provider name: the runtime entry is held privately by the controller processor.
- `skipRegisterRoutes: true` only skips the bootstrap call; it does not expose the instance.

Therefore `controllers: []` and `hc` inference are mutually exclusive without a cast or hand-written route types. The plan does not use either.

### The probe result

A throwaway probe using `hono@4.13.14`, `awilixify@3.3.0`, `zod@4.6.7`, `@hono/zod-validator@0.9.1`, and `typescript@7.0.2` produced:

| Shape | Compile result | Runtime result |
| --- | --- | --- |
| `controllers: [NotesController]`; controller receives `app` from a global module; `registerRoutes()` calls `app.get(...)`; `export type AppType = typeof app` | **Fails.** `hc<AppType>` client is `unknown`; `client.api.notes.$get()` is TS18046: `'client' is of type 'unknown'`. | Routes answer, but the client contract is gone. |
| Controller registered as a **provider**; `registerRoutes()` returns a chained `Hono` sub-app; `createApp()` mounts it once; `export type AppType = ReturnType<typeof createApp>` | **Passes.** `client.api.notes.$get()` and `.$post({ json })` infer paths, input, and response; `res.status` is `201 \| 400 \| 503`. | `GET` 200, `POST` 201, invalid `POST` 400. |

No `as`, `any`, `AppType` cast, or hand-written path type was needed. The same probe also compiled with Drizzle's `BunSQLiteDatabase` and `Effect.match`.

### Decision (smallest viable adjustment)

1. Register `NotesController` in the module's **`providers`** map, not in `controllers: []`. Awilixify still constructs it and injects the service via CLASSIC mode (constructor parameter names are the injection tokens; `awilixify` sets `InjectionMode.CLASSIC` and `strict: true`).
2. `NotesController.registerRoutes()` **returns** a chained `Hono` sub-app instead of mounting into an injected app. Returning a value from a method declared `() => void` is structurally allowed, so `implements Controller` still works.
3. `createApp(db)` resolves the controller with `NotesModuleDef["deps"]["notesController"]`, mounts its sub-app in one chained expression, and exports `AppType = ReturnType<typeof createApp>`.
4. Document in the README that Awilixify constructs the controller, but `createApp()` invokes `registerRoutes()` (because Awilixify's `controllers` lifecycle is incompatible with `hc` inference).

Rejected alternatives:

- `controllers: []` plus `skipRegisterRoutes` — the instance is still private.
- Registering the same class in both `providers` and `controllers` — two instances; the mounted one is not the lifecycle-managed one.
- Casting `AppType` or hand-writing Hono route types — explicitly forbidden by the spec and fabricated.
- Using `hono/factory` handlers — the typed chain still has to be built where the controller instance is available, so it does not remove the need for step 2.
- Dropping Awilixify — violates the spec's DI requirement.

---

## Tasks

### Task 1: Workspace foundation and Vite+ client

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `README.md`
- Create: `client/package.json`, `client/index.html`, `client/tsconfig.json`, `client/vite.config.ts`, `client/src/main.tsx`, `client/src/routes/__root.tsx`
- Create: `client/src/routes/index.tsx` (see flag 2; Task 2 modifies it)
- Generate: `bun.lock`, `client/src/routeTree.gen.ts`

**Done when:** Dependencies install reproducibly, the client dev server starts, the compiler integration is enabled, and the client build/typecheck passes without relying on a global `vp` CLI.

**Depends on:** none.

#### Steps

- [ ] **1.1 Create the root workspace manifest.**

  `package.json`:

  ```json
  {
    "name": "lightweight-web-app-starter",
    "private": true,
    "type": "module",
    "packageManager": "bun@1.4.4",
    "workspaces": ["client", "server"],
    "scripts": {
      "dev:client": "bun run --filter client dev",
      "dev:server": "bun run --filter server dev",
      "build": "bun run --filter client build",
      "typecheck": "bun run --filter client typecheck && bun run --filter server typecheck",
      "check": "bun run build && bun run typecheck",
      "test": "bun run --filter server test",
      "db:generate": "bun run --filter server db:generate",
      "db:migrate": "bun run --filter server db:migrate",
      "start": "bun run --filter server start"
    },
    "devDependencies": {
      "@types/bun": "1.4.4",
      "typescript": "7.0.2"
    },
    "overrides": {
      "vite": "npm:@voidzero-dev/vite-plus-core@1.4.0",
      "vitest": "5.0.5"
    }
  }
  ```

  Notes:
  - The `vite` override is required by the Vite+ local-CLI docs so `@vitejs/plugin-react` resolves Vite+ core instead of pulling a second Vite copy.
  - `vitest` is pinned to the version bundled by `vite-plus@1.4.0` (`5.0.5`) even though this plan uses `bun:test`.
  - The `server` scripts fail until Task 2 creates `server/package.json`; that is expected.

- [ ] **1.2 Create the shared TypeScript baseline.**

  `tsconfig.json`:

  ```json
  {
    "compilerOptions": {
      "target": "ESNext",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "skipLibCheck": true,
      "noEmit": true,
      "verbatimModuleSyntax": true,
      "forceConsistentCasingInFileNames": true
    }
  }
  ```

- [ ] **1.3 Create `.gitignore`.**

  ```gitignore
  node_modules/
  client/dist/
  client/src/routeTree.gen.ts
  .env
  .env.*
  ```

  Database patterns are added in Task 3, when the data directory exists.

- [ ] **1.4 Create the client manifest.**

  `client/package.json`:

  ```json
  {
    "name": "client",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vp dev",
      "build": "vp build",
      "preview": "vp preview",
      "typecheck": "tsc --noEmit"
    },
    "dependencies": {
      "@tanstack/react-query": "5.105.0",
      "@tanstack/react-router": "1.170.46",
      "hono": "4.13.14",
      "react": "19.3.1",
      "react-dom": "19.3.1"
    },
    "devDependencies": {
      "@tanstack/router-plugin": "1.168.48",
      "@types/react": "19.3.0",
      "@types/react-dom": "19.3.0",
      "@vitejs/plugin-react": "6.1.2",
      "oxc-transform-react": "0.156.0",
      "vite-plus": "1.4.0"
    }
  }
  ```

  `vite-plus` is a `client` devDependency so `vp` is resolved from `client/node_modules/.bin` by the package script; no global `vp` CLI is required. `hono` is a client dependency because `hc` is imported from `hono/client`; it is not the server runtime.

- [ ] **1.5 Create `client/index.html`.**

  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Lightweight web app</title>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```

- [ ] **1.6 Create the client TypeScript config.**

  `client/tsconfig.json`:

  ```json
  {
    "extends": "../tsconfig.json",
    "compilerOptions": {
      "jsx": "react-jsx",
      "lib": ["ESNext", "DOM", "DOM.Iterable"],
      "types": ["vite/client", "bun"]
    },
    "include": ["src", "vite.config.ts"]
  }
  ```

  `bun` is in `types` because Task 2 makes the client typecheck the server's `AppType`, whose module graph reaches `bun:sqlite`. This does not put Bun or the server into the browser bundle; the import is type-only and Vite erases it.

- [ ] **1.7 Create `client/vite.config.ts` with the router plugin, Oxc React Compiler, and API proxy.**

  ```ts
  import { defineConfig } from "vite-plus"
  import react from "@vitejs/plugin-react"
  import { tanstackRouter } from "@tanstack/router-plugin/vite"

  export default defineConfig({
    plugins: [
      tanstackRouter(),
      react({ compiler: true }),
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
  })
  ```

  `react({ compiler: true })` is the documented experimental Oxc React Compiler integration in `@vitejs/plugin-react` v6.1 and requires the `oxc-transform-react` optional peer, which is installed above. `defineConfig` must come from `vite-plus`, not `vite`.

- [ ] **1.8 Create `client/src/main.tsx`.**

  ```tsx
  import { StrictMode } from "react"
  import { createRoot } from "react-dom/client"
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
  import { RouterProvider, createRouter } from "@tanstack/react-router"
  import { routeTree } from "./routeTree.gen"

  const queryClient = new QueryClient()
  const router = createRouter({ routeTree })

  declare module "@tanstack/react-router" {
    interface Register {
      router: typeof router
    }
  }

  const rootElement = document.getElementById("root")
  if (!rootElement) throw new Error("Missing #root element")

  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
  ```

  `routeTree.gen.ts` does not exist until the router plugin runs. The build in step 1.13 generates it; `tsc` in 1.14 must run after that.

- [ ] **1.9 Create `client/src/routes/__root.tsx`.**

  ```tsx
  import { Outlet, createRootRoute } from "@tanstack/react-router"

  export const Route = createRootRoute({
    component: RootLayout,
  })

  function RootLayout() {
    return (
      <main>
        <h1>Lightweight web app</h1>
        <Outlet />
      </main>
    )
  }
  ```

- [ ] **1.10 Create the neutral `client/src/routes/index.tsx`.**

  ```tsx
  import { createFileRoute } from "@tanstack/react-router"

  export const Route = createFileRoute("/")({
    component: HomePage,
  })

  function HomePage() {
    return <p>Client and API are running. The Notes example is added in Task 2.</p>
  }
  ```

- [ ] **1.11 Create the initial `README.md`.**

  `README.md`:

  ````markdown
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

  ## Build and typecheck

  ```bash
  bun run build
  bun run typecheck
  ```

  `bun run build` also generates `client/src/routeTree.gen.ts`, which is ignored. Run it before `typecheck` on a fresh clone.

  ## Layout

  - `client/` — React 19, Vite+, TanStack Router and Query, Hono `hc`
  - `server/` — Hono on Bun, Awilixify, Effect, Zod, Drizzle, SQLite
  - `server/data/` — persistent SQLite files (ignored)
  ````

- [ ] **1.12 Install dependencies.**

  Command:

  ```bash
  bun install
  ```

  Expected:
  - `bun.lock` is created at the repo root.
  - No workspace resolution errors. `client` dependencies are linked; `server` does not exist yet, so the workspace list contains only `client` until Task 2.
  - A local `vp` binary exists at `client/node_modules/.bin/vp` or, if Bun hoisted it, `node_modules/.bin/vp`. Either proves the project-local Vite+ CLI is installed.

- [ ] **1.13 Build the client and generate the route tree.**

  Command:

  ```bash
  bun run build
  ```

  Expected:
  - Exit code 0.
  - Vite+ prints a Vite/Rolldown build for the client.
  - `client/dist/index.html` and `client/dist/assets/` exist.
  - `client/src/routeTree.gen.ts` exists and contains an `index` route.

  If `vp` is not found, run `bunx --bun vp --version` from `client/` to confirm the installed binary; do not install a global `vp`.

- [ ] **1.14 Typecheck the client.**

  Command (after 1.13):

  ```bash
  bun run --filter client typecheck
  ```

  Expected: no output, exit code 0.

  The root `bun run typecheck` also typechecks `server`, so it only becomes usable after Task 2 creates that workspace.

- [ ] **1.15 Start the dev server and confirm the compiler integration loads.**

  Command:

  ```bash
  bun run dev:client
  ```

  Expected:
  - The process stays in the foreground.
  - Output includes `Local: http://localhost:5173/`.
  - No error mentioning `oxc-transform-react`, `compiler`, or a missing plugin.
  - `GET http://localhost:5173/` renders the neutral page.

  Stop the process with `Ctrl+C`.

---

### Task 2: Prove Hono RPC types with Awilixify controllers

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/app.ts`, `server/src/index.ts`
- Create: `server/src/notes/notes.controller.ts`, `server/src/notes/notes.module.ts`
- Create: `client/src/api.ts`
- Modify: `client/src/routes/index.tsx`, `README.md`

**Done when:** A client call to both routes typechecks with inferred path, POST input, and response types, and both routes answer requests from Bun. If the contract cannot be met with native routes and Awilixify, stop and report the design conflict before continuing.

**Depends on:** Task 1.

> **Blocking context:** Read **Contract decision** above. Do not use `controllers: [NotesController]`; it breaks `hc`. Register the controller as a provider and return the chained sub-app from `registerRoutes()`.

#### Steps

- [ ] **2.1 Create `server/package.json`.**

  ```json
  {
    "name": "server",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "bun --watch src/index.ts",
      "start": "bun src/index.ts",
      "typecheck": "tsc --noEmit"
    },
    "dependencies": {
      "@hono/bun": "1.0.1",
      "@hono/zod-validator": "0.9.1",
      "awilix": "13.0.5",
      "awilixify": "3.3.0",
      "effect": "4.1.0",
      "hono": "4.13.14",
      "zod": "4.6.7"
    },
    "devDependencies": {
      "typescript": "7.0.2"
    }
  }
  ```

  `@hono/bun` is installed here and first imported in Task 4 (see flag 6). `drizzle-orm` and `drizzle-kit` are added in Task 3.

- [ ] **2.2 Create `server/tsconfig.json`.**

  ```json
  {
    "extends": "../tsconfig.json",
    "compilerOptions": {
      "types": ["bun"]
    },
    "include": ["src", "test", "drizzle.config.ts"]
  }
  ```

  `test` and `drizzle.config.ts` do not exist yet; TypeScript ignores missing `include` entries as long as at least one file matches.

- [ ] **2.3 Create `server/src/notes/notes.controller.ts` with the contract-proof controller and a temporary in-memory service.**

  ```ts
  import { Hono } from "hono"
  import { zValidator } from "@hono/zod-validator"
  import { z } from "zod"
  import type { Controller } from "awilixify"

  export const CreateNoteSchema = z.object({
    text: z.string().trim().min(1).max(200),
  })

  export type Note = {
    id: number
    text: string
    createdAt: string
  }

  // Temporary until Task 4 replaces this with the Drizzle-backed NotesService.
  export class NotesPreviewService {
    private readonly notes: Note[] = []

    list(): Note[] {
      return this.notes
    }

    add(text: string): Note {
      const note: Note = {
        id: this.notes.length + 1,
        text,
        createdAt: new Date().toISOString(),
      }
      this.notes.push(note)
      return note
    }
  }

  export class NotesController implements Controller {
    constructor(private readonly notesService: NotesPreviewService) {}

    registerRoutes() {
      return new Hono()
        .get("/", (c) => c.json({ notes: this.notesService.list() }, 200))
        .post(
          "/",
          zValidator("json", CreateNoteSchema, (result, c) => {
            if (!result.success) {
              return c.json({ error: "Note text must be 1-200 characters" }, 400)
            }
          }),
          (c) => {
            const { text } = c.req.valid("json")
            return c.json({ note: this.notesService.add(text) }, 201)
          },
        )
    }
  }
  ```

  Why the method returns a value: `Controller` declares `registerRoutes: () => void`. A method returning `Hono<...>` is assignable to a void-returning signature, and the returned chain is what preserves the route schema. Do not change this to an injected `app` plus side-effect registration; that is the shape the probe proved broken.

- [ ] **2.4 Create `server/src/notes/notes.module.ts`.**

  ```ts
  import { createModule, type ModuleDef } from "awilixify"
  import { NotesController, NotesPreviewService } from "./notes.controller"

  export type NotesModuleDef = ModuleDef<{
    providers: {
      notesService: NotesPreviewService
      notesController: NotesController
    }
  }>

  export const NotesModule = createModule<NotesModuleDef>({
    name: "NotesModule",
    providers: {
      notesService: NotesPreviewService,
      notesController: NotesController,
    },
  })
  ```

  The controller is deliberately in `providers`, not `controllers`. Awilixify uses CLASSIC injection, so the constructor parameter `notesService` resolves by name. `strict: true` means a typo fails at startup instead of injecting `undefined`.

- [ ] **2.5 Create `server/src/app.ts`.**

  ```ts
  import { Hono } from "hono"
  import { DIContext } from "awilixify"
  import { NotesModule, type NotesModuleDef } from "./notes/notes.module"

  const container = DIContext.create(NotesModule)
  const notesController = container.scope.resolve<
    NotesModuleDef["deps"]["notesController"]
  >("notesController")

  export const app = new Hono().route(
    "/api/notes",
    notesController.registerRoutes(),
  )

  export type AppType = typeof app
  ```

  `typeof app` is the result of the **chained** `new Hono().route(...)` expression, so the `/api/notes` schema is in the type. `NotesModuleDef["deps"]` reuses the module's own type instead of restating `NotesController`.

- [ ] **2.6 Create `server/src/index.ts`.**

  ```ts
  import { app } from "./app"

  const port = Number(process.env.PORT ?? 3000)

  console.log(`API listening on http://localhost:${port}`)

  export default {
    port,
    fetch: app.fetch,
  }
  ```

  Bun runs the default export's `port`/`fetch` without an explicit `Bun.serve`. Keep `app.fetch` unbound; Hono's fetch handler does not depend on `this`.

- [ ] **2.7 Create `client/src/api.ts` with compile-time guards.**

  ```ts
  import { hc } from "hono/client"
  import type { InferRequestType, InferResponseType } from "hono/client"
  import type { AppType } from "../../server/src/app"

  export const api = hc<AppType>("/")

  // Compile-time guards. If AppType loses its route schema, these two lines fail
  // before the page does. They are types only and add nothing to the bundle.
  export type NotesListResponse = InferResponseType<typeof api.api.notes.$get, 200>
  export type CreateNoteRequest = InferRequestType<typeof api.api.notes.$post>["json"]
  ```

  `import type` is essential: it keeps the server, Bun, Drizzle, and Effect out of the browser bundle. The base URL `"/"` makes `hc` call `/api/notes` in the browser; in development Vite proxies that path to Bun, and in production the same Bun process serves it.

- [ ] **2.8 Replace `client/src/routes/index.tsx` with the contract-proof page.**

  ```tsx
  import { createFileRoute } from "@tanstack/react-router"
  import { useEffect, useState } from "react"
  import type { FormEvent } from "react"
  import { api } from "../api"

  export const Route = createFileRoute("/")({
    component: ContractProbePage,
  })

  type Note = {
    id: number
    text: string
    createdAt: string
  }

  function ContractProbePage() {
    const [notes, setNotes] = useState<Note[]>([])
    const [text, setText] = useState("")
    const [error, setError] = useState<string | null>(null)

    async function load() {
      const res = await api.api.notes.$get()
      const body = await res.json()
      if (!res.ok || !("notes" in body)) {
        setError("Could not load notes")
        return
      }
      setNotes(body.notes)
      setError(null)
    }

    useEffect(() => {
      void load()
    }, [])

    async function add(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      const value = text.trim()
      if (!value) return

      const res = await api.api.notes.$post({ json: { text: value } })
      const body = await res.json()
      if (!("note" in body)) {
        setError("error" in body ? body.error : "Could not save note")
        return
      }

      setText("")
      setError(null)
      await load()
    }

    return (
      <section>
        <h2>RPC contract proof</h2>
        <form onSubmit={add}>
          <label htmlFor="note">New note</label>
          <input
            id="note"
            value={text}
            onChange={(event) => setText(event.target.value)}
            minLength={1}
            maxLength={200}
            required
          />
          <button type="submit">Add note</button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
        <ul>
          {notes.map((note) => (
            <li key={note.id}>{note.text}</li>
          ))}
        </ul>
      </section>
    )
  }
  ```

  This page is temporary; Task 4 replaces it with Query. Its job is to force both `hc` calls through the inferred types at compile time and at runtime.

- [ ] **2.9 Install the new workspace and typecheck both packages.**

  Commands:

  ```bash
  bun install
  bun run build
  bun run typecheck
  ```

  Expected:
  - `bun install` links `server` and updates `bun.lock`.
  - `bun run build` regenerates `client/src/routeTree.gen.ts` and exits 0.
  - `bun run typecheck` exits 0 for both `client` and `server`.
  - No `any`, no `@ts-expect-error`, no `as` in `server/src/app.ts` or `client/src/api.ts`.

  If `client/src/api.ts` reports `api.api` as `unknown` or TS18046, the server lost the chained type. Stop and re-read the Contract decision; do not cast.

- [ ] **2.10 Run the server and prove both routes answer from Bun.**

  Terminal 1:

  ```bash
  bun run dev:server
  ```

  Expected: `API listening on http://localhost:3000`.

  Terminal 2 (PowerShell):

  ```powershell
  Invoke-RestMethod http://localhost:3000/api/notes | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/notes -ContentType "application/json" -Body '{"text":"first note"}' | ConvertTo-Json -Depth 5
  Invoke-RestMethod http://localhost:3000/api/notes | ConvertTo-Json -Depth 5
  ```

  Expected:
  - First GET: `{ "notes": [] }`.
  - POST: `{ "note": { "id": 1, "text": "first note", "createdAt": "<ISO timestamp>" } }`.
  - Second GET: the list contains that note.

  Invalid input (PowerShell cmdlet, not `curl.exe`; Windows PowerShell strips nested quotes from native `curl.exe -d` arguments):

  ```powershell
  try {
    Invoke-WebRequest -Method Post -Uri http://localhost:3000/api/notes -ContentType "application/json" -Body '{"text":"   "}' | Out-Null
    "unexpected success"
  } catch {
    "status=$($_.Exception.Response.StatusCode.value__)"
  }
  ```

  Expected: `status=400`.

  Stop the server with `Ctrl+C`.

- [ ] **2.11 Record the contract in `README.md`.**

  Append after the "Build and typecheck" section:

  ````markdown
  ## RPC contract

  The client imports the server's `AppType` as a type only:

  ```ts
  import type { AppType } from "../../server/src/app"
  const api = hc<AppType>("/")
  ```

  `AppType` is the chained return value of `createApp`, not a side-effect-mutated `Hono` variable. The controller is registered as an Awilixify provider, not in `controllers: []`, because Awilixify's controller lifecycle hides the instance and cannot extend Hono's inferred route type. `createApp` resolves the controller and calls `registerRoutes()` once to mount the typed sub-app.

  To prove the contract, run:

  ```bash
  bun run build
  bun run typecheck
  ```

  Expected: exit code 0. If `client/src/api.ts` says `api.api` is `unknown`, the route chain has been broken; do not cast `AppType`.
  ````

- [ ] **2.12 Verify the client proxy path.**

  With the server running and `bun run dev:client` in another terminal, open <http://localhost:5173>, add a note, and confirm it appears. Expected: the request goes to `/api/notes` through the Vite proxy and returns 201 without a CORS error.

---

### Task 3: SQLite, Drizzle, and migrations

**Files:**
- Create: `server/src/db.ts`, `server/src/notes/schema.ts`, `server/drizzle.config.ts`
- Generate: `server/drizzle/` migration files
- Modify: `server/package.json`, `server/src/notes/notes.module.ts`, `.gitignore`, `README.md`
- Modify (flagged, see flag 3): `server/src/app.ts`, `server/src/index.ts`

**Done when:** A fresh database can be migrated from a documented command; the generated migration is tracked and the SQLite file and journal files are ignored.

**Depends on:** Task 2.

#### Steps

- [ ] **3.1 Add the Drizzle dependencies and scripts to `server/package.json`.**

  Add to `dependencies`:

  ```json
  "drizzle-orm": "0.45.4"
  ```

  Add to `devDependencies`:

  ```json
  "drizzle-kit": "0.31.11"
  ```

  Add to `scripts`:

  ```json
  "db:generate": "drizzle-kit generate",
  "db:migrate": "bun src/db.ts"
  ```

  `db:migrate` runs the runtime migrator through Bun, not `drizzle-kit migrate`. This keeps migration execution on `bun:sqlite` and avoids a second SQLite driver/native build. `drizzle-kit` is used only to generate SQL from the schema.

- [ ] **3.2 Create `server/src/notes/schema.ts`.**

  ```ts
  import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

  export const notes = sqliteTable("notes", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
  })

  export type Note = typeof notes.$inferSelect
  ```

  `createdAt` is set by the service, not by SQLite defaults, so the insert path is deterministic and testable. Drizzle maps `created_at` to the camelCase `createdAt` property.

- [ ] **3.3 Create `server/src/db.ts`.**

  ```ts
  import { Database } from "bun:sqlite"
  import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
  import { migrate } from "drizzle-orm/bun-sqlite/migrator"
  import { mkdirSync } from "node:fs"
  import { dirname } from "node:path"
  import { fileURLToPath } from "node:url"
  import { notes } from "./notes/schema"

  const schema = { notes }

  export type AppDatabase = BunSQLiteDatabase<typeof schema> & {
    $client: Database
  }

  export const defaultDatabasePath = fileURLToPath(
    new URL("../data/app.db", import.meta.url),
  )

  export const migrationsFolder = fileURLToPath(
    new URL("../drizzle", import.meta.url),
  )

  export function createDb(
    path = process.env.DATABASE_PATH ?? defaultDatabasePath,
  ): AppDatabase {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true })
    }

    const client = new Database(path)

    if (path !== ":memory:") {
      client.exec("PRAGMA journal_mode = WAL;")
    }
    client.exec("PRAGMA foreign_keys = ON;")

    return drizzle(client, { schema })
  }

  export function migrateDb(
    db: AppDatabase,
    folder = migrationsFolder,
  ): void {
    migrate(db, { migrationsFolder: folder })
  }

  if (import.meta.main) {
    const db = createDb()
    migrateDb(db)
    console.log(`Migrated ${process.env.DATABASE_PATH ?? defaultDatabasePath}`)
    db.$client.close()
  }
  ```

  Notes:
  - `defaultDatabasePath` is absolute and derived from this module, so it does not depend on the process cwd.
  - WAL is enabled only for file databases; `:memory:` does not support it.
  - `import.meta.main` makes `bun src/db.ts` an explicit migration command while normal imports do not run migrations.

- [ ] **3.4 Create `server/drizzle.config.ts`.**

  ```ts
  import { defineConfig } from "drizzle-kit"

  export default defineConfig({
    dialect: "sqlite",
    schema: "./src/notes/schema.ts",
    out: "./drizzle",
  })
  ```

  `generate` does not need `dbCredentials`; migrations are applied by `src/db.ts`. Paths are relative to `server/`, which is the cwd for the package script.

- [ ] **3.5 Generate the initial migration.**

  Command:

  ```bash
  bun run db:generate
  ```

  Expected:
  - Exit code 0.
  - Drizzle Kit prints the generated SQL path, e.g. `server/drizzle/0000_*.sql`.
  - `server/drizzle/meta/_journal.json` and a `*_snapshot.json` exist.

  Verify the SQL:

  ```powershell
  Get-ChildItem server/drizzle -Recurse
  Get-Content server/drizzle/0000_*.sql
  ```

  Expected SQL contains:

  ```sql
  CREATE TABLE `notes` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `text` text NOT NULL,
    `created_at` text NOT NULL
  );
  ```

  The exact whitespace/ordering is generated; the three columns and the table name must be present. Keep the SQL, `meta/_journal.json`, and the snapshot tracked; they are the schema history, not generated build output. Do not add `server/drizzle/` to `.gitignore`.

- [ ] **3.6 Apply the migration and verify the database.**

  Command:

  ```bash
  bun run db:migrate
  ```

  Expected: `Migrated <repo>\server\data\app.db`.

  Verify tables and WAL (write a throwaway script so the Powershell/native-CLI quote rules do not corrupt the SQL):

  ```powershell
  @'
  import { Database } from "bun:sqlite"
  const db = new Database("server/data/app.db")
  console.log(db.query("select name from sqlite_master").all())
  console.log(db.query("pragma journal_mode").get())
  db.close()
  '@ | Set-Content check-db.ts
  bun run check-db.ts
  Remove-Item check-db.ts
  ```

  Expected:
  - Table names include `__drizzle_migrations` and `notes`.
  - `pragma journal_mode` is `{ journal_mode: "wal" }`.

- [ ] **3.7 Add database paths to `.gitignore`.**

  Append:

  ```gitignore
  server/data/
  *.db
  *.db-wal
  *.db-shm
  ```

  `server/drizzle/` must **not** be ignored; it is the checked-in migration history.

- [ ] **3.8 Convert `notes.module.ts` to a database-aware factory.**

  Replace the file with:

  ```ts
  import { createModule, type ModuleDef } from "awilixify"
  import type { AppDatabase } from "../db"
  import { NotesController, NotesPreviewService } from "./notes.controller"

  export type NotesModuleDef = ModuleDef<{
    providers: {
      db: AppDatabase
      notesService: NotesPreviewService
      notesController: NotesController
    }
  }>

  export function createNotesModule(db: AppDatabase) {
    return createModule<NotesModuleDef>({
      name: "NotesModule",
      providers: {
        db,
        notesService: NotesPreviewService,
        notesController: NotesController,
      },
    })
  }
  ```

  The `db` provider is registered as a value. CLASSIC mode matches the constructor parameter name `db` when `NotesService` is introduced in Task 4.

- [ ] **3.9 Convert `server/src/app.ts` to a `createApp(db)` factory.**

  Replace the file with:

  ```ts
  import { Hono } from "hono"
  import { DIContext } from "awilixify"
  import type { AppDatabase } from "./db"
  import { createNotesModule, type NotesModuleDef } from "./notes/notes.module"

  export function createApp(db: AppDatabase) {
    const container = DIContext.create(createNotesModule(db))
    const notesController = container.scope.resolve<
      NotesModuleDef["deps"]["notesController"]
    >("notesController")

    return new Hono().route("/api/notes", notesController.registerRoutes())
  }

  export type AppType = ReturnType<typeof createApp>
  ```

  `ReturnType<typeof createApp>` keeps the inferred chained type. The `AppType` name and the import path in `client/src/api.ts` do not change.

- [ ] **3.10 Update `server/src/index.ts` to create and migrate the database.**

  Replace the file with:

  ```ts
  import { createApp } from "./app"
  import { createDb, defaultDatabasePath, migrateDb } from "./db"

  const db = createDb()
  migrateDb(db)

  const app = createApp(db)
  const port = Number(process.env.PORT ?? 3000)

  console.log(
    `API listening on http://localhost:${port} (database: ${
      process.env.DATABASE_PATH ?? defaultDatabasePath
    })`,
  )

  export default {
    port,
    fetch: app.fetch,
  }
  ```

  Startup applies pending migrations, so a fresh clone works after `bun run start` even if the operator forgets `db:migrate`. The explicit command remains for deployment and inspection.

- [ ] **3.11 Typecheck and re-run the contract checks.**

  Commands:

  ```bash
  bun install
  bun run build
  bun run typecheck
  bun run dev:server
  ```

  Expected:
  - Typecheck exits 0. No error about `bun:sqlite`, `$client`, or `import.meta.main`.
  - Server starts, applies the migration, and logs the database path.
  - `GET http://localhost:3000/api/notes` still returns 200 with the in-memory preview service.

  Stop the server with `Ctrl+C`.

- [ ] **3.12 Add the database section to `README.md`.**

  Append:

  ````markdown
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
  ````

---

### Task 4: Replaceable Notes flow and production hosting

**Files:**
- Create: `server/src/notes/notes.service.ts`
- Modify: `server/src/notes/notes.controller.ts`, `server/src/notes/notes.module.ts`, `server/src/app.ts`, `server/src/index.ts`
- Modify: `client/src/routes/index.tsx`, `client/src/api.ts`, `README.md`

**Done when:** A note entered in the browser persists across refresh; bad requests receive 400; the typed client builds; a production Bun process serves both `/api` and a directly loaded client route.

**Depends on:** Task 3.

#### Steps

- [ ] **4.1 Create `server/src/notes/notes.service.ts`.**

  ```ts
  import { Data, Effect } from "effect"
  import { desc } from "drizzle-orm"
  import type { AppDatabase } from "../db"
  import { notes, type Note } from "./schema"

  export class NotesStorageError extends Data.TaggedError("NotesStorageError")<{
    readonly cause: unknown
  }> {}

  export class NotesService {
    constructor(private readonly db: AppDatabase) {}

    list(): Effect.Effect<Note[], NotesStorageError> {
      return Effect.try({
        try: () => this.db.select().from(notes).orderBy(desc(notes.id)).all(),
        catch: (cause) => new NotesStorageError({ cause }),
      })
    }

    create(text: string): Effect.Effect<Note, NotesStorageError> {
      return Effect.try({
        try: () => {
          const row = this.db
            .insert(notes)
            .values({ text, createdAt: new Date().toISOString() })
            .returning()
            .get()

          if (row === undefined) {
            throw new Error("Insert returned no row")
          }

          return row
        },
        catch: (cause) => new NotesStorageError({ cause }),
      })
    }
  }
  ```

  `Effect.try` is correct here because `bun:sqlite`/Drizzle execute synchronously. Every thrown value becomes the explicit `NotesStorageError` in the effect's error channel; defects are still possible and are handled by the Hono `onError` in 4.3.

- [ ] **4.2 Replace `server/src/notes/notes.controller.ts` with the database-backed controller.**

  ```ts
  import { Hono } from "hono"
  import { zValidator } from "@hono/zod-validator"
  import { z } from "zod"
  import type { Controller } from "awilixify"
  import { Effect } from "effect"
  import type { NotesService } from "./notes.service"

  export const CreateNoteSchema = z.object({
    text: z.string().trim().min(1).max(200),
  })

  export class NotesController implements Controller {
    constructor(private readonly notesService: NotesService) {}

    registerRoutes() {
      return new Hono()
        .get("/", async (c) => {
          const outcome = await Effect.runPromise(
            Effect.match(this.notesService.list(), {
              onFailure: () => ({ ok: false as const }),
              onSuccess: (notes) => ({ ok: true as const, notes }),
            }),
          )

          if (!outcome.ok) {
            return c.json({ error: "Notes are unavailable" }, 503)
          }

          return c.json({ notes: outcome.notes }, 200)
        })
        .post(
          "/",
          zValidator("json", CreateNoteSchema, (result, c) => {
            if (!result.success) {
              return c.json({ error: "Note text must be 1-200 characters" }, 400)
            }
          }),
          async (c) => {
            const { text } = c.req.valid("json")

            const outcome = await Effect.runPromise(
              Effect.match(this.notesService.create(text), {
                onFailure: () => ({ ok: false as const }),
                onSuccess: (note) => ({ ok: true as const, note }),
              }),
            )

            if (!outcome.ok) {
              return c.json({ error: "Notes are unavailable" }, 503)
            }

            return c.json({ note: outcome.note }, 201)
          },
        )
    }
  }
  ```

  Failure mapping:
  - Zod rejection → `400` with a client-safe message.
  - `NotesStorageError` → `503` with a generic message; the cause is not exposed.
  - Anything thrown outside the effect (a defect) → Hono `onError` → `500` generic.

- [ ] **4.3 Replace `server/src/app.ts` with the production-aware app factory.**

  ```ts
  import { Hono } from "hono"
  import { serveStatic } from "@hono/bun"
  import { HTTPException } from "hono/http-exception"
  import { DIContext } from "awilixify"
  import { fileURLToPath } from "node:url"
  import type { AppDatabase } from "./db"
  import { createNotesModule, type NotesModuleDef } from "./notes/notes.module"

  const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url))

  export function createApp(
    db: AppDatabase,
    options: { serveClient?: boolean } = {},
  ) {
    const container = DIContext.create(createNotesModule(db))
    const notesController = container.scope.resolve<
      NotesModuleDef["deps"]["notesController"]
    >("notesController")

    const app = new Hono().route(
      "/api/notes",
      notesController.registerRoutes(),
    )

    app.all("/api", (c) => c.json({ error: "Not found" }, 404))
    app.all("/api/*", (c) => c.json({ error: "Not found" }, 404))

    app.onError((error, c) => {
      if (error instanceof HTTPException && error.status === 400) {
        return c.json({ error: "Invalid JSON body" }, 400)
      }

      console.error(error)
      return c.json({ error: "Internal server error" }, 500)
    })

    if (options.serveClient) {
      app.use("*", serveStatic({ root: clientDist }))
      app.get("*", serveStatic({ root: clientDist, path: "index.html" }))
    }

    return app
  }

  export type AppType = ReturnType<typeof createApp>
  ```

  Order matters:
  - `/api/notes` handlers run first.
  - `/api/*` returns a JSON 404 instead of falling through to the SPA.
  - Static middleware serves real assets.
  - The final `GET *` serves `index.html` for client-side routes.

  The `HTTPException` branch is required because `zValidator` throws `HTTPException(400)` for malformed JSON **before** its result hook runs. Without it, malformed JSON would hit the generic 500 branch. The probe confirmed `{"text":"   "}` still goes through the hook and returns the 400 field message, while `{bad` returns `400 {"error":"Invalid JSON body"}`.

  `app.all`, `app.onError`, `app.use`, and `app.get` are separate statements on purpose. They do not change the declared type of `app`, so `AppType` contains only the API route schema.

- [ ] **4.4 Replace `server/src/notes/notes.module.ts` to inject the real service.**

  ```ts
  import { createModule, type ModuleDef } from "awilixify"
  import type { AppDatabase } from "../db"
  import { NotesController } from "./notes.controller"
  import { NotesService } from "./notes.service"

  export type NotesModuleDef = ModuleDef<{
    providers: {
      db: AppDatabase
      notesService: NotesService
      notesController: NotesController
    }
  }>

  export function createNotesModule(db: AppDatabase) {
    return createModule<NotesModuleDef>({
      name: "NotesModule",
      providers: {
        db,
        notesService: NotesService,
        notesController: NotesController,
      },
    })
  }
  ```

  The temporary `NotesPreviewService` is gone; its class definition is removed with the old controller file in 4.2.

- [ ] **4.5 Update `server/src/index.ts` to serve the built client.**

  ```ts
  import { createApp } from "./app"
  import { createDb, defaultDatabasePath, migrateDb } from "./db"

  const db = createDb()
  migrateDb(db)

  const app = createApp(db, { serveClient: true })
  const port = Number(process.env.PORT ?? 3000)

  console.log(
    `Serving API and client on http://localhost:${port} (database: ${
      process.env.DATABASE_PATH ?? defaultDatabasePath
    })`,
  )

  export default {
    port,
    fetch: app.fetch,
  }
  ```

  `serveClient: true` is unconditional. In development the client is normally opened on Vite's port; serving the last build on 3000 is harmless. In production, `bun run build` must run before `bun run start`.

- [ ] **4.6 Replace `client/src/api.ts` with centralized typed helpers.**

  ```ts
  import { hc } from "hono/client"
  import type { InferRequestType, InferResponseType } from "hono/client"
  import type { AppType } from "../../server/src/app"

  export const api = hc<AppType>("/")

  export type NotesListResponse = InferResponseType<typeof api.api.notes.$get, 200>
  export type CreateNoteRequest = InferRequestType<typeof api.api.notes.$post>["json"]
  export type Note = NotesListResponse["notes"][number]

  export async function fetchNotes(): Promise<Note[]> {
    const res = await api.api.notes.$get()
    const body = await res.json()

    if (!res.ok || !("notes" in body)) {
      throw new Error("Could not load notes")
    }

    return body.notes
  }

  export async function createNote(text: string): Promise<Note> {
    const res = await api.api.notes.$post({ json: { text } })
    const body = await res.json()

    if ("note" in body) {
      return body.note
    }

    throw new Error("error" in body ? body.error : "Could not save note")
  }
  ```

  `Note` is derived from the server response type, so the client never duplicates the server schema. The `"notes" in body` / `"note" in body` guards are runtime narrowing because `hc`'s `res.json()` returns the union of all response bodies, not a status-discriminated union.

- [ ] **4.7 Replace `client/src/routes/index.tsx` with the Query-backed Notes page.**

  ```tsx
  import { createFileRoute } from "@tanstack/react-router"
  import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
  import { useState } from "react"
  import type { FormEvent } from "react"
  import { createNote, fetchNotes } from "../api"

  export const Route = createFileRoute("/")({
    component: NotesPage,
  })

  const notesQueryKey = ["notes"] as const

  function NotesPage() {
    const queryClient = useQueryClient()
    const [text, setText] = useState("")

    const notes = useQuery({
      queryKey: notesQueryKey,
      queryFn: fetchNotes,
    })

    const create = useMutation({
      mutationFn: createNote,
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: notesQueryKey })
      },
    })

    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      const value = text.trim()
      if (!value) return

      create.mutate(value, {
        onSuccess: () => setText(""),
      })
    }

    return (
      <section>
        <h2>Notes</h2>

        <form onSubmit={submit}>
          <label htmlFor="note">New note</label>
          <input
            id="note"
            name="note"
            value={text}
            onChange={(event) => setText(event.target.value)}
            minLength={1}
            maxLength={200}
            required
          />
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? "Saving..." : "Add note"}
          </button>
        </form>

        {create.isError ? <p role="alert">{create.error.message}</p> : null}

        {notes.isPending ? <p>Loading notes...</p> : null}
        {notes.isError ? <p role="alert">Could not load notes.</p> : null}
        {notes.data?.length === 0 ? <p>No notes yet.</p> : null}

        <ul>
          {notes.data?.map((note) => (
            <li key={note.id}>{note.text}</li>
          ))}
        </ul>
      </section>
    )
  }
  ```

  HTML `required`, `minLength`, and `maxLength` provide immediate feedback. The client still does not ship Zod; the server remains authoritative and returns 400 for invalid payloads. Query invalidates `["notes"]` after a successful create, so the refetch shows the persisted row.

- [ ] **4.8 Build, typecheck, and smoke-test the full flow.**

  Commands:

  ```bash
  bun install
  bun run build
  bun run typecheck
  bun run dev:server
  ```

  In another terminal:

  ```bash
  bun run dev:client
  ```

  Expected:
  - Build and typecheck exit 0.
  - Server applies migrations and listens on 3000.
  - Client opens on 5173.
  - Entering a note and submitting shows it in the list.
  - Refreshing the browser keeps the note.
  - Submitting whitespace-only text is blocked by the browser; forcing a `POST` with `{"text":""}` returns 400.
  - Restarting the server keeps the note (SQLite persistence).

- [ ] **4.9 Verify production static hosting and SPA fallback.**

  Commands:

  ```bash
  bun run build
  bun run start
  ```

  In another terminal (PowerShell):

  ```powershell
  curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/
   curl.exe -s http://localhost:3000/api/notes
   curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/some/deep/link
   curl.exe -s -i http://localhost:3000/api
   curl.exe -s -i http://localhost:3000/api/unknown
  ```

  Expected:
  - `/` → `200`, HTML containing `<div id="root"></div>`.
  - `/api/notes` → JSON `{ "notes": [...] }`.
  - `/some/deep/link` → `200` and the same HTML shell (SPA fallback).
   - `/api` and `/api/unknown` → `404` with `{"error":"Not found"}` and `Content-Type: application/json`; neither may return the HTML shell.

  Create through the production server:

  ```powershell
  Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/notes -ContentType "application/json" -Body '{"text":"from production"}' | ConvertTo-Json -Depth 5
  Invoke-RestMethod http://localhost:3000/api/notes | ConvertTo-Json -Depth 5
  ```

  Expected: 201 then the list contains `from production`.

- [ ] **4.10 Add production and removal instructions to `README.md`.**

  Append:

  ````markdown
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
  ````

---

### Task 5: Integration checks and adoption guide

**Files:**
- Create: `server/test/notes.test.ts`
- Modify: `README.md`, `package.json`, `client/package.json`, `server/package.json` only as needed to make verification and setup commands accurate

**Done when:** A fresh clone follows the documented commands to a working app; tests and typecheck/build pass; no secrets, generated data, or unrelated scaffolding are committed.

**Depends on:** Task 4.

#### Steps

- [ ] **5.1 Add the server test script.**

  In `server/package.json`, add:

  ```json
  "test": "bun test"
  ```

  The root `test` script already delegates with `bun run --filter server test`.

- [ ] **5.2 Create `server/test/notes.test.ts`.**

  ```ts
  import { afterAll, beforeAll, describe, expect, test } from "bun:test"
  import { createApp } from "../src/app"
  import { createDb, migrateDb, type AppDatabase } from "../src/db"

  let db: AppDatabase
  let app: ReturnType<typeof createApp>

  beforeAll(() => {
    db = createDb(":memory:")
    migrateDb(db)
    app = createApp(db, { serveClient: false })
  })

  afterAll(() => {
    db.$client.close()
  })

  const postJson = (body: unknown) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  describe("notes api", () => {
    test("creates a note and returns it in the list", async () => {
      const empty = await app.request("/api/notes")
      expect(empty.status).toBe(200)
      expect(await empty.json()).toEqual({ notes: [] })

      const created = await app.request(
        "/api/notes",
        postJson({ text: "  hello  " }),
      )
      expect(created.status).toBe(201)

      const createdBody = await created.json()
      expect(createdBody.note.text).toBe("hello")
      expect(typeof createdBody.note.id).toBe("number")
      expect(typeof createdBody.note.createdAt).toBe("string")

      const listed = await app.request("/api/notes")
      expect(listed.status).toBe(200)

      const listedBody = await listed.json()
      expect(listedBody.notes).toHaveLength(1)
      expect(listedBody.notes[0].text).toBe("hello")
      expect(listedBody.notes[0].id).toBe(createdBody.note.id)
    })

    test("rejects whitespace-only text", async () => {
      const res = await app.request("/api/notes", postJson({ text: "   " }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: "Note text must be 1-200 characters",
      })
    })

    test("rejects text longer than 200 characters", async () => {
      const res = await app.request(
        "/api/notes",
        postJson({ text: "x".repeat(201) }),
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: "Note text must be 1-200 characters",
      })
    })

    test("rejects malformed JSON", async () => {
      const res = await app.request("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "Invalid JSON body" })
    })

    test("returns JSON 404 for API misses", async () => {
      for (const path of ["/api", "/api/unknown"]) {
        const res = await app.request(path)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: "Not found" })
      }
    })
  })
  ```

  Notes:
  - `createDb(":memory:")` uses a temporary SQLite database that never touches `server/data/`. It still applies the checked-in migration.
  - Do not switch this test to a temp **file** on Windows: `bun@1.4.4` keeps `test.db`, `test.db-wal`, and `test.db-shm` handles locked after `db.$client.close()`, so `rmSync`/`unlinkSync` fail with `EBUSY` in `afterAll` and turn a green run red. The manual file/WAL checks in Task 3 and 5.6 cover the file path.
  - `createApp(db, { serveClient: false })` keeps tests off the static middleware.
  - The first test asserts the empty state inside the same test that creates the row, so tests are not order-dependent.
  - `Content-Type: application/json` is required or `zValidator("json", …)` sees an empty body.

- [ ] **5.3 Run the integration tests.**

  Command:

  ```bash
  bun run test
  ```

  Expected:

  ```text
  server/test/notes.test.ts:
  ✓ notes api > creates a note and returns it in the list
  ✓ notes api > rejects whitespace-only text
  ✓ notes api > rejects text longer than 200 characters
  ✓ notes api > rejects malformed JSON
   ✓ notes api > returns JSON 404 for API misses

  5 pass
  0 fail
  ```

  The exact checkmark rendering may vary by Bun version; the pass/fail counts must match.

- [ ] **5.4 Run the full workspace verification.**

  Commands:

  ```bash
  bun install --frozen-lockfile
  bun run check
  bun run test
  ```

  Expected:
  - `--frozen-lockfile` succeeds; no lockfile changes.
  - `bun run check` builds the client, generates the route tree, and typechecks `client` and `server`; exit code 0.
  - Tests report `5 pass`, `0 fail`.

- [ ] **5.5 Verify the production bundle is free of server code.**

  Command (PowerShell):

  ```powershell
  Select-String -Path client/dist/assets/*.js -Pattern "bun:sqlite","drizzle-orm","awilixify","NotesStorageError","zod" -SimpleMatch
  ```

  Expected: no matches. If any match appears, a value import of the server may have leaked into the client; check the import and rebuild. Client-side Effect is excluded by the type-only server import and dependency layout, not by this substring scan.

- [ ] **5.6 Verify persistence across a production restart.**

  Commands:

  ```bash
  bun run build
  bun run start
  ```

  Create a note through the production server, stop it with `Ctrl+C`, start it again with `bun run start`, then:

  ```powershell
  Invoke-RestMethod http://localhost:3000/api/notes | ConvertTo-Json -Depth 5
  ```

  Expected: the note created before the restart is still present. The database file is `server/data/app.db` unless `DATABASE_PATH` overrides it.

- [ ] **5.7 Finalize `README.md` with verification and copying instructions.**

  Append:

  ````markdown
  ## Verification

  From a fresh clone:

  ```bash
  bun install --frozen-lockfile
  bun run check
  bun run test
  ```

  Expected: build and typecheck exit 0; the Notes integration tests report `5 pass`, `0 fail`.

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

  Expected: `200`, `200`, and a JSON `404` for `/api/unknown`.

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
  ````

- [ ] **5.8 Final repository hygiene check.**

  Commands:

  ```bash
  bun run check
  git status --short
  ```

  Expected:
  - `bun run check` exits 0.
  - `git status --short` lists only source, migration, lockfile, and documentation changes.
  - No `server/data/`, `client/dist/`, `client/src/routeTree.gen.ts`, `.env`, `node_modules/`, or SQLite journal files are listed.

- [ ] **5.9 Optional browser smoke test.**

  If a browser is available, run both processes and open <http://localhost:5173>. Expected:
  - The Notes page loads with the existing list.
  - A new note appears without a full page reload.
  - Refreshing keeps the note.
  - Submitting an empty or over-200-character note is blocked or produces a visible error.
  - The browser console has no hydration, router, or query errors.

---

## Verification summary

Windows/PowerShell examples are shown. On bash/macOS/Linux, replace `NUL` with `/dev/null`, `curl.exe` with `curl`, and use `grep` instead of `Select-String`.

| Check | Command | Expected |
| --- | --- | --- |
| Install reproducibility | `bun install --frozen-lockfile` | exit 0, lockfile unchanged |
| Client build + route generation | `bun run build` | `client/dist/index.html`, `routeTree.gen.ts` |
| Typecheck (both) | `bun run typecheck` | exit 0 |
| Full static check | `bun run check` | build + typecheck exit 0 |
| Server integration tests | `bun run test` | `5 pass`, `0 fail` |
| Typed `hc` contract | `client/src/api.ts` type guards | compile without casts |
| Production `/` | `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/` | `200` |
| Production deep link | `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/some/deep/link` | `200`, HTML shell |
| API 404 isolation | `curl.exe -s -i http://localhost:3000/api/unknown` | `404`, JSON, not HTML |
| Persistence | create note, restart `bun run start`, GET | note still present |
| No server code in client bundle | `Select-String client/dist/assets/*.js` for `bun:sqlite` | no matches |

