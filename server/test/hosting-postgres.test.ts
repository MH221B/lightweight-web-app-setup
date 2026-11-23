import { beforeAll, describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
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

describe.skipIf(!canProvision)("production hosting (postgres)", () => {
  let database: TestDatabase;
  let db: Awaited<ReturnType<typeof createDb>>;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    const opened = await openTestDatabase(databaseUrl, required);
    if (!opened) throw new Error("DATABASE_URL role lost CREATEDB after the capability check");
    database = opened;
    db = await createDb(database.url);
    await migrateDb(db);
    app = await createApp(db, {
      serveClient: true,
      clientDist: `${import.meta.dir}/fixtures/client`,
      notesModule: NotesModule,
    });
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

  test("API misses stay JSON 404s when the client is served", async () => {
    for (const url of ["/api", "/api/unknown"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Not found" });
    }
  });

  test("missing non-API paths fall back to index with no-cache", async () => {
    for (const url of ["/", "/some/deep/link", "/index.html"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Hosting fixture");
      expect(response.headers["cache-control"]).toBe("no-cache");
    }
  });

  test("assets are cached immutably", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("hosting fixture");
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("hash-suffixed build files at the output root are cached immutably, lookalikes are not", async () => {
    const response = await app.inject({ method: "GET", url: "/main-4f3a9c1b.js" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("hashed fixture");
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    for (const [url, body] of [
      ["/service-worker.js", "addEventListener"],
      ["/app-settings.json", '"theme"'],
    ] as const) {
      const lookalike = await app.inject({ method: "GET", url });
      expect(lookalike.statusCode).toBe(200);
      expect(lookalike.body).toContain(body);
      expect(lookalike.headers["cache-control"]).toBe("no-cache");
    }
  });

  test("malformed percent-encoding returns 404", async () => {
    const response = await app.inject({ method: "GET", url: "/%E0%A4%A" });
    expect(response.statusCode).toBe(404);
  });

  test("compresses a sufficiently large JSON response with gzip", async () => {
    await db.delete(notes);
    for (let i = 0; i < 6; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/notes",
        payload: { text: "x".repeat(200) },
      });
      expect(response.statusCode).toBe(201);
    }
    const response = await app.inject({
      method: "GET",
      url: "/api/notes",
      headers: { "accept-encoding": "gzip" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(response.rawPayload).toString()).notes).toHaveLength(6);
  });

  test("compresses a sufficiently large static asset with gzip", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/assets/large.txt",
      headers: { "accept-encoding": "gzip" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(response.rawPayload).toString()).toBe("hosting fixture ".repeat(100));
  });
});
