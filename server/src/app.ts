import { Hono } from "hono";
import { serveStatic } from "@hono/bun";
import { HTTPException } from "hono/http-exception";
import { DIContext } from "awilixify";
import { fileURLToPath } from "node:url";
import type { AppDatabase } from "./db";
import { createNotesModule, type NotesModuleDef } from "./notes/notes.module";

const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));

export function createApp(db: AppDatabase, options: { serveClient?: boolean } = {}) {
  const container = DIContext.create(createNotesModule(db));
  const notesController =
    container.scope.resolve<NotesModuleDef["deps"]["notesController"]>("notesController");

  const app = new Hono().route("/api/notes", notesController.registerRoutes());

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
    app.use("*", serveStatic({ root: clientDist }));
    app.get("*", serveStatic({ root: clientDist, path: "index.html" }));
  }

  return app;
}

export type AppType = ReturnType<typeof createApp>;
