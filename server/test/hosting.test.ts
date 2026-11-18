import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { createApp } from "@server/app";
import { createDb, migrateDb } from "@server/db";

const db = createDb(":memory:");
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  migrateDb(db);
  app = await createApp(db, {
    serveClient: true,
    clientDist: `${import.meta.dir}/fixtures/client`,
  });
});

afterAll(async () => {
  await app.close();
  db.$client.close();
});

describe("production hosting", () => {
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

  test("malformed percent-encoding returns 404", async () => {
    const response = await app.inject({ method: "GET", url: "/%E0%A4%A" });
    expect(response.statusCode).toBe(404);
  });

  test("compresses a sufficiently large JSON response with gzip", async () => {
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
