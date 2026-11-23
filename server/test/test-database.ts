import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll } from "bun:test";

export interface TestDatabase {
  url: string;
  name: string;
  /** Drop the database. Call only after every client on `url` is closed. */
  drop(): Promise<void>;
}

export class CreateDatabaseError extends Error {
  constructor(
    readonly database: string,
    readonly detail: unknown,
  ) {
    super(`could not create temporary database ${database}`);
    this.name = "CreateDatabaseError";
  }
}

export const CREATEDB_NOTICE =
  "! DATABASE_URL role lacks CREATEDB: skipping the postgres integration tests";
const NAME = /^mh_test_[0-9a-f]{12}$/;

export async function postgresCapability() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const required = process.env.MH_REQUIRE_POSTGRES === "1";
  if (required && !databaseUrl) throw new Error("MH_REQUIRE_POSTGRES=1 requires DATABASE_URL");
  if (!databaseUrl)
    console.log("! DATABASE_URL is not set: skipping the postgres integration tests");
  const canProvision = databaseUrl !== "" && (await hasCreateDatabasePrivilege(databaseUrl));
  if (required && databaseUrl !== "" && !canProvision)
    throw new Error("MH_REQUIRE_POSTGRES=1 requires a DATABASE_URL role with CREATEDB");
  if (databaseUrl !== "" && !canProvision) console.log(CREATEDB_NOTICE);
  return { databaseUrl, required, canProvision };
}

export function installSuiteCleanup(
  getDatabase: () => TestDatabase | undefined,
  closers: () => ReadonlyArray<() => PromiseLike<unknown>>,
): void {
  afterAll(async () => {
    const database = getDatabase();
    if (database) await closeAndDrop(database, closers());
  });
}

function connect(url: string) {
  return postgres(url, { max: 1, onnotice: () => {} });
}

/**
 * Build the temporary database's URL. postgres.js promotes a `database`
 * query parameter to a startup parameter that OVERRIDES the pathname, so
 * `postgres://host/kept?database=kept` would keep the destructive client
 * on `kept` even after the path is swapped. Strip it: the temporary URL
 * must land on the generated name.
 */
export function temporaryDatabaseUrl(base: string, name: string): string {
  const url = new URL(base);
  for (const key of new Set(url.searchParams.keys())) {
    if (key.toLowerCase() === "database") url.searchParams.delete(key);
  }
  url.pathname = `/${name}`;
  return url.toString();
}

interface QueryRunner {
  unsafe(query: string): PromiseLike<unknown>;
}

export async function assertCurrentDatabase(client: QueryRunner, expected: string): Promise<void> {
  const rows = (await client.unsafe("select current_database() as current_database")) as
    | Array<{ current_database?: string }>
    | undefined;
  const actual = rows?.[0]?.current_database;
  if (actual !== expected) {
    throw new Error(
      `refusing to run: expected the temporary database ${expected}, connected to ${String(actual)}`,
    );
  }
}

function isInsufficientPrivilege(error: unknown): boolean {
  // postgres.js copies the server's SQLSTATE onto PostgresError.code.
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42501"
  );
}

/**
 * Read-only skip check for module scope: it creates nothing, so the suite's
 * handle is acquired in beforeAll and afterAll is registered first. CREATEDB
 * is a role attribute that is never inherited through membership, so the
 * login role's own row is the effective value. A base-connection failure
 * throws here, never a skip.
 */
export async function hasCreateDatabasePrivilege(base: string): Promise<boolean> {
  const sql = connect(base);
  try {
    const rows = (await sql.unsafe(
      "select rolcreatedb or rolsuper as can_create from pg_roles where rolname = current_user",
    )) as Array<{ can_create?: boolean }> | undefined;
    return rows?.[0]?.can_create === true;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function dropDatabase(base: string, name: string): Promise<void> {
  // Connect through the base URL, not the temporary one: DROP needs the
  // maintenance side, and the temporary database may already be unusable.
  const cleanup = connect(base);
  try {
    await cleanup.unsafe(`drop database if exists "${name}"`);
  } finally {
    await cleanup.end({ timeout: 5 });
  }
}

export async function createTestDatabase(base: string): Promise<TestDatabase> {
  const name = `mh_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  if (!NAME.test(name)) throw new Error(`unexpected test database name: ${name}`);
  // Built before CREATE so an unsafe URL shape fails before anything exists.
  const url = temporaryDatabaseUrl(base, name);
  const admin = connect(base);

  // Step 1: prove the base connection works. A 42501 here is an access
  // failure, not the missing-CREATEDB shape, so it is never a skip.
  try {
    await admin.unsafe("select 1");
  } catch (error) {
    await admin.end({ timeout: 5 }).catch(() => {});
    throw error;
  }

  // Step 2: only this operation can mean "the role lacks CREATEDB".
  try {
    await admin.unsafe(`create database "${name}"`);
  } catch (error) {
    await admin.end({ timeout: 5 }).catch(() => {});
    throw new CreateDatabaseError(name, error);
  }

  // Step 3: the database exists from here on. Ownership is recorded first,
  // then the returned URL is verified against the server (the second guard
  // layer, one query), then the admin connection closes. Any failure in
  // this block drops the database before rethrowing — and if the drop also
  // fails, names it loudly instead of losing it.
  try {
    await recordOwnedDatabase(name);
    const check = connect(url);
    try {
      await assertCurrentDatabase(check, name);
    } finally {
      await check.end({ timeout: 5 }).catch(() => {});
    }
    await admin.end({ timeout: 5 });
    return { name, url, drop: () => dropDatabase(base, name) };
  } catch (error) {
    await admin.end({ timeout: 5 }).catch(() => {});
    await dropDatabase(base, name).catch((dropError: unknown) => {
      throw new Error(
        `temporary database ${name} exists but could not be dropped; drop it manually: drop database "${name}"`,
        { cause: dropError },
      );
    });
    throw error;
  }
}

/**
 * Record a database this run owns in MH_TEST_DB_NAMES_FILE. Unset (the
 * default) makes it a no-op. The ledger is the cleanup assertion: a run
 * checks exactly its own names, so a concurrent run's databases — appearing
 * or vanishing — can never fail a correct run. The probe reuses the same
 * function for the databases it creates directly.
 */
export async function recordOwnedDatabase(name: string): Promise<void> {
  const file = process.env.MH_TEST_DB_NAMES_FILE;
  if (file) await appendFile(file, `${name}\n`);
}

export async function readOwnedNames(file: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * The suites' single cleanup path, so the probe can execute the same code
 * with an injected failure instead of re-implementing it. Every closer runs
 * even if an earlier one throws; the drop always happens; a close failure
 * is rethrown after the drop because a leak is the worse outcome.
 */
export async function closeAndDrop(
  database: TestDatabase,
  closers: ReadonlyArray<() => PromiseLike<unknown>>,
): Promise<void> {
  let closeError: unknown;
  for (const close of closers) {
    try {
      await close();
    } catch (error) {
      closeError ??= error;
    }
  }
  await database.drop();
  if (closeError) throw closeError;
}

/**
 * Create the temporary database, classifying only a CREATE DATABASE 42501
 * as "the role lacks CREATEDB". A base-connection failure (including a
 * 42501 from CONNECT) is an access failure and is rethrown, as is every
 * other error, so a supplied-but-unreachable URL fails.
 */
export async function openTestDatabase(
  base: string,
  required: boolean,
): Promise<TestDatabase | null> {
  try {
    return await createTestDatabase(base);
  } catch (error) {
    if (!(error instanceof CreateDatabaseError) || !isInsufficientPrivilege(error.detail)) {
      throw error;
    }
    if (required) throw error;
    console.log(CREATEDB_NOTICE);
    return null;
  }
}
