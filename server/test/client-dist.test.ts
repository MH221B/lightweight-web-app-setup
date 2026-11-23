import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import net from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "@server/env";
import { start } from "@server/index";

const fixtures = resolve(import.meta.dir, "fixtures/client");
const repoRoot = resolve(import.meta.dir, "../..");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const server = net.createServer();
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => res(port));
    });
    server.on("error", rej);
  });
}

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
  test("defaults resolve from the repo root, and startup serves the configured directory", async () => {
    expect(parseEnv({}).CLIENT_DIST).toBe(resolve(repoRoot, "client/dist"));
    expect(parseEnv({ CLIENT_DIST: "client-angular/dist" }).CLIENT_DIST).toBe(
      resolve(repoRoot, "client-angular/dist"),
    );

    const index = await fetch(`${baseUrl}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("Hosting fixture");
    expect(index.headers.get("cache-control")).toBe("no-cache");

    const deepLink = await fetch(`${baseUrl}/some/deep/link`);
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain("Hosting fixture");
  });
});
