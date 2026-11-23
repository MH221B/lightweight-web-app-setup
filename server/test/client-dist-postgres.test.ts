import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import net from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "@server/variants/postgres/env";
import { start } from "@server/variants/postgres/index";
import {
  closeAndDrop,
  CREATEDB_NOTICE,
  hasCreateDatabasePrivilege,
  openTestDatabase,
  type TestDatabase,
} from "./test-database";

const fixtures = resolve(import.meta.dir, "fixtures/client");
const repoRoot = resolve(import.meta.dir, "../..");

const databaseUrl = process.env.DATABASE_URL ?? "";
const required = process.env.MH_REQUIRE_POSTGRES === "1";

if (required && !databaseUrl) throw new Error("MH_REQUIRE_POSTGRES=1 requires DATABASE_URL");
if (!databaseUrl) console.log("! DATABASE_URL is not set: skipping the postgres integration tests");

// Read-only skip decision: nothing is created at module scope.
const canProvision = databaseUrl !== "" && (await hasCreateDatabasePrivilege(databaseUrl));
// Both skip conditions become failures under the required flag; the
// missing URL already threw above, this is the missing-CREATEDB half.
if (required && databaseUrl !== "" && !canProvision) {
  throw new Error("MH_REQUIRE_POSTGRES=1 requires a DATABASE_URL role with CREATEDB");
}
if (databaseUrl !== "" && !canProvision) console.log(CREATEDB_NOTICE);

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

describe.skipIf(!canProvision)("CLIENT_DIST (postgres)", () => {
  let database: TestDatabase;
  let started: Awaited<ReturnType<typeof start>>;
  let env: ReturnType<typeof parseEnv>;

  beforeAll(async () => {
    const opened = await openTestDatabase(databaseUrl, required);
    if (!opened) throw new Error("DATABASE_URL role lost CREATEDB after the capability check");
    database = opened;
    try {
      // start() runs the migrations before it returns; its first step is
      // createDb, which refuses a connection that is not on the temporary
      // database. No suite-local guard client is needed.
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

  afterAll(async () => {
    // The suite's real cleanup: beforeAll already dropped the database if
    // start() threw; otherwise close the server and the pool, then drop.
    if (!started) return;
    await closeAndDrop(database, [
      () => started.app.close(),
      () => started.db.$client.end({ timeout: 5 }),
    ]);
  });

  test("defaults resolve from the repo root, and startup serves the configured directory", async () => {
    expect(parseEnv({ DATABASE_URL: database.url }).CLIENT_DIST).toBe(
      resolve(repoRoot, "client/dist"),
    );
    expect(parseEnv({ DATABASE_URL: databaseUrl, CLIENT_DIST: "custom/dist" }).CLIENT_DIST).toBe(
      resolve(repoRoot, "custom/dist"),
    );

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
