import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "@server/app";
import { createDb, migrateDb } from "@server/variants/postgres/db";
import { NotesModule } from "@server/variants/postgres/notes/notes.module";
import { notes } from "@server/variants/postgres/notes/schema";
import {
  installSuiteCleanup,
  openTestDatabase,
  postgresCapability,
  type TestDatabase,
} from "./test-database";

const { databaseUrl, required, canProvision } = await postgresCapability();

describe.skipIf(!canProvision)("notes api (postgres)", () => {
  let database: TestDatabase;
  let db: Awaited<ReturnType<typeof createDb>>;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    const opened = await openTestDatabase(databaseUrl, required);
    if (!opened) throw new Error("DATABASE_URL role lost CREATEDB after the capability check");
    database = opened;
    db = await createDb(database.url);
    await migrateDb(db);
    await migrateDb(db);
    await db.delete(notes);
    app = await createApp(db, { serveClient: false, notesModule: NotesModule });
  });

  installSuiteCleanup(
    () => database,
    () => [
      async () => {
        if (app) await app.close();
      },
      async () => {
        if (db) await db.$client.end({ timeout: 5 });
      },
    ],
  );

  const request = async (
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) => {
    const response = await app.inject({
      url,
      method: options.method === "POST" ? "POST" : "GET",
      headers: options.headers,
      payload: options.body,
    });
    return { status: response.statusCode, json: () => response.json() };
  };

  const postJson = (body: unknown) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  test("creates a note and returns it in the list", async () => {
    const empty = await request("/api/notes");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ notes: [] });

    const created = await request("/api/notes", postJson({ text: "  hello  " }));
    expect(created.status).toBe(201);

    const createdBody = await created.json();
    expect(createdBody.note.text).toBe("hello");
    expect(typeof createdBody.note.id).toBe("number");
    expect(typeof createdBody.note.createdAt).toBe("string");

    const listed = await request("/api/notes");
    expect(listed.status).toBe(200);

    const listedBody = await listed.json();
    expect(listedBody.notes).toHaveLength(1);
    expect(listedBody.notes[0].text).toBe("hello");
    expect(listedBody.notes[0].id).toBe(createdBody.note.id);
  });

  test("rejects whitespace-only text", async () => {
    const res = await request("/api/notes", postJson({ text: "   " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Note text must be 1-200 characters",
    });
  });

  test("rejects text longer than 200 characters", async () => {
    const res = await request("/api/notes", postJson({ text: "x".repeat(201) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Note text must be 1-200 characters",
    });
  });

  test("rejects malformed JSON", async () => {
    const res = await request("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  test("returns 413 for bodies over the limit", async () => {
    const res = await request("/api/notes", postJson({ text: "x".repeat(1_200_000) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Payload too large" });
  });

  test("returns JSON 404 for API misses", async () => {
    for (const path of ["/api", "/api/unknown"]) {
      const res = await request(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });

  test("rejects missing and non-string text", async () => {
    for (const body of [{}, { text: null }, { text: 42 }, { text: [] }]) {
      const res = await request("/api/notes", postJson(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Note text must be 1-200 characters" });
    }
  });

  test("returns 503 for storage failures", async () => {
    const brokenDb = await createDb(database.url);
    const brokenApp = await createApp(brokenDb, {
      serveClient: false,
      notesModule: NotesModule,
    });
    await brokenDb.$client.end({ timeout: 5 });
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const list = await brokenApp.inject({ method: "GET", url: "/api/notes" });
      const create = await brokenApp.inject({
        method: "POST",
        url: "/api/notes",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ text: "hello" }),
      });
      for (const response of [list, create]) {
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: "Notes are unavailable" });
      }
    } finally {
      log.mockRestore();
      await brokenApp.close();
    }
  });

  test("browser API uses actual Nest routes and preserves errors", async () => {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const original = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { origin: `http://127.0.0.1:${address.port}` },
    });
    try {
      const { createNote, fetchNotes } = await import("../../shared/api");
      const note = await createNote("  typed client  ");
      expect(note.text).toBe("typed client");
      expect((await fetchNotes()).some((item) => item.id === note.id)).toBe(true);
      await createNote(" ").then(
        () => {
          throw new Error("Expected invalid note to be rejected");
        },
        (error: unknown) =>
          expect(error).toHaveProperty("message", "Note text must be 1-200 characters"),
      );
    } finally {
      if (original) Object.defineProperty(globalThis, "location", original);
      else Reflect.deleteProperty(globalThis, "location");
    }
  });
});
