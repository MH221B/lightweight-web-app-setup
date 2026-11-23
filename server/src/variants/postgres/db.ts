import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { schema, type AppDatabase } from "@server/variants/postgres/schema";

export const migrationsFolder = fileURLToPath(new URL("../../../drizzle-pg", import.meta.url));

// Logs must never carry credentials: host, port and database name only.
export function describeDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "<redacted DATABASE_URL>";
  }
}

/**
 * The database the URL names: the path, or postgres.js's default (the login
 * role) when the URL carries no path. A `database` query parameter is
 * deliberately ignored here: it overrides the path in postgres.js, so the
 * guard below compares the server's answer against the path and refuses the
 * contradictory URL instead of trusting either half.
 */
function expectedDatabase(url: URL): string {
  const fromPath = url.pathname.replace(/^\//, "");
  if (fromPath) return decodeURIComponent(fromPath);
  if (url.username) return decodeURIComponent(url.username);
  throw new Error("DATABASE_URL must name a database");
}

export async function createDb(url = process.env.DATABASE_URL): Promise<AppDatabase> {
  if (!url) throw new Error("DATABASE_URL is required for the postgres database");
  const expected = expectedDatabase(new URL(url));
  const client = postgres(url);
  const db: AppDatabase = drizzle(client, { schema });
  // Guard by construction: no caller can migrate or query this client
  // without proving it is on the database the URL names. `?database=` in
  // postgres.js becomes a startup parameter that overrides the pathname,
  // which is why the comparison is against the server, not the string.
  let actual: string | undefined;
  try {
    const rows = (await client.unsafe("select current_database() as current_database")) as
      | Array<{ current_database?: string }>
      | undefined;
    actual = rows?.[0]?.current_database;
  } catch (error) {
    // The guard query is the first connection: close the pending pool before
    // rethrowing, or an unreachable server would keep the process alive.
    await client.end({ timeout: 5 }).catch(() => {});
    throw error;
  }
  if (actual !== expected) {
    await client.end({ timeout: 5 }).catch(() => {});
    throw new Error(
      `refusing to run: expected the database ${expected}, connected to ${String(actual)}`,
    );
  }
  return db;
}

export async function migrateDb(db: AppDatabase, folder = migrationsFolder): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}

if (import.meta.main) {
  const db = await createDb();
  await migrateDb(db);
  console.log(`Migrated ${describeDatabaseUrl(process.env.DATABASE_URL ?? "")}`);
  await db.$client.end({ timeout: 5 });
}
