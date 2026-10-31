import { Hono, type Context } from "hono";
import { serveStatic } from "@hono/bun";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";
import { DIContext } from "awilixify";
import { join, relative } from "node:path";
import type { AppDatabase } from "@server/db";
import { createNotesModule, type NotesModuleDef } from "@server/notes/notes.module";

const clientDist = join(import.meta.dir, "../../client/dist");

// Fingerprinted Vite assets never change; everything else (notably index.html) must revalidate.
function setCacheHeaders(path: string, c: Context) {
  const file = relative(clientDist, path).replaceAll("\\", "/");
  c.header(
    "Cache-Control",
    file.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  );
}

export function createApp(db: AppDatabase, options: { serveClient?: boolean } = {}) {
  const container = DIContext.create(createNotesModule(db));
  const notesController =
    container.scope.resolve<NotesModuleDef["deps"]["notesController"]>("notesController");

  const app = new Hono().use("*", compress()).route("/api/notes", notesController.registerRoutes());

  app.all("/api", (c) => c.json({ error: "Not found" }, 404));
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 400) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    console.error(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  if (options.serveClient) {
    app.use("*", serveStatic({ root: clientDist, onFound: setCacheHeaders }));
    app.get("*", serveStatic({ root: clientDist, path: "index.html", onFound: setCacheHeaders }));
  }

  return app;
}

export type AppType = ReturnType<typeof createApp>;
