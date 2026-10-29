# Lightweight web app starter

## Goal

Build a copyable TypeScript monorepo that future projects can clone and adapt. This is a working baseline, not a Notes product and not yet a project generator. A small, disposable Notes example proves the frontend, API, dependency injection, service, and database work together.

## Architecture

- The root is a Bun workspace with `client/` and `server/`. Bun manages packages and runs the server.
- `client/` uses React 19, Vite+, Vite's React plugin with the experimental Oxc Rust React Compiler, TanStack Router for navigation, TanStack Query for server data and mutations, and Hono `hc` for typed API calls.
- `server/` uses Hono on Bun. Awilixify constructs the Notes controller and service. Register the controller as an Awilixify provider and have it return a chained Hono sub-app from `registerRoutes()`; the app factory resolves the controller and mounts the sub-app. Awilixify's `controllers` lifecycle registers routes by side effect and loses the route type required by `hc`. No HTTP decorators or custom adapter are needed. Service operations use Effect for typed failures. Drizzle connects to SQLite through `bun:sqlite`. Zod validates incoming API data.
- The client imports the server's Hono `AppType` as a type only. Route registration must preserve Hono's inferred type for `hc`; the scaffold is not complete unless the client typecheck proves this works with the Awilixify controller.
- Development runs the Vite+ client and Bun API as separate processes, with `/api` proxied to Hono. A production client build is served as static files by the same Bun process as the API. SQLite lives on persistent disk, outside committed source.

## Disposable vertical slice

The Notes page lists persisted notes and provides a form for adding a short note. TanStack Router renders the page; Query loads the list and invalidates it after a successful mutation. The client uses `hc`, not a hand-written API type or tRPC. HTML form constraints provide basic immediate feedback; the client does not ship Zod by default.

The Hono POST endpoint validates the request with Zod and returns a clear 400 for invalid input. The Awilixify-managed controller calls the injected Notes service. The service returns an Effect with an explicit failure type and uses Drizzle to read and write SQLite. Expected failures map to explicit HTTP responses; unexpected failures return 500 without exposing internal details. The GET endpoint returns the saved notes. Generate and apply a checked-in initial SQLite migration rather than creating tables ad hoc at request time. Enable WAL for normal single-server use.

Keep the example isolated enough that a new project can remove or replace its page, controller, service, schema, migration, and tests. No generic CRUD framework or speculative abstraction is needed.

## Verification and use

Document Bun install, two-process development, migrations, production build and run, persistent database path, and how to remove or rename the example. Add tests after implementation: a server integration test covering successful creation/listing and rejected invalid input; typecheck and build must demonstrate the typed `hc` client and production asset serving. Manually smoke-test the page and creation flow in a browser when a browser is available.

The baseline excludes a project generator, tRPC, client-side Effect or Zod, a custom Hono decorator adapter, and unrelated TanStack packages. Future projects can add client-side schema validation for complex forms, or adopt more Effect features when their workflows warrant it. Do not commit or publish without an explicit request.
