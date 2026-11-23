import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseEnv } from "@server/variants/postgres/env";
import { start } from "@server/variants/postgres/index";
import { freePort } from "./free-port";
import {
  installSuiteCleanup,
  openTestDatabase,
  postgresCapability,
  type TestDatabase,
} from "./test-database";

const fixtures = resolve(import.meta.dir, "fixtures/client");

const { databaseUrl, required, canProvision } = await postgresCapability();

describe.skipIf(!canProvision)("CLIENT_DIST (postgres)", () => {
  let database: TestDatabase;
  let started: Awaited<ReturnType<typeof start>>;
  let env: ReturnType<typeof parseEnv>;

  beforeAll(async () => {
    const opened = await openTestDatabase(databaseUrl, required);
    if (!opened) throw new Error("DATABASE_URL role lost CREATEDB after the capability check");
    database = opened;
    try {
      env = parseEnv({
        DATABASE_URL: database.url,
        CLIENT_DIST: fixtures,
        PORT: String(await freePort()),
      });
      started = await start(env);
    } catch (error) {
      // start() closes its own pool on a boot failure, so nothing holds the
      // database: drop it here or it leaks, because afterAll has nothing to
      // close when start() threw. A failed drop is never silent: the ledger
      // already names the database, so log the name and the drop error while
      // keeping the suite's primary error intact.
      await database.drop().catch((dropError: unknown) => {
        console.error(
          `! could not drop temporary database ${database.name} after a startup failure; drop it manually: drop database "${database.name}"`,
          dropError,
        );
      });
      throw error;
    }
  });

  installSuiteCleanup(
    () => (started ? database : undefined),
    () => [() => started.app.close(), () => started.db.$client.end({ timeout: 5 })],
  );

  test("startup serves the configured directory", async () => {
    const baseUrl = `http://127.0.0.1:${env.PORT}`;
    const index = await fetch(`${baseUrl}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("Hosting fixture");
    expect(index.headers.get("cache-control")).toBe("no-cache");

    const deepLink = await fetch(`${baseUrl}/some/deep/link`);
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain("Hosting fixture");
  });
});
