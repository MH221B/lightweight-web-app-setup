import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { createDb, migrateDb } from "@server/variants/postgres/db";
import { parseEnv } from "@server/variants/postgres/env";
import { start } from "@server/variants/postgres/index";
import {
  assertCurrentDatabase,
  closeAndDrop,
  createTestDatabase,
  hasCreateDatabasePrivilege,
  openTestDatabase,
  recordOwnedDatabase,
  temporaryDatabaseUrl,
} from "./test-database";

const base = process.env.DATABASE_URL ?? "";
if (!base) {
  console.log("! DATABASE_URL is not set: skipping the temporary-database probe");
  process.exit(0);
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
// Owned-names ledger: the helper appends every database it creates. An
// inherited value (the rehearsal or the local real run) is reused and left
// in place; otherwise the probe owns a temp file and removes it.
const inheritedLedger = process.env.MH_TEST_DB_NAMES_FILE ?? "";
const ledger = inheritedLedger || join(tmpdir(), `mh-probe-owned-${suffix}.txt`);
process.env.MH_TEST_DB_NAMES_FILE = ledger;
if (!inheritedLedger) await rm(ledger, { force: true });

const admin = postgres(base, { max: 1, onnotice: () => {} });
const keptName = `mh_probe_kept_${suffix}`;
const keptUrl = temporaryDatabaseUrl(base, keptName);

function urlFor(user: string, password: string, database: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase() === "database") url.searchParams.delete(key);
  }
  return url.toString();
}

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

async function exists(name: string): Promise<boolean> {
  const rows = (await admin.unsafe(
    "select count(*)::int as n from pg_database where datname = $1",
    [name],
  )) as Array<{ n: number }>;
  return (rows[0]?.n ?? 0) > 0;
}

async function ownedNames(): Promise<string[]> {
  const text = await readFile(ledger, "utf8").catch(() => "");
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

async function stillPresent(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const placeholders = names.map((_, index) => `$${index + 1}`).join(", ");
  const rows = (await admin.unsafe(
    `select datname from pg_database where datname in (${placeholders}) order by datname`,
    names,
  )) as Array<{ datname: string }>;
  return rows.map((row) => row.datname);
}

async function main(): Promise<void> {
  const isSuperuser =
    (
      (await admin.unsafe(
        "select rolsuper as su from pg_roles where rolname = current_user",
      )) as Array<{ su: boolean }>
    )[0]?.su === true;

  await admin.unsafe(`create database "${keptName}"`);
  // Probe-created directly, but recorded through the same ledger API so the
  // final assertion covers it too.
  await recordOwnedDatabase(keptName);
  const kept = postgres(keptUrl, { max: 1, onnotice: () => {} });
  try {
    // 1. A `database` parameter must not reroute the client createDb gets.
    const sentinel = `mh_probe_sentinel_${suffix}`;
    await kept.unsafe(`create table "${sentinel}" (id int)`);
    await kept.unsafe(`insert into "${sentinel}" values (1)`);
    const hijack = new URL(keptUrl);
    hijack.searchParams.set("database", keptName);
    const temporary = await createTestDatabase(hijack.toString());
    try {
      // The guard lives in createDb: building the client already refuses a
      // rerouted connection. The explicit check documents the second layer.
      const db = await createDb(temporary.url);
      try {
        await assertCurrentDatabase(db.$client, temporary.name);
        await db.$client.unsafe(`create table "mh_probe_marker_${suffix}" (id int)`);
      } finally {
        await db.$client.end({ timeout: 5 });
      }
      const [row] = (await kept.unsafe(`select count(*)::int as n from "${sentinel}"`)) as Array<{
        n: number;
      }>;
      const [marker] = (await kept.unsafe(
        `select to_regclass('public."mh_probe_marker_${suffix}"')::text as t`,
      )) as Array<{ t: string | null }>;
      if (row?.n !== 1 || marker?.t !== null) {
        throw new Error("the guarded client reached the kept database");
      }
      console.log(`url-override current=${temporary.name} sentinel=1 marker=absent`);
    } finally {
      await temporary.drop();
    }

    // 2. A denied base connection rethrows 42501; it is never a skip.
    if (isSuperuser) {
      const role = `mh_probe_denied_${suffix}`;
      const denied = `mh_probe_denied_db_${suffix}`;
      await admin.unsafe(`create role "${role}" login password 'probe'`);
      await admin.unsafe(`create database "${denied}"`);
      try {
        await admin.unsafe(`revoke connect on database "${denied}" from public`);
        let code: unknown;
        try {
          await openTestDatabase(urlFor(role, "probe", denied), false);
        } catch (error) {
          code = (error as { code?: unknown }).code;
        }
        if (code !== "42501") {
          throw new Error(`connect-denied expected 42501, got ${String(code)}`);
        }
        console.log("connect-denied rethrown=42501");
      } finally {
        // Probe-owned objects only; `if exists` keeps a partial stage from
        // masking the real failure in cleanup.
        await admin.unsafe(`drop database if exists "${denied}"`);
        await admin.unsafe(`drop role if exists "${role}"`);
      }

      // 3. Creation failure: a denied CREATE DATABASE is the helper's CREATE
      // catch. It records no owned name (the ledger append happens only
      // after a successful CREATE), skips locally, and throws when required.
      const restrictedRole = `mh_probe_nocreate_${suffix}`;
      await admin.unsafe(`create role "${restrictedRole}" login password 'probe'`);
      try {
        const restricted = urlFor(restrictedRole, "probe", keptName);
        if (await hasCreateDatabasePrivilege(restricted)) {
          throw new Error("expected the restricted role to lack CREATEDB");
        }
        const recordedBefore = (await ownedNames()).length;
        const skipped = await openTestDatabase(restricted, false);
        let requiredThrew = false;
        try {
          await openTestDatabase(restricted, true);
        } catch {
          requiredThrew = true;
        }
        const recordedAfter = (await ownedNames()).length;
        if (skipped !== null || !requiredThrew || recordedAfter !== recordedBefore) {
          throw new Error("creation failure did not skip, throw when required, or record nothing");
        }
        console.log("creation-failure skip=null required=throw recorded=0");
      } finally {
        await admin.unsafe(`drop role if exists "${restrictedRole}"`);
      }
    } else {
      console.log("skip: connect-denied needs a superuser role to create a denied login");
      console.log("skip: creation-failure needs a superuser role to create a restricted login");
    }

    // 4. A failed migration runs the suite's real afterAll cleanup.
    {
      const temporary = await createTestDatabase(base);
      const db = await createDb(temporary.url);
      try {
        await db.$client.unsafe('create table "notes" (bogus int)');
        let threw = false;
        try {
          await migrateDb(db);
        } catch {
          threw = true;
        }
        if (!threw) {
          throw new Error("expected the conflicting notes table to fail the migration");
        }
      } finally {
        // Exactly what the suites' afterAll calls.
        await closeAndDrop(temporary, [() => db.$client.end({ timeout: 5 })]);
      }
      if (await exists(temporary.name)) throw new Error("migration-failure cleanup failed");
      console.log("migration-failure dropped=true");
    }

    // 5. A failed startup closes its own pool, then the suite's catch drops.
    {
      const temporary = await createTestDatabase(base);
      // Deterministic boot failure, no port race: the migration cannot
      // create "notes" over the conflicting table planted here. start()
      // creates its pool first, so its catch must close that pool or the
      // DROP below fails with "database is being accessed by other users".
      const seed = await createDb(temporary.url);
      try {
        await seed.$client.unsafe('create table "notes" (bogus int)');
      } finally {
        await seed.$client.end({ timeout: 5 });
      }
      let threw = false;
      try {
        const booted = await start(
          parseEnv({
            DATABASE_URL: temporary.url,
            CLIENT_DIST: `${import.meta.dir}/fixtures/client`,
            PORT: String(await freePort()),
          }),
        );
        // Not expected; close cleanly so the assertion below is the signal.
        await booted.app.close();
        await booted.db.$client.end({ timeout: 5 });
      } catch {
        threw = true;
      }
      // Exactly what client-dist's beforeAll catch calls on a boot failure.
      await temporary.drop();
      if (!threw) throw new Error("expected the conflicting notes table to fail startup");
      if (await exists(temporary.name)) throw new Error("startup-failure cleanup failed");
      console.log("startup-failure dropped=true");
    }

    // 6. A throwing client close still drops through the real cleanup.
    {
      const temporary = await createTestDatabase(base);
      const db = await createDb(temporary.url);
      const realEnd = db.$client.end.bind(db.$client);
      const simulated = new Error("simulated client-close failure");
      let closeError: unknown;
      try {
        // postgres refuses to drop a database with a live session, so a
        // closer that never releases the pool would make the DROP fail for
        // the wrong reason. Release the connection, then report the failure:
        // the pinned contract is "the close error is rethrown AND the
        // database is actually dropped".
        (db.$client as unknown as { end: () => Promise<void> }).end = async () => {
          await realEnd({ timeout: 5 });
          throw simulated;
        };
        try {
          // The suites' afterAll: the throwing closer must not skip the drop.
          await closeAndDrop(temporary, [() => db.$client.end({ timeout: 5 })]);
        } catch (error) {
          closeError = error;
        }
      } finally {
        (db.$client as unknown as { end: typeof realEnd }).end = realEnd;
        await realEnd({ timeout: 5 }).catch(() => {});
      }
      if (closeError !== simulated || (await exists(temporary.name))) {
        throw new Error("client-close-failure cleanup failed");
      }
      console.log("client-close-failure close=throw dropped=true");
    }

    // 7. A failed DROP is loud and succeeds once the blocker is closed.
    {
      const temporary = await createTestDatabase(base);
      const holder = postgres(temporary.url, { max: 1, onnotice: () => {} });
      await holder.unsafe("select 1");
      let loud = false;
      try {
        await temporary.drop();
      } catch {
        loud = true;
      }
      await holder.end({ timeout: 5 });
      await temporary.drop();
      if (!loud || (await exists(temporary.name))) throw new Error("drop-failure path failed");
      console.log("drop-failure loud=true dropped=true");
    }
  } finally {
    await kept.end({ timeout: 5 });
  }
}

let failed = false;
try {
  await main();
} catch (error) {
  console.error(error);
  failed = true;
} finally {
  await admin.unsafe(`drop database if exists "${keptName}"`).catch(() => {});
}
// Exactly the databases this run recorded, never the server's whole set.
const recorded = await ownedNames();
const remaining = await stillPresent(recorded);
console.log(`owned-names=${recorded.length} remaining=${remaining.length}`);
if (remaining.length > 0) {
  console.error(`owned databases were not dropped: ${remaining.join(", ")}`);
}
await admin.end({ timeout: 5 });
if (!inheritedLedger) await rm(ledger, { force: true });
if (failed || remaining.length > 0) process.exit(1);
