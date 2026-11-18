import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { notes } from "@server/notes/schema";

export { notes };
export const schema = { notes };
export type AppDatabase = BunSQLiteDatabase<typeof schema> & { $client: Database };
