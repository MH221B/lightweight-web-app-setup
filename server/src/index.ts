import { createApp } from "@server/app";
import { createDb, defaultDatabasePath, migrateDb } from "@server/db";
import { env } from "@server/env";

const db = createDb(env.DATABASE_PATH ?? defaultDatabasePath);
migrateDb(db);

const app = createApp(db, { serveClient: true });

console.log(
  `Serving API and client on http://localhost:${env.PORT} (database: ${
    env.DATABASE_PATH ?? defaultDatabasePath
  })`,
);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
