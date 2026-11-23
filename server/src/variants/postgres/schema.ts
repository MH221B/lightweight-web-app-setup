import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { notes } from "@server/variants/postgres/notes/schema";

export { notes };
export const schema = { notes };
export type AppDatabase = PostgresJsDatabase<typeof schema> & { $client: Sql };
