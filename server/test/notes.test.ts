import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@server/app";
import { createDb, migrateDb, type AppDatabase } from "@server/db";

let db: AppDatabase;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  db = createDb(":memory:");
  migrateDb(db);
  app = await createApp(db, { serveClient: false });
});

afterAll(async () => {
  await app.close();
  db.$client.close();
});

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

describe("notes api", () => {
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

  test("returns JSON 404 for API misses", async () => {
    for (const path of ["/api", "/api/unknown"]) {
      const res = await request(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });
});
