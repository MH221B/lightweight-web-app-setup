import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseEnv } from "@server/env";
import { start } from "@server/index";
import { freePort } from "./free-port";

const fixtures = resolve(import.meta.dir, "fixtures/client");

let app: Awaited<ReturnType<typeof start>>;
let baseUrl: string;

beforeAll(async () => {
  const env = parseEnv({
    CLIENT_DIST: fixtures,
    PORT: String(await freePort()),
    DATABASE_PATH: ":memory:",
  });
  app = await start(env);
  baseUrl = `http://127.0.0.1:${env.PORT}`;
});

afterAll(async () => {
  await app.close();
});

describe("CLIENT_DIST", () => {
  test("startup serves the configured directory", async () => {
    const index = await fetch(`${baseUrl}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("Hosting fixture");
    expect(index.headers.get("cache-control")).toBe("no-cache");

    const deepLink = await fetch(`${baseUrl}/some/deep/link`);
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain("Hosting fixture");
  });
});
