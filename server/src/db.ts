import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { notes } from "./notes/schema";

const schema = { notes };

export type AppDatabase = BunSQLiteDatabase<typeof schema> & {
  $client: Database;
};

export const defaultDatabasePath = fileURLToPath(new URL("../data/app.db", import.meta.url));

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export function createDb(path = process.env.DATABASE_PATH ?? defaultDatabasePath): AppDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const client = new Database(path);

  if (path !== ":memory:") {
    client.exec("PRAGMA journal_mode = WAL;");
  }
  client.exec("PRAGMA foreign_keys = ON;");

  return drizzle(client, { schema });
}

export function migrateDb(db: AppDatabase, folder = migrationsFolder): void {
  migrate(db, { migrationsFolder: folder });
}

if (import.meta.main) {
  const db = createDb();
  migrateDb(db);
  console.log(`Migrated ${process.env.DATABASE_PATH ?? defaultDatabasePath}`);
  db.$client.close();
}
